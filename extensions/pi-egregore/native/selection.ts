import { Container, sliceByColumn, type Component } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { copyRowSelection, copyProjectionOf, visibleCopyText } from "./copy-projection.ts";
import { childLayout, findScrollBox, resolveReceiver, type LayoutBox } from "./shapes.ts";

type Point = { row: number; col: number; scrollView?: unknown; boundary?: boolean };
type Selection = { start: Point; end: Point };
type Host = {
  currentLayout?: { root: LayoutBox; width: number };
  previousScreen?: string[];
  getActiveSelectionText: () => string | undefined;
  getSelectionBounds: () => Selection | undefined;
  getSelectionColumns: (line: string, row: number, selection: Selection) => { start: number; end: number };
};
type Span = { row: number; column: number; projection: NonNullable<ReturnType<typeof copyProjectionOf>> };
type OwnedRange = { start: number; end: number; span: Span; row: NonNullable<Span["projection"]["rows"][number]> };

const fitsHeight = (content: number, visible: number, allowClip: boolean) => allowClip ? content >= visible : content === visible;

/** Follow only native vertical Containers' recorded layout. A component-owned
 * projection is authoritative for its rendered prefix; unknown layout stays native. */
function collect(component: Component, width: number, row: number, height: number, spans: Span[], depth = 0, column = 0, allowClip = false): void {
  if (depth > 32) return;
  const projection = copyProjectionOf(component);
  if (projection) {
    if (projection.width === width && (projection.height <= height || allowClip)) spans.push({ row, column, projection });
    return;
  }
  if (!(component instanceof Container) || component.render !== Container.prototype.render) return;
  const layout = childLayout(component);
  if (!layout || layout.width !== width || !Array.isArray(layout.children) ||
    layout.children.length !== component.children.length ||
    layout.children.some((child, i) => child.component !== component.children[i] || !Number.isInteger(child.height) || child.height < 0) ||
    !fitsHeight(layout.children.reduce((sum, child) => sum + child.height, 0), height, allowClip)) return;
  // A clipped overlay hides a suffix; children keep their own provenance checks per row.
  const bottom = row + height;
  for (const child of layout.children) {
    if (row >= bottom) break;
    collect(child.component, width, row, child.height, spans, depth + 1, column, allowClip);
    row += child.height;
  }
}

/** Only full-width, unclipped native layout leaves are eligible in screen space. */
function collectFixed(box: LayoutBox, width: number, spans: Span[], depth = 0): void {
  if (depth > 32 || box.scrollView) return;
  if (box.lines && box.rect.x === 0 && box.rect.width === width && !box.lineOffset &&
    box.rect.height >= box.lines.length && box.clip.x === 0 && box.clip.width === width &&
    box.clip.y <= box.rect.y && box.clip.y + box.clip.height >= box.rect.y + box.lines.length) {
    collect(box.component as Component, width, box.rect.y, box.lines.length, spans);
    return;
  }
  for (const child of box.children) collectFixed(child, width, spans, depth + 1);
}

/** Claim overlapping projected ranges in reverse paint order. A higher overlay
 * owns its cells; a lower/earlier owner may still clean an uncovered range. */
function ownedRanges(spans: Span[], row: number, start: number, end: number, line: string): OwnedRange[] {
  const owned: OwnedRange[] = [];
  for (const span of spans.toReversed()) {
    if (row < span.row || row >= span.row + span.projection.height) continue;
    const from = Math.max(start, span.column), to = Math.min(end, span.column + span.projection.width);
    if (to <= from) continue;
    const projectedRow = span.projection.rows[row - span.row];
    if (!projectedRow || visibleCopyText(sliceByColumn(line, span.column, span.projection.width, true)) !== projectedRow.renderedText) continue;
    let pieces = [{ start: from, end: to }];
    for (const prior of owned) {
      pieces = pieces.flatMap(piece => prior.start >= piece.end || prior.end <= piece.start ? [piece] : [
        ...(prior.start > piece.start ? [{ start: piece.start, end: prior.start }] : []),
        ...(prior.end < piece.end ? [{ start: prior.end, end: piece.end }] : []),
      ]);
    }
    for (const piece of pieces) owned.push({ ...piece, span, row: projectedRow });
  }
  return owned.sort((a, b) => a.start - b.start);
}

