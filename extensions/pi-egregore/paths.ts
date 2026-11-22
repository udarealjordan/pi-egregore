import { askText } from "../../lib/dialogs.ts";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionEntry, SessionTreeNode, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Input, Key, Markdown, matchesKey, parseColor, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import { framePlacement, frameRows } from "../../lib/frame.ts";

/** Paths takes the composer's place at the bottom, like /btw and questions, so it never covers the chat. */
const PLACEMENT = framePlacement("input");
import { clean } from "./footer-state.ts";
import type { EgregoreState } from "./state.ts";

/** One of your messages, on the current path or on an alternative you rewound from. */
export type Turn = { id: string; parentId: string | null; text: string; at: number; label?: string; reply: string; leaf: string };
export type Fork = { turn: Turn; alternatives: Turn[] };
export type PathMap = { turns: Fork[]; leafId: string | null; path: { index: number; total: number } | undefined };

const textOf = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.filter((c: any) => c?.type === "text").map((c: any) => c.text ?? "").join(" ") : "";
const userText = (entry: SessionEntry): string | undefined =>
  entry.type === "message" && (entry as any).message?.role === "user" ? clean(textOf((entry as any).message.content)).replace(/\s+/g, " ").trim() : undefined;
/** A reply keeps its line breaks so the preview can render its markdown (tables, lists). */
const replyText = (entry: SessionEntry): string => {
  const content = (entry as any).message?.content;
  const raw = typeof content === "string" ? content : Array.isArray(content) ? content.filter((c: any) => c?.type === "text").map((c: any) => c.text ?? "").join("\n\n") : "";
  return stripVTControlCharacters(raw).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ").trim();
};
const time = (entry: SessionEntry) => Date.parse((entry as { timestamp?: string }).timestamp ?? "") || 0;

/** The session as a spine: your turns on the active path, each with the other paths that left from the same point. */
export function pathMap(tree: SessionTreeNode[], leafId: string | null): PathMap {
  const nodes = new Map<string, SessionTreeNode>(), parent = new Map<string, string | null>();
  const index = (node: SessionTreeNode, up: string | null) => { nodes.set(node.entry.id, node); parent.set(node.entry.id, up); node.children.forEach(child => index(child, node.entry.id)); };
  tree.forEach(root => index(root, null));
  const pathIds: string[] = [];
  for (let id = leafId; id; id = parent.get(id) ?? null) pathIds.unshift(id);
  const onPath = new Set(pathIds);
  // Follow a subtree to its newest leaf; describe it by its first user message and the reply after it.
  const describe = (node: SessionTreeNode): Turn | undefined => {
    let first: SessionTreeNode | undefined, reply = "", cursor: SessionTreeNode | undefined = node;
    while (cursor) {
      if (!first && userText(cursor.entry)) first = cursor;
      else if (first && !reply && cursor.entry.type === "message" && (cursor.entry as any).message?.role === "assistant") reply = replyText(cursor.entry);
      const next: SessionTreeNode | undefined = [...cursor.children].sort((a, b) => time(b.entry) - time(a.entry))[0];
      if (!next) break;
      cursor = next;
    }
    if (!first) return undefined;
    return { id: first.entry.id, parentId: parent.get(first.entry.id) ?? null, text: userText(first.entry)!, at: time(first.entry), label: first.label, reply, leaf: cursor!.entry.id };
  };
  const turns: Fork[] = [];
  let since = 0; // index in pathIds just after the previous user turn
  for (const [i, id] of pathIds.entries()) {
    const node = nodes.get(id)!, text = userText(node.entry);
    if (text === undefined) continue;
    // A rewind can fork at any entry between your previous message and this one.
    const forks = pathIds.slice(since, i + 1);
    since = i + 1;
    let reply = "";
    for (const later of pathIds.slice(i + 1)) {
      const entry = nodes.get(later)!.entry;
      if (userText(entry) !== undefined) break;
      if (entry.type === "message" && (entry as any).message?.role === "assistant") { const t = replyText(entry); if (t) reply = t; }
    }
    const up = parent.get(id) ?? null;
    const alternatives = forks.flatMap(f => { const p = parent.get(f) ?? null; return p ? nodes.get(p)!.children : tree; })
      .filter(s => !onPath.has(s.entry.id)).map(describe).filter((t): t is Turn => !!t).sort((a, b) => b.at - a.at);
    turns.push({ turn: { id, parentId: up, text, at: time(node.entry), label: node.label, reply, leaf: leafId ?? id }, alternatives });
  }
  const last = [...turns].reverse().find(f => f.alternatives.length);
  const path = last ? { index: [...last.alternatives, last.turn].sort((a, b) => a.at - b.at).indexOf(last.turn) + 1, total: last.alternatives.length + 1 } : undefined;
  return { turns, leafId, path };
}

