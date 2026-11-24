import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CopyLines as CopyLinesType, CopyRegion, CopyRowSpans, CopySpan } from "pi-agent-contracts/copy";

/** Ask remains self-contained across `/reload`: resolve the established package
 * root without evaluating cached code, then load the current sibling by URL. */
const directory = dirname(createRequire(import.meta.url).resolve("pi-agent-contracts"));
const copy: typeof import("pi-agent-contracts/copy") = await import(
  pathToFileURL(join(directory, "copy.ts")).href
);

export const {
  CopyLines, asCopyLines, cloneCopyLines, appendCopyLines, isCopyLines,
  projectCopyRows, projectFrameCopy, rememberCopyProjection, forgetCopyProjection,
} = copy;
export type { CopyProjection, CopyRegion } from "pi-agent-contracts/copy";
export type CopyLines = CopyLinesType;
export type AskCopyLines = CopyLinesType;
export const asAskCopyLines = asCopyLines;
export const cloneAskCopyLines = cloneCopyLines;
export const appendAskCopyLines = appendCopyLines;

function isSpanArray(span: CopyRowSpans): span is readonly CopySpan[] {
  return Array.isArray(span);
}

/** Project Ask body rows into an already-rendered shell. The shell owns
 * rail/inset geometry; the form owns every content/decoration/padding decision. */
export function projectAskCopyLines(surfaceId: string, width: number, renderedRows: readonly string[], lines: readonly string[], revision: string | number,
  options: { row?: number; column?: number } = {}): ReturnType<typeof projectCopyRows> {
  const semantic = asCopyLines(lines), rowOffset = options.row ?? 0, columnOffset = options.column ?? 0;
  const bodyWidth = Math.max(0, width - columnOffset * 2), regions: CopyRegion[] = [];
  for (let row = 0; row < semantic.length; row++) {
    const kind = semantic.copyKinds[row] ?? "content";
    if (kind === "decoration" || kind === "padding") continue;
    const span = semantic.copySpans[row];
    const spans = span === undefined ? [{ start: 0, end: bodyWidth }] : isSpanArray(span) ? span : [span];
    for (const part of spans) {
      const start = Math.max(0, part.start), end = Math.min(bodyWidth, part.end);
      if (end > start) regions.push({ row: row + rowOffset, start: start + columnOffset, end: end + columnOffset, kind });
    }
  }
  return projectCopyRows(surfaceId, width, renderedRows, revision, regions);
}
