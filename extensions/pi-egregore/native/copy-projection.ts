/** Egregore-private façade over the shared, data-only copy contract.
 * Surface packages import `pi-agent-contracts/copy` directly; keeping these
 * re-exports avoids coupling Ask or Tasks to Egregore's native adapter tree. */
export {
  COPY_PROJECTION_PROPERTY, copySegment, readCopyProjection, copyRowSelection, copyRowText,
  CopyLines, asCopyLines, cloneCopyLines, appendCopyLines,
  visibleCopyText, projectCopyRows, projectCopyLines, projectFrameCopy, projectRailCopy,
  rememberCopyProjection, forgetCopyProjection, copyProjectionOf,
} from "../../../lib/copy.ts";
export type { CopyAwareComponent, CopyRegion } from "../../../lib/copy.ts";
