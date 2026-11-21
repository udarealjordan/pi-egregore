import { cleanText, type DockRow } from "pi-agent-contracts/dock";
import type { QuestionProjection } from "pi-agent-contracts/posted";
import type { Plan } from "./state.ts";
import { dockRows } from "./typography.ts";

const short = (value: string, max = 120) => { const chars = Array.from(cleanText(value)); return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join(""); };
/** Questions waiting on you lead, then the checklist. Answers already sent are not shown. */
export function attentionDockRows(plan: Plan, running: boolean, questions: QuestionProjection[], planId: string, cap = 6): { rows: DockRow[]; more: number; hint: string } {
  const waiting = questions.filter(q => q.state === "awaiting")
    .sort((a, b) => Number(b.urgency === "blocking") - Number(a.urgency === "blocking") || Number(b.planId === planId) - Number(a.planId === planId));
  const asked: DockRow[] = waiting.slice(0, 2).map(q => ({ text: `? ${short(q.question)} · /questions ${q.id}`, tone: q.urgency === "blocking" ? "warning" : "muted", kind: "question" }));
  const list = dockRows(plan, running, Math.max(1, cap - asked.length));
  return { rows: [...asked, ...list.rows], more: list.more + Math.max(0, waiting.length - asked.length), hint: "" };
}
