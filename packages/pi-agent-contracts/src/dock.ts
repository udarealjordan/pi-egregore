import { wrapTextWithAnsi, truncateToWidth } from "@earendil-works/pi-tui";

/** Egregore-owned, data-only UI bridge. Neither extension imports the other's implementation.
 * The established pi-home:dock:v1 wire IDs remain stable for independently loaded providers;
 * Home is no longer an extension owner or entry point.
 */
export const DOCK = {
  probe: "pi-home:dock:v1:probe", host: "pi-home:dock:v1:host",
  update: "pi-home:dock:v1:update", ack: "pi-home:dock:v1:ack",
} as const;
export type Tone = "text" | "muted" | "accent" | "success" | "warning" | "error";
/** `kind` lets a host keep what matters when space is short: a question or the active
 * task survives; a phase header or finished work goes first. Optional and additive. */
/** `ref` names the provider's own item (a question id) so a host can open it on click. */
export interface DockRow { text: string; tone?: Tone; kind?: "question" | "task" | "header"; ref?: string }
export type DockColors = Record<Tone | "base" | "panel", string>;
export interface DockHost { version: 1; sessionId: string; available: boolean; colors?: DockColors }
export interface DockSnapshot {
  version: 1; sessionId: string; id: string; title: string; rows: DockRow[]; hint?: string;
  summary?: string; more?: number; overview?: TaskOverview;
}
export interface TaskOverview {
  revision: string; planId?: string; total: number; done: number; blocked: number; cancelled: number;
  activeId?: string; activeTitle?: string; questions?: { blocking: number; deferred: number };
}
export interface DockAck { version: 1; sessionId: string; id: string; mounted: boolean }
export function validOverview(v: TaskOverview): boolean {
  return !!v && typeof v === "object" && typeof v.revision === "string" && v.revision.length <= 200 &&
    (v.planId === undefined || typeof v.planId === "string" && /^p[1-9]\d*$/.test(v.planId)) &&
    [v.total, v.done, v.blocked, v.cancelled].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 10000) &&
    v.done + v.blocked + v.cancelled <= v.total && (v.activeId === undefined || typeof v.activeId === "string" && /^t[1-9]\d*$/.test(v.activeId)) &&
    (v.activeTitle === undefined || typeof v.activeTitle === "string" && v.activeTitle.length >= 1 && v.activeTitle.length <= 200) &&
    (v.questions === undefined || !!v.questions && [v.questions.blocking, v.questions.deferred].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100));
}
export function cleanText(text: string): string {
  return text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ");
}
export function isSnapshot(value: unknown): value is DockSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as DockSnapshot;
  return v.version === 1 && typeof v.sessionId === "string" && typeof v.id === "string" && /^[\w:-]{1,80}$/.test(v.id) &&
    typeof v.title === "string" && v.title.length <= 400 && (v.hint === undefined || typeof v.hint === "string" && v.hint.length <= 200) &&
    (v.summary === undefined || typeof v.summary === "string" && v.summary.length <= 100) &&
    (v.overview === undefined || validOverview(v.overview)) &&
    (v.more === undefined || Number.isSafeInteger(v.more) && v.more >= 0 && v.more <= 10000) &&
    Array.isArray(v.rows) && v.rows.length <= 12 && v.rows.every((r) => r && typeof r.text === "string" && r.text.length <= 600 &&
      (r.tone === undefined || ["text", "muted", "accent", "success", "warning", "error"].includes(r.tone)) &&
      (r.kind === undefined || ["question", "task", "header"].includes(r.kind)) &&
      (r.ref === undefined || typeof r.ref === "string" && /^[\w:-]{1,80}$/.test(r.ref)));
}
const RANK: Record<string, number> = { accent: 1, warning: 2, error: 2, text: 3, success: 4, muted: 4 };
/** Keep the `count` most important rows in their original order: questions, then the active
 * task, blocked, open, and finished work; headers stay only beside a kept task. Returns the
 * kept rows and how many dropped rows were work (headers are not counted). */
export function prioritizeDock(rows: DockRow[], count: number): { rows: DockRow[]; hidden: number } {
  if (rows.length <= count) return { rows, hidden: 0 };
  const rank = (row: DockRow) => row.kind === "question" ? 0 : row.kind === "header" ? 5 : RANK[row.tone ?? "text"] ?? 3;
  const keep = new Set(rows.map((row, i) => ({ row, i })).sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i).slice(0, Math.max(0, count)).map(x => x.i));
  // A header with none of its tasks kept is noise; give its place back.
  for (const i of [...keep]) if (rows[i].kind === "header") {
    let j = i + 1, kept = false;
    for (; j < rows.length && rows[j].kind !== "header"; j++) if (keep.has(j)) kept = true;
    if (!kept) keep.delete(i);
  }
  const kept = rows.filter((_, i) => keep.has(i));
  return { rows: kept, hidden: rows.filter((row, i) => !keep.has(i) && row.kind !== "header").length };
}
/** Reserve an explicit overflow row only when the list does not fit. */
export function fitDock(snapshot: DockSnapshot, maxRows: number): DockRow[] {
  const total = snapshot.rows.length + (snapshot.more ?? 0);
  const count = total <= maxRows ? snapshot.rows.length : Math.max(0, maxRows - 1);
  const picked = prioritizeDock(snapshot.rows, count);
  const rows = [...picked.rows];
  const hidden = picked.hidden + (snapshot.more ?? 0);
  if (hidden && maxRows > 0) rows.push({ text: `+ ${hidden} more${snapshot.hint ? " · " + cleanText(snapshot.hint) : ""}`, tone: "muted" });
  return rows;
}
/** Physical-line budget shared by native and Egregore hosts. Keep task order; give active text spare lines first. */
export function layoutDock(snapshot: DockSnapshot, width: number, maxRows: number): DockRow[] {
  if (width <= 0 || maxRows <= 0) return [];
  // Rows past the budget, and the snapshot's own count of unlisted work, become one "+ N more" row.
  const source = fitDock(snapshot, maxRows);
  const groups = source.map(row => wrapTextWithAnsi(cleanText(row.text), Math.max(1, width - 2)));
  const budgets = groups.map(() => 1);
  let spare = Math.max(0, maxRows - groups.length);
  const order = groups.map((_, i) => i).sort((a, b) => Number(source[b].tone === "accent") - Number(source[a].tone === "accent"));
  for (const i of order) { const extra = Math.min(spare, groups[i].length - 1); budgets[i] += extra; spare -= extra; }
  const rows = groups.flatMap((lines, i) => lines.slice(0, budgets[i]).map((text, j) => ({
    tone: source[i].tone, kind: source[i].kind, ...(source[i].ref ? { ref: source[i].ref } : {}),
    text: j === budgets[i] - 1 && lines.length > budgets[i]
      ? truncateToWidth((j ? "  " : "") + text, Math.max(0, width - 2), "") + " …"
      : (j ? "  " : "") + text,
  })));
  const visible = rows.slice(0, maxRows).map(row => ({ ...row, text: truncateToWidth(row.text, width, "…") }));
  return visible;
}
export function isHost(value: unknown): value is DockHost {
  if (!value || typeof value !== "object") return false;
  const v = value as DockHost;
  return v.version === 1 && typeof v.sessionId === "string" && typeof v.available === "boolean" &&
    (v.colors === undefined || !!v.colors && ["text", "muted", "accent", "success", "warning", "error", "base", "panel"].every(
      (k) => /^#[0-9a-f]{6}$/i.test(v.colors![k as keyof DockColors] ?? "")));
}