const clock = (at: number) => at ? new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
const dayKey = (at: number) => at ? new Date(at).toDateString() : "";
/** "Today", "Yesterday", or "Thu 19 Nov" — so times across days are not ambiguous. */
export function dayLabel(at: number, now = Date.now()): string {
  if (!at) return "Earlier";
  const day = new Date(at), today = new Date(now);
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(day.toDateString()).getTime()) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : day.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}
/** Long file paths in a message keep only their last part, which is the part you recognize. */
export const shortenPaths = (text: string) => text.replace(/(?:~\/|\/)(?:[^\s/]+\/)+([^\s/]+)/g, "…/$1");
/** Gold marks /paths, so it never reads as chat or as the composer. */
export function pathsColor(theme: Theme) { return parseColor(theme.appearance === "light" ? "#8a6400" : "#e2b55a"); }
type Pick = { action: "go"; target: string } | { action: "edit"; turn: Turn } | { action: "label"; turn: Turn };

export class PathsPanel implements Component {
  private selected: number;
  private open = -1;
  private sub = 0;
  private search = new Input({ prompt: "", placeholder: "search your messages" });
  private searching = false;
  focused = false;
  constructor(private tui: TUI, private theme: Theme, private map: PathMap, private done: (pick?: Pick) => void) {
    this.selected = Math.max(0, map.turns.length - 1);
  }
  private visible(): number[] {
    const query = this.search.getValue().toLowerCase();
    return this.map.turns.map((_, i) => i).filter(i => !query || [this.map.turns[i].turn, ...this.map.turns[i].alternatives].some(t => t.text.toLowerCase().includes(query)));
  }
  invalidate(): void {}
  handleInput(data: string): void {
    const rows = this.visible();
    if (this.searching) {
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) { this.searching = false; if (matchesKey(data, Key.escape)) this.search.setValue(""); }
      else this.search.handleInput(data);
      this.selected = rows.includes(this.selected) ? this.selected : rows.at(-1) ?? 0;
      this.tui.requestRender(); return;
    }
    const fork = this.map.turns[this.selected];
    const step = (d: number) => { const at = rows.indexOf(this.selected); this.selected = rows[Math.max(0, Math.min(rows.length - 1, at + d))] ?? this.selected; this.open = -1; };
    if (matchesKey(data, Key.escape)) return this.open >= 0 ? (this.open = -1, this.tui.requestRender()) : this.done();
    if (matchesKey(data, Key.up)) { if (this.open >= 0) this.sub = Math.max(0, this.sub - 1); else step(-1); }
    else if (matchesKey(data, Key.down)) { if (this.open >= 0) this.sub = Math.min(fork.alternatives.length - 1, this.sub + 1); else step(1); }
    else if (matchesKey(data, Key.pageUp)) step(-10);
    else if (matchesKey(data, Key.pageDown)) step(10);
    else if (matchesKey(data, Key.right) && fork?.alternatives.length) { this.open = this.selected; this.sub = 0; }
    else if (matchesKey(data, Key.left)) this.open = -1;
    else if (data === "/") this.searching = true;
    else if (matchesKey(data, Key.enter) && fork) return this.done(this.open >= 0 ? { action: "go", target: fork.alternatives[this.sub].leaf } : { action: "go", target: this.replyEnd(this.selected) });
    else if (data === "e" && fork) return this.done({ action: "edit", turn: this.open >= 0 ? fork.alternatives[this.sub] : fork.turn });
    else if (data === "l" && fork) return this.done({ action: "label", turn: fork.turn });
    this.tui.requestRender();
  }
  /** "Go here" on your turn continues after its reply: the entry before your next turn. */
  private replyEnd(i: number): string {
    const next = this.map.turns[i + 1];
    return next ? next.turn.parentId ?? next.turn.id : this.map.leafId ?? this.map.turns[i].turn.id;
  }
  render(width: number): string[] {
    const theme = this.theme, gold = pathsColor(theme), inner = Math.max(20, width - 4);
    const list = this.visible();
    // The list: a day line whenever the day changes, then one row per message (all of them are yours).
    type Line = { text: string; turn?: number };
    const lines: Line[] = [];
    let day = "";
    for (const i of list) {
      const { turn, alternatives } = this.map.turns[i], chosen = i === this.selected && this.open < 0;
      if (dayKey(turn.at) !== day) { day = dayKey(turn.at); lines.push({ text: theme.style(dayLabel(turn.at), { fg: gold, bold: true }) }); }
      const fork = alternatives.length ? theme.style(`⑂${alternatives.length}`, { fg: gold, bold: true }) : "";
      const right = [turn.label ? theme.style(`◆ ${turn.label}`, { fg: gold }) : "", fork, theme.fg("muted", clock(turn.at))].filter(Boolean).join("  ");
      const left = (chosen ? theme.style("›", { fg: gold, bold: true }) : " ") + theme.fg("muted", String(i + 1).padStart(3)) + "  ";
      const room = Math.max(4, inner - visibleWidth(left) - visibleWidth(right) - 2);
      const text = truncateToWidth(shortenPaths(turn.text), room, "…");
      const row = left + (chosen ? theme.style(text, { fg: "text", bold: true }) : theme.fg("text", text))
        + " ".repeat(Math.max(2, inner - visibleWidth(left) - visibleWidth(text) - visibleWidth(right))) + right;
      // The selected row is the brightest thing in the list, not the dimmest.
      lines.push({ text: chosen ? theme.bg("selectedBg", truncateToWidth(row, inner, "")) : row, turn: i });
      if (this.open === i) alternatives.forEach((alt, j) => {
        const on = j === this.sub, tail = theme.fg("muted", clock(alt.at));
        const body = truncateToWidth(`↳ ${shortenPaths(alt.text)}`, Math.max(4, inner - 8 - visibleWidth(tail)), "…");
        const altRow = (on ? theme.style("›", { fg: gold, bold: true }) : " ") + "      " + (on ? theme.style(body, { fg: "text", bold: true }) : theme.fg("muted", body))
          + " ".repeat(Math.max(1, inner - 7 - visibleWidth(body) - visibleWidth(tail))) + tail;
        lines.push({ text: on ? theme.bg("selectedBg", truncateToWidth(altRow, inner, "")) : altRow, turn: i });
      });
    }
    // Keep the selection in view, centered when the list is long.
    const listRoom = Math.max(3, PLACEMENT.rows(this.tui.terminal.rows) - 7); // preview and its rule take up to seven rows
    const at = Math.max(0, lines.findIndex(l => l.turn === this.selected));
    const start = Math.max(0, Math.min(at - Math.floor(listRoom / 2), lines.length - listRoom));
    const rows = lines.slice(start, start + listRoom).map(l => l.text);
    if (!list.length) rows.push(theme.fg("muted", this.map.turns.length ? "Nothing matches." : "No messages yet."));
    // Preview: the chosen message, then the start of its reply, rendered rather than raw markdown.
    const fork = this.map.turns[this.selected];
    const shown = this.open >= 0 && fork ? fork.alternatives[this.sub] : fork?.turn;
    rows.push(theme.fg("dim", "─".repeat(inner)));
    if (shown) {
      const asked = wrapTextWithAnsi(theme.style(shown.text, { fg: "text", bold: true }), inner).slice(0, 2);
      rows.push(...asked);
      // The reply gets whatever room the list leaves, at least four lines.
      const room = Math.max(4, PLACEMENT.rows(this.tui.terminal.rows) - rows.length - 1);
      const reply = shown.reply ? new Markdown(shown.reply, 0, 0, getMarkdownTheme()).render(inner).filter(l => l.trim()) : [];
      rows.push(...reply.slice(0, reply.length > room ? room - 1 : room));
      if (reply.length > room) rows.push(theme.fg("muted", "…"));
    }
    if (this.searching || this.search.getValue()) { this.search.focused = this.searching; rows.push(theme.style("/ ", { fg: gold, bold: true }) + (this.search.render(inner - 2)[0] ?? "")); }
    const where = this.map.path ? ` path ${this.map.path.index} of ${this.map.path.total} · ` : " ";
    // The footer lists exactly the keys that work on this row.
    const others = fork?.alternatives.length ?? 0;
    const hint = this.open >= 0
      ? " ↑↓ choose · ↵ switch to it · e edit & resend · ← back "
      : ` ↑↓ move · ↵ go here · e edit & resend${others ? ` · → ${others} other version${others > 1 ? "s" : ""}` : ""} · l label · / search · esc `;
    return frameRows({ theme, width, rows, inset: 1, color: gold, weight: PLACEMENT.weight,
      corners: { topLeft: theme.style(" Paths ", { fg: gold, bold: true }), topRight: theme.fg("muted", `${where}message ${this.selected + 1} of ${this.map.turns.length} `), bottomLeft: theme.fg("muted", hint) } });
  }
}

