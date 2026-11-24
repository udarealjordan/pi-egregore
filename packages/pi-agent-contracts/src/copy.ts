import { CURSOR_MARKER, sliceByColumn, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";

/** Data-only semantic copy contract shared by Egregore, Ask and Tasks.
 * A projection describes what a rendered surface means, independently of the
 * frame glyphs used to paint it. It is ephemeral render metadata, never state. */
export const COPY_PROJECTION_PROPERTY = "piCopyProjection" as const;

export type CopySegmentKind = "content" | "metadata" | "decoration" | "padding";

export interface CopySegment {
  /** Inclusive terminal-cell column. */
  start: number;
  /** Exclusive terminal-cell column. */
  end: number;
  /** Plain visible text for [start, end). No ANSI/OSC or line breaks. */
  text: string;
  kind: CopySegmentKind;
}

export interface CopyRow {
  row: number;
  /** Exact visible rendered row, without ANSI/OSC/cursor markers. */
  renderedText: string;
  segments: CopySegment[];
}

export interface CopyProjection {
  version: 1;
  surfaceId: string;
  width: number;
  height: number;
  rows: CopyRow[];
  revision: string | number;
}

export interface CopyProjectionHost {
  piCopyProjection?: CopyProjection;
}

export type CopyAwareComponent = Component & CopyProjectionHost;

export interface CopyRegion {
  row: number;
  start: number;
  end: number;
  kind?: Exclude<CopySegmentKind, "decoration" | "padding">;
}

export interface CopySpan { start: number; end: number }
export type CopyRowSpans = CopySpan | readonly CopySpan[];

/** A normal string array with owner-declared copy semantics that follow its
 * mutations. Surface code can keep using ordinary push/splice/shift operations. */
export class CopyLines extends Array<string> {
  static get [Symbol.species](): ArrayConstructor { return Array; }
  copyKinds: CopySegmentKind[] = [];
  copySpans: Array<CopyRowSpans | undefined> = [];
  copySafe = true;

  constructor(...items: string[]) {
    super(...items);
    Object.defineProperties(this, {
      copyKinds: { value: items.map((): CopySegmentKind => "content"), writable: true, configurable: true },
      copySpans: { value: items.map(() => undefined), writable: true, configurable: true },
      copySafe: { value: true, writable: true, configurable: true },
    });
  }

  override push(...items: string[]): number {
    this.copyKinds.push(...items.map((): CopySegmentKind => "content"));
    this.copySpans.push(...items.map(() => undefined));
    return super.push(...items);
  }

  override pop(): string | undefined {
    this.copyKinds.pop(); this.copySpans.pop();
    return super.pop();
  }

  override shift(): string | undefined {
    this.copyKinds.shift(); this.copySpans.shift();
    return super.shift();
  }

  override unshift(...items: string[]): number {
    this.copyKinds.unshift(...items.map((): CopySegmentKind => "content"));
    this.copySpans.unshift(...items.map(() => undefined));
    return super.unshift(...items);
  }

  override splice(start: number, deleteCount?: number, ...items: string[]): string[] {
    const from = start < 0 ? Math.max(0, this.length + start) : Math.min(start, this.length);
    const count = deleteCount === undefined ? this.length - from : Math.max(0, deleteCount);
    this.copyKinds.splice(from, count, ...items.map((): CopySegmentKind => "content"));
    this.copySpans.splice(from, count, ...items.map(() => undefined));
    return super.splice(from, count, ...items);
  }

  override slice(start?: number, end?: number): CopyLines {
    const from = start === undefined ? 0 : start < 0 ? Math.max(0, this.length + start) : Math.min(start, this.length);
    const to = end === undefined ? this.length : end < 0 ? Math.max(0, this.length + end) : Math.min(end, this.length);
    const out = new CopyLines();
    out.copySafe = this.copySafe;
    for (let row = from; row < to; row++) {
      out.push(this[row]);
      out.copyKinds[out.length - 1] = this.copyKinds[row] ?? "content";
      out.copySpans[out.length - 1] = this.copySpans[row];
    }
    return out;
  }

  mark(start: number, end = start + 1, kind: CopySegmentKind = "decoration", span?: CopyRowSpans): void {
    for (let row = Math.max(0, start); row < Math.min(this.length, end); row++) {
      this.copyKinds[row] = kind;
      this.copySpans[row] = span;
    }
  }

  /** Restore metadata after a host operation kept a known subset of old rows. */
  remap(kept: readonly number[]): void {
    const kinds = this.copyKinds, spans = this.copySpans;
    this.copyKinds = kept.map(index => kinds[index] ?? "content");
    this.copySpans = kept.map(index => spans[index]);
  }
}

export function isCopyLines(rows: readonly string[]): rows is CopyLines {
  return Array.isArray(rows) && Array.isArray((rows as CopyLines).copyKinds) && Array.isArray((rows as CopyLines).copySpans);
}

export function asCopyLines(rows: readonly string[]): CopyLines {
  return isCopyLines(rows) ? rows : new CopyLines(...rows);
}

export function cloneCopyLines(rows: readonly string[]): CopyLines {
  const source = asCopyLines(rows), out = new CopyLines(...source);
  out.copyKinds = [...source.copyKinds]; out.copySpans = [...source.copySpans];
  out.copySafe = source.copySafe;
  return out;
}

function isSpanArray(span: CopyRowSpans): span is readonly CopySpan[] {
  return Array.isArray(span);
}

/** Append rendered rows while preserving their semantic kinds and cell spans. */
export function appendCopyLines(target: string[], source: readonly string[], map: (line: string) => string = line => line, prefix = 0): void {
  const semantic = asCopyLines(source);
  if (isCopyLines(target)) target.copySafe = target.copySafe && semantic.copySafe;
  for (let index = 0; index < semantic.length; index++) {
    target.push(map(semantic[index]));
    if (isCopyLines(target)) {
      const row = target.length - 1, span = semantic.copySpans[index];
      target.copyKinds[row] = semantic.copyKinds[index] ?? "content";
      target.copySpans[row] = span === undefined ? undefined : isSpanArray(span)
        ? span.map(part => ({ start: part.start + prefix, end: part.end + prefix }))
        : { start: span.start + prefix, end: span.end + prefix };
    }
  }
}

/** Pi removes renderer-owned APC cursor markers before screen composition. */
export function visibleCopyText(line: string): string {
  return stripVTControlCharacters(line.replaceAll(CURSOR_MARKER, "")
    .replaceAll("\x1b_pi:fc\x07", "").replaceAll("\x1b_pi:/fc\x07", ""));
}

/** Build a projection from explicit semantic cell regions. Frame glyphs are
 * never inspected: each surface owner declares what its rows mean. */
export function projectCopyRows(surfaceId: string, width: number, renderedRows: readonly string[], revision: string | number, regions: readonly CopyRegion[]): CopyProjection {
  const byRow = new Map<number, CopyRegion[]>();
  for (const region of regions) {
    const list = byRow.get(region.row) ?? [];
    list.push(region); byRow.set(region.row, list);
  }
  return {
    version: 1, surfaceId, width, height: renderedRows.length, revision,
    rows: renderedRows.map((rendered, row) => {
      const renderedText = visibleCopyText(rendered);
      const segments = (byRow.get(row) ?? []).map(region => {
        const text = sliceByColumn(renderedText, region.start, Math.max(0, region.end - region.start), true);
        return copySegment(text + " ".repeat(Math.max(0, region.end - region.start - visibleWidth(text))), region.start, region.kind ?? "content");
      });
      return { row, renderedText, segments };
    }),
  };
}

/** Project a conventional top-rail/content/bottom-rail frame. `padding` counts
 * semantic blank edge rows inside the frame; `height` can exclude native rows
 * after the bottom rail (for example Composer completion menus). */
export function projectFrameCopy(surfaceId: string, width: number, renderedRows: readonly string[], revision: string | number,
  options: { inset?: number; padding?: number; bottom?: number; height?: number } = {}): CopyProjection {
  const bottom = options.bottom ?? renderedRows.length - 1;
  const height = options.height ?? bottom + 1;
  const inset = options.inset ?? 0, padding = options.padding ?? 0;
  const regions: CopyRegion[] = [];
  for (let row = 1 + padding; row < bottom - padding; row++) {
    const start = 1 + inset, end = width - 1 - inset;
    if (end > start) regions.push({ row, start, end });
  }
  return projectCopyRows(surfaceId, width, renderedRows.slice(0, height), revision, regions);
}

/** Project collapsed tool rows: the left rail and its following space are
 * decoration. Blank spacer rows added between tool runs are padding. */
export function projectRailCopy(surfaceId: string, width: number, renderedRows: readonly string[], revision: string | number): CopyProjection {
  const regions: CopyRegion[] = [];
  if (width > 2) renderedRows.forEach((rendered, row) => {
    if (visibleCopyText(rendered).trim()) regions.push({ row, start: 2, end: width });
  });
  return projectCopyRows(surfaceId, width, renderedRows, revision, regions);
}

/** Project semantic lines that already occupy the full rendered width. */
export function projectCopyLines(surfaceId: string, width: number, renderedRows: readonly string[], lines: readonly string[], revision: string | number): CopyProjection {
  const semantic = asCopyLines(lines), regions: CopyRegion[] = [];
  for (let row = 0; row < semantic.length; row++) {
    const kind = semantic.copyKinds[row] ?? "content";
    if (kind === "decoration" || kind === "padding") continue;
    const span = semantic.copySpans[row];
    const spans = span === undefined ? [{ start: 0, end: width }] : isSpanArray(span) ? span : [span];
    for (const part of spans) {
      const start = Math.max(0, part.start), end = Math.min(width, part.end);
      if (end > start) regions.push({ row, start, end, kind });
    }
  }
  return projectCopyRows(surfaceId, width, renderedRows, revision, regions);
}

/** Attach only a valid, current projection. A partial prefix is allowed so
 * rows after a Composer's bottom rail (completion menus) remain native. */
export function rememberCopyProjection(owner: object, width: number, renderedRows: readonly string[], projection: CopyProjection): string[] {
  const valid = readCopyProjection(projection);
  if (!valid || valid.width !== width || valid.height > renderedRows.length ||
    valid.rows.some((row, index) => row.renderedText !== visibleCopyText(renderedRows[index] ?? ""))) {
    forgetCopyProjection(owner);
  } else (owner as CopyProjectionHost)[COPY_PROJECTION_PROPERTY] = valid;
  return [...renderedRows];
}

export function forgetCopyProjection(owner: object): void {
  delete (owner as CopyProjectionHost)[COPY_PROJECTION_PROPERTY];
}

export function copyProjectionOf(owner: object): CopyProjection | undefined {
  return readCopyProjection((owner as CopyProjectionHost)[COPY_PROJECTION_PROPERTY]);
}

const KINDS = new Set<CopySegmentKind>(["content", "metadata", "decoration", "padding"]);
const CONTROL = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u;
const MAX_ROWS = 10000;
const MAX_SEGMENTS = 64;
const MAX_TEXT = 10000;

export function copySegment(text: string, start = 0, kind: CopySegmentKind = "content"): CopySegment {
  return { start, end: start + visibleWidth(text), text, kind };
}

/** Validate untrusted/versioned projection data. Returns the original typed
 * object only when every row and cell span is structurally valid. */
export function readCopyProjection(value: unknown): CopyProjection | undefined {
  if (!value || typeof value !== "object") return;
  const p = value as CopyProjection;
  if (p.version !== 1 || typeof p.surfaceId !== "string" || !/^[\w:-]{1,80}$/.test(p.surfaceId) ||
    !Number.isSafeInteger(p.width) || p.width < 1 || p.width > MAX_ROWS ||
    !Number.isSafeInteger(p.height) || p.height < 1 || p.height > MAX_ROWS ||
    !Array.isArray(p.rows) || p.rows.length !== p.height ||
    !((typeof p.revision === "string" && p.revision.length <= 200) ||
      (typeof p.revision === "number" && Number.isSafeInteger(p.revision) && p.revision >= 0))) return;
  for (let i = 0; i < p.rows.length; i++) {
    const row = p.rows[i];
    if (!row || row.row !== i || typeof row.renderedText !== "string" || row.renderedText.length > MAX_TEXT ||
      CONTROL.test(row.renderedText) || visibleWidth(row.renderedText) > p.width || !Array.isArray(row.segments) || row.segments.length > MAX_SEGMENTS) return;
    let previousEnd = 0;
    for (const segment of row.segments) {
      if (!segment || !KINDS.has(segment.kind) || typeof segment.text !== "string" || segment.text.length > MAX_TEXT ||
        CONTROL.test(segment.text) || !Number.isSafeInteger(segment.start) || !Number.isSafeInteger(segment.end) ||
        segment.start < previousEnd || segment.end <= segment.start || segment.end > p.width ||
        visibleWidth(segment.text) !== segment.end - segment.start) return;
      previousEnd = segment.end;
    }
  }
  return p;
}

/** Slice one projected row by terminal-cell columns. Decoration and padding
 * never contribute text. `undefined` means the selection touched no copyable
 * segment; an empty string means it selected a real blank content row. */
export function copyRowSelection(row: CopyRow, start: number, end: number, trimEnd = true): string | undefined {
  let text = "", selected = false;
  for (const segment of row.segments) {
    if (segment.kind === "decoration" || segment.kind === "padding") continue;
    const from = Math.max(start, segment.start), to = Math.min(end, segment.end);
    if (to <= from) continue;
    selected = true;
    text += slicePlainByColumn(segment.text, from - segment.start, to - from);
  }
  return selected ? trimEnd ? text.trimEnd() : text : undefined;
}

export function copyRowText(row: CopyRow, start: number, end: number): string {
  return copyRowSelection(row, start, end) ?? "";
}

/** Kept local to avoid publishing a second width implementation. */
function slicePlainByColumn(text: string, start: number, width: number): string {
  return sliceByColumn(text, start, width, true);
}