function selectedText(host: Host, native: string | undefined): string | undefined {
  if (native === undefined) return native;
  const selection = host.getSelectionBounds();
  if (!selection || selection.start.scrollView !== selection.end.scrollView || !host.currentLayout) return native;
  const spans: Span[] = [];
  let source: string[];
  const fixed = !selection.start.scrollView;
  if (fixed) {
    if (!host.previousScreen) return native;
    source = host.previousScreen;
    collectFixed(host.currentLayout.root, host.currentLayout.width, spans);
    collectOverlays(host, spans);
  } else {
    const box = findScrollBox(host.currentLayout.root, selection.start.scrollView);
    if (!box?.scrollContentLines || box.children.length !== 1) return native;
    source = box.scrollContentLines;
    const content = box.children[0];
    collect(content.component as Component, content.rect.width, 0, source.length, spans);
  }
  if (!spans.length) return native;
  const { start, end } = selection;
  if (!Number.isInteger(start.row) || !Number.isInteger(end.row) || start.row < 0 || end.row >= source.length || end.row < start.row) return native;
  const cleaned: string[] = [];
  let projected = false;
  for (let row = start.row; row <= end.row; row++) {
    const line = source[row] ?? "";
    const columns = host.getSelectionColumns(line, row, selection);
    const nativeRow = stripVTControlCharacters(sliceByColumn(line, columns.start, Math.max(0, columns.end - columns.start), true)).trimEnd();
    const owned = ownedRanges(spans, row, columns.start, columns.end, line);
    if (!owned.length) {
      cleaned.push(nativeRow);
      continue;
    }
    let text = "", cursor = columns.start, semantic = false, nativeContent = false;
    const appendNative = (start: number, end: number) => {
      const part = stripVTControlCharacters(sliceByColumn(line, start, Math.max(0, end - start), true));
      // Native blank padding outside an overlay is not part of its copied body.
      // Nonblank native cells retain their exact indentation and literal text.
      if (part.trim()) { text += part; nativeContent = true; }
    };
    for (const range of owned) {
      appendNative(cursor, range.start);
      const part = copyRowSelection(range.row, range.start - range.span.column, range.end - range.span.column, false);
      if (part !== undefined) { text += part; semantic = true; }
      cursor = range.end;
    }
    appendNative(cursor, columns.end);
    projected = true;
    // A projected blank content row is real blank content; a decoration-only
    // row contributes no line. Unknown/drifted rows above remain native.
    if (semantic || nativeContent) cleaned.push(text.trimEnd());
  }
  if (!projected) return native;
  return cleaned.join("\n") || undefined;
}

/** Instance-only Pi selection adapter. No clipboard replacement, input or timer. */
type OverlayLayout = { entry: { component: Component }; row: number; col: number; width: number; height: number };
type OverlayHost = { renderedOverlayLayouts?: OverlayLayout[] };

/** Pi 1.6 composites focused overlays outside the root layout. Read only the
 * rendered, visible layout records; older hosts simply retain native copy. */
function collectOverlays(host: unknown, spans: Span[]): void {
  const layouts = (host as OverlayHost)?.renderedOverlayLayouts;
  if (!Array.isArray(layouts)) return;
  for (const layout of layouts) {
    if (!layout || !layout.entry || !Number.isInteger(layout.row) || !Number.isInteger(layout.col) ||
      !Number.isInteger(layout.width) || layout.width < 1 || !Number.isInteger(layout.height) || layout.height < 1) continue;
    collect(layout.entry.component, layout.width, layout.row, layout.height, spans, 0, layout.col, true);
  }
}

export function installSemanticSelection(reference: unknown): () => void {
  const noop = () => {};
  const host = resolveReceiver<Host>(reference);
  if (!host || typeof host.getActiveSelectionText !== "function" || typeof host.getSelectionBounds !== "function" ||
    typeof host.getSelectionColumns !== "function") return noop;
  const target = host, original = target.getActiveSelectionText;
  const own = Object.hasOwn(target, "getActiveSelectionText");
  let active = true;
  const wrapped = function () {
    const native = original.call(target);
    if (!active) return native;
    try { return selectedText(target, native); } catch { return native; }
  };
  target.getActiveSelectionText = wrapped;
  return () => {
    active = false;
    if (target.getActiveSelectionText !== wrapped) return;
    if (own) target.getActiveSelectionText = original;
    else delete (target as Partial<Host>).getActiveSelectionText;
  };
}
