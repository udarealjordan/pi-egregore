import { randomUUID } from "node:crypto";
import { cleanText } from "pi-agent-contracts/dock";
import { emptyPlan, restorePlan, mutate, progressText, contextSummary, type Plan, type Mutation, type NewTask } from "./state.ts";

// Keep the entry key: older readers see a newer version and fail closed instead of restoring stale data.
export const BOOK_ENTRY = "pi-tasks:plans-v2";
export const COMPLETION_MS = 4000;
export const MAX_PLANS = 100;
type Actor = "agent" | "user";
export interface SavedPlan {
  id: string; title: string; state: Plan; createdAt: number; updatedAt: number;
  closedAt: number | null; archivedAt: number | null; archivedBy: Actor | null;
}
export interface PlanBook {
  version: 4; revision: string; nextPlanId: number; selectedId: string | null; plans: SavedPlan[]; userCleared: boolean;
}
export type BookMutation = { op: "create"; title: string; items?: NewTask[] }
  | { op: "select" | "archive" | "restore"; planId: string }
  | { op: "rename"; planId: string; title: string }
  | { op: "task"; planId?: string; mutation: Mutation };
export const isClosed = (plan: Plan) => plan.tasks.length > 0 && plan.tasks.every((t) => t.status === "done" || t.status === "cancelled");
export const isPlanClosed = (p: SavedPlan) => isClosed(p.state);
export const selectedPlan = (book: PlanBook) => book.plans.find((p) => p.id === book.selectedId);
export function emptyBook(): PlanBook {
  return { version: 4, revision: randomUUID(), nextPlanId: 1, selectedId: null, plans: [], userCleared: false };
}
function title(value: unknown): string {
  if (typeof value !== "string") throw new Error("Plan title must be text.");
  const result = cleanText(value).trim();
  if (!result || result.length > 120) throw new Error("Plan title must be 1–120 characters.");
  return result;
}
/** Deterministic in-memory migration; no session writes merely from opening/resuming. */
export function migratePlan(value: unknown): PlanBook {
  const state = restorePlan(value);
  const times = state.tasks.map((t) => t.updatedAt);
  const updatedAt = Math.max(0, ...times);
  return { version: 4, revision: state.revision, nextPlanId: 2, selectedId: "p1", userCleared: state.userCleared,
    plans: [{ id: "p1", title: "Earlier session plan", state, createdAt: times.length ? Math.min(...times) : 0,
      updatedAt, closedAt: isClosed(state) ? updatedAt : null, archivedAt: null, archivedBy: null }] };
}
export function restoreBook(value: unknown): PlanBook {
  if (!value || typeof value !== "object" || JSON.stringify(value).length > 2_000_000) throw new Error("Invalid plan library.");
  const b = value as Omit<PlanBook, "version"> & { version: number };
  if (![2, 3, 4].includes(b.version) || typeof b.revision !== "string" || !/^[\w-]{1,80}$/.test(b.revision) || !Number.isSafeInteger(b.nextPlanId) ||
    b.nextPlanId < 1 || !Array.isArray(b.plans) || b.plans.length > MAX_PLANS || typeof b.userCleared !== "boolean" ||
    !(b.selectedId === null || typeof b.selectedId === "string")) throw new Error("Unsupported or invalid plan library.");
  const timestamp = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const plans = b.plans.map((p): SavedPlan => {
    if (!p || !/^p[1-9]\d*$/.test(p.id) || Number(p.id.slice(1)) >= b.nextPlanId || !timestamp(p.createdAt) || !timestamp(p.updatedAt) ||
      !(p.closedAt === null || timestamp(p.closedAt)) || !(p.archivedAt === null || timestamp(p.archivedAt)) ||
      !(p.archivedBy === null || p.archivedBy === "agent" || p.archivedBy === "user") || (p.archivedAt === null) !== (p.archivedBy === null)) throw new Error("Invalid saved plan.");
    const state = restorePlan(p.state);
    // Versions 2 and 3 carried a requirement ledger. It is retired; closure now follows the checklist.
    const restored = { id: p.id, title: title(p.title), state, createdAt: p.createdAt, updatedAt: p.updatedAt,
      closedAt: p.closedAt, archivedAt: p.archivedAt, archivedBy: p.archivedBy };
    if (isPlanClosed(restored) !== (p.closedAt !== null)) throw new Error("Invalid plan completion state.");
    return restored;
  });
  if (new Set(plans.map((p) => p.id)).size !== plans.length) throw new Error("Duplicate plan IDs.");
  if (b.selectedId !== null && !plans.some((p) => p.id === b.selectedId && p.archivedAt === null)) throw new Error("Invalid current plan.");
  return { version: 4, revision: b.revision, nextPlanId: b.nextPlanId, selectedId: b.selectedId, userCleared: b.userCleared, plans };
}
/**
 * The revision is an optional snapshot assertion: a caller that holds a rendered or read view may
 * pass it to fail closed when the library moved. Omitting it applies the command to live state,
 * which already validates selection, ids, dependencies, outcomes and user-cleared boundaries.
 */
