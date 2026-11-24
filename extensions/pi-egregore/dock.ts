import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { cleanText, layoutDock, type DockSnapshot } from "pi-agent-contracts/dock";
import type { EgregoreState } from "./state.ts";
import { composerPadding, composerSurface } from "./composer-style.ts";
import { TaskPanel } from "./task-presentation.ts";
import { forgetCopyProjection, projectCopyRows, rememberCopyProjection, type CopyRegion } from "../../lib/copy.ts";

/** Composer's optional dock sits above the native editor; no art or idle animation. */
export function createDock(tui: TUI, ctx: () => ExtensionContext, state: EgregoreState,
  docks: Map<string, DockSnapshot>, focused: () => boolean, now: () => number = Date.now,
  openQuestion?: (id: string) => void): Component {
  state.taskPanel ??= new TaskPanel();
  let copyRevision = 0;
  /** Question id by rendered row; a click on that row opens the answer sheet. */
  let targets = new Map<number, string>();
  let pressed: string | undefined;
  const component: Component = {
    handleMouse(event) {
      const ref = targets.get(event.y);
      if (!openQuestion || event.button !== "left") return undefined;
      // Pi delivers release before the synthesized click, so the pressed row lives until the click or next press.
      if (event.type === "press") { pressed = ref; return ref ? { handled: true } : undefined; }
      if (event.type === "click") {
        const target = pressed; pressed = undefined;
        if (ref && ref === target) { openQuestion(ref); return { handled: true }; }
      }
      return undefined;
    },
    invalidate() {},
    render(width) {
      if (width <= 0) { forgetCopyProjection(component); return []; }
      const theme = ctx().ui.theme, terminalRows = tui.terminal.rows;
      const nowMs = now();
      const rows: string[] = [], regions: CopyRegion[] = [];
      const content = (start = 1, kind: "content" | "metadata" = "content") => {
        if (start < width) regions.push({ row: rows.length - 1, start, end: width, kind });
      };
      const providers = [...docks.values()].filter((dock) => dock.rows.length).slice(0, 6);
      targets = new Map();
      state.taskPanel!.setVisible(providers.some((dock) => dock.id === "pi-tasks"));
      let remaining = Math.max(4, Math.min(9, Math.floor(terminalRows / 4)));
      for (let index = 0; index < providers.length; index++) {
        const dock = providers[index];
        if (dock.id === "pi-tasks") {
          const offset = rows.length;
          const frame = state.taskPanel!.render(theme, width, dock, state, nowMs, focused(), Math.max(3, remaining));
          state.taskPanel!.refs.forEach((ref, y) => { if (ref) targets.set(offset + y, ref); });
          rows.push(...frame);
          // The shared task frame is unframed below its native width threshold.
          // Project those rows as content rather than dropping their first/last rows.
          if (width >= 16) {
            for (let row = 1; row < frame.length - 1; row++) regions.push({ row: row + offset, start: 2, end: width - 2 });
          } else {
            for (let row = 0; row < frame.length; row++) regions.push({ row: row + offset, start: 0, end: width });
          }
          remaining -= frame.length;
          continue;
        }
        if (remaining < 2) {
          rows.push(truncateToWidth(theme.fg("muted", `+ ${providers.length - index} more panels`), width));
          content(0, "metadata");
          break;
        }
        const items = layoutDock(dock, Math.max(1, width - 2), Math.min(7, remaining - 1));
        rows.push(truncateToWidth(theme.fg("muted", ` ${cleanText(dock.title)}${dock.summary ? " · " + cleanText(dock.summary) : ""}`), width));
        content(1, "metadata");
        for (const row of items) {
          if (row.kind === "question" && row.ref) targets.set(rows.length, row.ref);
          rows.push(truncateToWidth(theme.fg(row.tone ?? "text", " " + cleanText(row.text)), width));
          content();
        }
        remaining -= items.length + 1;
      }
      for (const line of state.activityRows?.(width) ?? []) { rows.push(line); content(0, "metadata"); }
      if (rows.length && composerPadding(width, terminalRows, state.layout?.density)) rows.push("");
      if (state.statusRows) for (const line of state.statusRows(width)) { rows.push(line); content(0, "metadata"); }
      const surfaced = rows.map((line) => composerSurface(theme, line, width));
      return rememberCopyProjection(component, width, surfaced,
        projectCopyRows("pi-egregore:dock", width, surfaced, ++copyRevision, regions));
    },
  };
  return component;
}
