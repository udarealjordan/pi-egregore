import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** Resolve the established package root without evaluating cached code, then
 * load the current sibling implementation by URL. This keeps `/reload` working
 * when an older process still has the previous package export table. */
const packageDirectory = dirname(createRequire(import.meta.url).resolve("pi-agent-contracts"));
const copy: typeof import("pi-agent-contracts/copy") = await import(
  pathToFileURL(join(packageDirectory, "copy.ts")).href
);

export const {
  COPY_PROJECTION_PROPERTY, copySegment, readCopyProjection, copyRowSelection, copyRowText,
  CopyLines, asCopyLines, cloneCopyLines, appendCopyLines,
  visibleCopyText, projectCopyRows, projectCopyLines, projectFrameCopy, projectRailCopy,
  rememberCopyProjection, forgetCopyProjection, copyProjectionOf,
} = copy;
export type * from "pi-agent-contracts/copy";