export function mutateBook(base: PlanBook, revision: string | undefined, action: BookMutation, actor: Actor, now = Date.now()): PlanBook {
  if (revision !== undefined && revision !== base.revision) throw new Error("The plan changed. Read tasks again before updating; preserve the user's edits.");
  const book = structuredClone(base);
  const create = (name: string, items: NewTask[] = []) => {
    if (actor === "agent" && book.userCleared) throw new Error("The user cleared the plan. Do not recreate it; /tasks new or /tasks add unlocks creation.");
    if (book.plans.length >= MAX_PLANS) throw new Error(`This session has ${MAX_PLANS} saved plans. Start a new session; history is never silently discarded.`);
    let state = emptyPlan();
    if (items.length) state = mutate(state, state.revision, { op: "add", items }, actor, now);
    const p: SavedPlan = { id: `p${book.nextPlanId++}`, title: title(name), state, createdAt: now, updatedAt: now, closedAt: null, archivedAt: null, archivedBy: null };
    book.plans.push(p); book.selectedId = p.id;
    if (actor === "user") book.userCleared = false;
    return p;
  };
  if (action.op === "create") create(action.title, action.items);
  else {
    let p = book.plans.find((p) => p.id === (action.planId ?? book.selectedId));
    // Backward-compatible first add, but never silently create over a nonempty history/library.
    if (!p && action.op === "task" && action.mutation.op === "add" && !action.planId && !book.plans.length) p = create("Session plan");
    if (!p) throw new Error("No matching current plan. Use tasks plans, then select a plan or create a named one.");
    if (action.op === "select" || action.op === "restore") {
      if (action.op === "restore") {
        if (actor !== "user") throw new Error("Only the user can restore an archived plan with /tasks.");
        p.archivedAt = null; p.archivedBy = null;
      }
      if (p.archivedAt !== null) throw new Error("This plan is archived. The user can restore it with /tasks; do not recreate it.");
      book.selectedId = p.id;
    } else if (action.op === "archive") {
      if (actor === "agent" && !isPlanClosed(p)) throw new Error("Only the user can archive an unfinished plan. Keep it in history when creating another plan.");
      if (p.archivedAt === null) { p.archivedAt = now; p.archivedBy = actor; }
      if (book.selectedId === p.id) book.selectedId = null;
    } else if (action.op === "rename") {
      if (p.archivedAt !== null && actor === "agent") throw new Error("Archived plans are read-only for the agent.");
      p.title = title(action.title); p.updatedAt = now;
    } else if (action.op === "task") {
      if (p.archivedAt !== null || p.id !== book.selectedId) throw new Error("Select this plan before editing it. Archived plans require user restoration.");
      p.state = mutate(p.state, p.state.revision, action.mutation, actor, now);
      p.updatedAt = now;
      if (action.mutation.op === "clear") book.userCleared = true;
      p.closedAt = isPlanClosed(p) ? p.closedAt ?? now : null;
      if (actor === "user" && action.mutation.op === "add") book.userCleared = false;
    }
  }
  book.revision = randomUUID();
  if (JSON.stringify(book).length > 2_000_000) throw new Error("Plan library is too large. Shorten notes or start a new session; history was not discarded.");
  return book;
}
/** A compatibility/result view. Writes may pass the library revision, not an individual plan's old revision. */
export function resultPlan(book: PlanBook, p = selectedPlan(book)): Plan {
  return p ? { ...structuredClone(p.state), revision: book.revision } : { version: 1, revision: book.revision, nextId: 1, tasks: [], userCleared: book.userCleared };
}
export function planInfo(p: SavedPlan, book: PlanBook) {
  return { id: p.id, title: p.title, current: book.selectedId === p.id,
    state: p.archivedAt !== null ? "archived" : isPlanClosed(p) ? p.state.tasks.every((t) => t.status === "done") ? "completed" : "closed" : "open", counts: progressText(p.state),
    createdAt: p.createdAt, updatedAt: p.updatedAt };
}
export function bookContext(book: PlanBook): string {
  const current = selectedPlan(book);
  const others = [...book.plans].reverse().filter((p) => p.id !== current?.id && p.archivedAt === null && !isPlanClosed(p));
  return `Plan library: ${book.plans.length} saved. ` +
    (current ? `Current plan ${JSON.stringify({ id: current.id, title: current.title })}.\n${contextSummary(resultPlan(book))}` :
      `No current plan. ${book.userCleared ? "The user cleared the plan; only /tasks new or /tasks add unlocks creation." : "Use create with a concise title for substantial new work."}`) +
    (others.length ? `\nOther unfinished plans (paused, not authorization to continue): ${JSON.stringify(others.slice(0, 5).map((p) => planInfo(p, book)))}${others.length > 5 ? " · more in tasks plans" : ""}` : "") +
    "\nStart a new plan for a new substantial request and update the current one for a follow-up. Keep earlier plans and never recreate one the user archived or cleared. A paused plan is not permission to continue it.";
}
