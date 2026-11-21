/** Tasks-owned visual vocabulary shared by every surface. Nothing else defines glyphs or status words. */
import { cleanText, type DockRow, type Tone } from "pi-agent-contracts/dock";
import type { Plan, Status, Task } from "./state.ts";
import { unresolved, type QuestionProjection } from "pi-agent-contracts/posted";

export type StatusMark = { glyph: string; tone: Tone; label: string };
export const WORK_STATUS: Readonly<Record<Status, StatusMark>> = {
  active: { glyph: "◉", tone: "accent", label: "In progress" },
  blocked: { glyph: "!", tone: "warning", label: "Blocked" },
  pending: { glyph: "○", tone: "muted", label: "Not started" },
  done: { glyph: "✓", tone: "success", label: "Done" },
  cancelled: { glyph: "–", tone: "muted", label: "Dropped" },
};
/** A running agent distinguishes active work from a paused plan without inventing a new status. */
export function workWord(status: Status, running: boolean): string {
  return status === "active" ? running ? "Working" : "Paused" : WORK_STATUS[status].label;
}
export function planWord(state: string, current: boolean): string {
  return state === "archived" ? "Archived" : state === "completed" || state === "closed" ? "Finished" : current ? "Current" : "Open";
}
/** What a question means for you. Delivered answers are the agent's business, not yours. */
export function questionAttention(q: QuestionProjection): string {
  if (q.state === "submitted") return "Sending your answer";
  if (q.state !== "awaiting") return "Answered";
  return q.urgency === "blocking" ? "Waiting on you" : "When you're ready";
}
/** Why a task is not moving: a blocker reason or an unfinished prerequisite. */
export function waitingText(task: Task, plan: Plan): string {
  if (["done", "cancelled"].includes(task.status)) return "";
  const dependencies = task.dependsOn.map(id=>plan.tasks.find(t=>t.id===id)).filter(t=>t && t.status !== "done");
  const dependency = dependencies.length ? `after ${dependencies.map(t=>t!.title).join(", ")}` : "";
  if (task.status !== "blocked") return dependency;
  return [task.reason, task.unblockWhen ? `continues when ${task.unblockWhen}` : "", dependency].filter(Boolean).join(" · ");
}
/** "1 waiting on you" for the dock summary; answers already sent need no mention. */
export function questionAttentionSummary(records: QuestionProjection[]): string {
  const waiting = records.filter(q=>q.state === "awaiting").length;
  return waiting ? `${waiting} waiting on you` : "";
}
const CLOSED = new Set<Status>(["done", "cancelled"]);
/** One checklist row per task, in plan order. */
export function taskRow(t: Task, plan: Plan, running: boolean): DockRow {
  const mark = WORK_STATUS[t.status], title = cleanText(t.title), why = cleanText(waitingText(t, plan)).slice(0, 200);
  if (t.status === "active") return { text: `${mark.glyph} ${title}${running ? "" : " · paused"}`, tone: "accent", kind: "task" };
  if (t.status === "blocked") return { text: `${mark.glyph} ${title}${why ? ` · ${why}` : ""}`, tone: "warning", kind: "task" };
  if (t.status === "pending") return { text: `${mark.glyph} ${title}${why ? ` · ${why}` : ""}`, tone: why ? "muted" : "text", kind: "task" };
  return { text: `${mark.glyph} ${title}`, tone: "muted", kind: "task" };
}
/** Walking viewport around the work in progress: the task just finished, the active one,
 * what follows it, then any earlier unstarted tasks, up to `cap` after the lead. A short
 * dock therefore always shows the active task. Earlier finished work stays a count. */
export function dockRows(plan: Plan, running: boolean, cap = 6): { rows: DockRow[]; more: number } {
  const tasks = plan.tasks, firstOpen = tasks.findIndex(t => !CLOSED.has(t.status));
  if (firstOpen < 0) return { rows: [], more: 0 };
  const active = tasks.findIndex(t => t.status === "active");
  const pivot = active >= 0 ? active : firstOpen;
  const lead = pivot > 0 && tasks[pivot - 1].status === "done" ? [tasks[pivot - 1]] : [];
  const after = tasks.slice(pivot).filter(t => t.status !== "cancelled");
  const before = tasks.slice(0, pivot).filter(t => !CLOSED.has(t.status));
  const queue = [...after, ...before];
  const shown = queue.slice(0, Math.max(1, cap));
  const remaining = queue.slice(shown.length).filter(t => !CLOSED.has(t.status)).length;
  const phases = [...new Set(tasks.map(t => t.phase).filter(Boolean))];
  if (phases.length < 2) return { rows: [...lead, ...shown].map(t => taskRow(t, plan, running)), more: remaining };
  // Multi-phase plans get a header with that phase's progress where the phase begins.
  const rows: DockRow[] = [];
  let current: string | undefined;
  for (const t of [...lead, ...shown]) {
    if (t.phase !== current) {
      current = t.phase;
      const inPhase = tasks.filter(x => x.phase === t.phase);
      rows.push({ text: `${cleanText(t.phase || "Other")} · ${inPhase.filter(x => CLOSED.has(x.status)).length}/${inPhase.length}`, tone: "muted", kind: "header" });
    }
    rows.push(taskRow(t, plan, running));
  }
  return { rows, more: remaining };
}