export function registerPaths(pi: ExtensionAPI, state: EgregoreState) {
  let label = "";
  const update = (ctx: ExtensionContext) => {
    try { const path = pathMap(ctx.sessionManager.getTree(), ctx.sessionManager.getLeafId()).path; label = path ? `${path.index}/${path.total}` : ""; }
    catch { label = ""; }
  };
  state.pathLabel = () => label;
  state.openPaths = () => pi.sendUserMessage("/paths", { expandPromptTemplates: true });
  pi.on("session_start", (_e, ctx) => update(ctx));
  pi.on("session_tree", (_e, ctx) => update(ctx));
  pi.on("agent_end", (_e, ctx) => update(ctx));
  pi.registerCommand("paths", {
    description: "See where you are in this session: your messages, the paths you rewound from, and labels",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== "tui") { ctx.ui.notify("/paths needs the interactive terminal.", "info"); return; }
      const map = pathMap(ctx.sessionManager.getTree(), ctx.sessionManager.getLeafId());
      const pick = await ctx.ui.custom<Pick | undefined>((tui, theme, _kb, done) => new PathsPanel(tui, theme, map, done),
        PLACEMENT.custom);
      if (!pick) return;
      try {
        if (pick.action === "label") {
          const next = await askText(ctx, "Label this message", pick.turn.label ?? "", { color: pathsColor(ctx.ui.theme), placeholder: "a short name; empty removes it" });
          if (next !== undefined) pi.setLabel(pick.turn.id, next.trim() || undefined);
        } else if (pick.action === "edit") {
          // Rewind to just before the message and put it back in the editor to edit and resend.
          if (pick.turn.parentId) await ctx.navigateTree(pick.turn.parentId, { summarize: false });
          ctx.ui.setEditorText(pick.turn.text);
        } else if (pick.target !== ctx.sessionManager.getLeafId()) await ctx.navigateTree(pick.target, { summarize: false });
      } catch (error) { ctx.ui.notify(`Paths: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
      update(ctx);
    },
  });
}
