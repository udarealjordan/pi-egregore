import { randomUUID } from "node:crypto";
import { buildSessionContext, convertToLlm, copyToClipboard, getMarkdownTheme, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, Markdown, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { framePlacement, frameRows } from "../../lib/frame.ts";

/** An aside is something you type into, so it takes the composer's place like a question. */
const PLACEMENT = framePlacement("input");
import { userFrameColor } from "./composer-style.ts";
import { hue } from "./theme-hues.ts";

/** Side questions ("asides"): asked about the session without entering its transcript. */
export const ASIDE_ENTRY = "pi-egregore:aside-v1";
/** `stopped`: you stopped it; `answer` keeps what had arrived. `error`: it failed; kept so you can see why. */
export type Exchange = { question: string; answer: string; at: number; model?: string; error?: string; stopped?: boolean };
export type Thread = { id: string; exchanges: Exchange[]; name?: string };
/** A thread's name: the one you gave it, or its first question shortened. */
export function threadName(thread: Thread): string {
  const raw = thread.name?.trim() || thread.exchanges[0]?.question || "New aside";
  const words = raw.replace(/\s+/g, " ").trim();
  return words.length > 40 ? words.slice(0, 39).trimEnd() + "…" : words;
}
type Done = { action: "close" } | { action: "fork"; exchange: Exchange };

export const ASIDE_PROMPT = "\n\n# Side question\nThe user is asking a quick side question about this session. Answer directly and briefly from the conversation so far. Do not continue the main task, call tools or make changes. If answering needs a tool, say what you would check instead. The main agent may still be working.";

/** Teal marks an aside so it never reads as the main chat. */
export function asideColor(theme: Theme) { return hue(theme, "teal"); }

type Message = ReturnType<typeof convertToLlm>[number];
/** Drop tool calls that have no result yet (the main agent may be mid-call); providers reject them. */
export function settledMessages(messages: Message[]): Message[] {
  const answered = new Set(messages.flatMap(m => m.role === "toolResult" ? [(m as { toolCallId: string }).toolCallId] : []));
  return messages.flatMap(m => {
    if (m.role !== "assistant" || !Array.isArray(m.content)) return [m];
    const content = m.content.filter(c => c.type !== "toolCall" || answered.has((c as { id: string }).id));
    return content.length ? [{ ...m, content } as Message] : [];
  });
}

/** The side request: the session's own prompt and context, then one user message carrying
 * the thread so far, the main agent's unfinished reply and the new question. */
export function asideRequest(ctx: ExtensionContext, thread: Exchange[], question: string, streaming = "") {
  const entries = ctx.sessionManager.getBranch();
  const session = buildSessionContext(entries, ctx.sessionManager.getLeafId());
  const earlier = thread.filter(e => e.answer && !e.error).map(e => `Q: ${e.question}\nA: ${e.answer}${e.stopped ? " (stopped early)" : ""}`).join("\n\n");
  const text = [
    earlier ? `Earlier side questions in this thread:\n${earlier}` : "",
    streaming.trim() ? `The main agent is still replying. Its text so far:\n${streaming.trim()}` : "",
    `Side question: ${question}`,
  ].filter(Boolean).join("\n\n");
  return {
    systemPrompt: ctx.getSystemPrompt() + ASIDE_PROMPT,
    messages: [...settledMessages(convertToLlm(session.messages)), { role: "user" as const, content: text, timestamp: Date.now() }],
  };
}

export function restoreThreads(ctx: ExtensionContext): Thread[] {
  const threads = new Map<string, Thread>();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== ASIDE_ENTRY) continue;
    const data = (entry as { data?: unknown }).data as { threadId?: unknown; exchange?: Partial<Exchange>; name?: unknown } | undefined;
    if (typeof data?.threadId !== "string") continue;
    const thread = threads.get(data.threadId) ?? { id: data.threadId, exchanges: [] };
    // A name entry renames the thread; the latest one wins.
    if (typeof data.name === "string") { thread.name = data.name.slice(0, 60) || undefined; threads.set(data.threadId, thread); continue; }
    const e = data.exchange;
    if (typeof e?.question !== "string" || typeof e.answer !== "string") continue;
    thread.exchanges.push({ question: e.question, answer: e.answer, at: typeof e.at === "number" ? e.at : 0, model: typeof e.model === "string" ? e.model : undefined,
      ...(typeof e.error === "string" ? { error: e.error } : {}), ...(e.stopped === true ? { stopped: true } : {}) });
    threads.set(data.threadId, thread);
  }
  // A thread whose name was cleared before anything was asked is gone.
  return [...threads.values()].filter(t => t.exchanges.length || t.name);
}

/** Where keys go. `ask`: typing always reaches the question line. `read`: arrows scroll
 * and single letters are actions. `name`: the rename field. Every state has a visible
 * keyboard way back (Tab, Esc), and focus changes never drop what you typed. */
export type AsideFocus = "ask" | "read" | "name";
/** Actions act on `exchange`: the answer you are looking at, not always the newest. */
type Actions = { copy: (exchange: Exchange) => Promise<string>; send: (exchange: Exchange) => string; fork: (exchange: Exchange) => void;
  close: () => void; rename: (name: string) => void; create: () => void; stop: (thread: Thread) => boolean };
const FLASH_MS = 1800;

/** One aside panel: a thread's exchanges, a question line, and actions in read mode. */
export class AsidePanel implements Component {
  private input = new Input({ prompt: "", placeholder: "Ask a follow-up…" });
  private nameInput = new Input({ prompt: "", placeholder: "Name this aside" });
  /** Lines scrolled back from the newest text; 0 follows the answer as it streams. */
  private scroll = 0;
  private maxScroll = 0;
  private lastLength = 0;
  /** The exchange at the bottom of the view, set by render. */
  private viewed: Exchange | undefined;
  private flashText = "";
  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  focus: AsideFocus = "ask";
  private before: Exclude<AsideFocus, "name"> = "ask";
  focused = false;
  constructor(private tui: TUI, private theme: Theme, private threads: () => Thread[], private index: { value: number },
    private pending: (thread: Thread) => boolean, private model: () => string, private ask: (question: string) => void, private actions: Actions) {
    this.input.onSubmit = value => { if (value.trim()) { this.input.setValue(""); this.scroll = 0; this.ask(value.trim()); } };
    this.nameInput.onSubmit = () => this.saveName();
  }
  private thread(): Thread | undefined { return this.threads()[this.index.value]; }
  /** A short acknowledgement in the footer that clears itself, so the key hints come back. */
  private flash(text: string): void {
    this.flashText = text;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => { this.flashText = ""; this.flashTimer = undefined; this.tui.requestRender(); }, FLASH_MS);
    this.flashTimer.unref?.();
  }
  dispose(): void { if (this.flashTimer) clearTimeout(this.flashTimer); this.flashTimer = undefined; }
  private saveName(): void {
    const name = this.nameInput.getValue().trim();
    this.actions.rename(name); this.focus = this.before;
    this.flash(name ? `Named “${truncateToWidth(name, 24, "…")}”` : "Name cleared");
  }
  /** The answer in view, or the nearest answered one above it. */
  private answered(): Exchange | undefined {
    const list = this.thread()?.exchanges ?? [];
    const at = this.viewed ? list.indexOf(this.viewed) : list.length - 1;
    return list.slice(0, at + 1).reverse().find(e => e.answer && !e.error);
  }
  private stop(): void {
    const thread = this.thread();
    if (thread && this.actions.stop(thread)) this.flash("Stopped");
  }
  private scrollBy(lines: number): void { this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + lines)); }
  private switchThread(step: number): void {
    const count = this.threads().length;
    if (count > 1) { this.index.value = (this.index.value + step + count) % count; this.scroll = 0; }
  }
  invalidate(): void {}
  handleMouse(event: TuiMouseEvent) {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    this.scrollBy(-event.wheelDelta * 3); this.tui.requestRender();
    return { handled: true };
  }
  handleInput(data: string): void {
    this.handleKey(data);
    this.tui.requestRender();
  }
  private handleKey(data: string): void {
    // Paging works the same everywhere.
    if (matchesKey(data, Key.pageUp)) return this.scrollBy(5);
    if (matchesKey(data, Key.pageDown)) return this.scrollBy(-5);
    if (this.focus === "name") {
      if (matchesKey(data, Key.escape)) { this.focus = this.before; return; }
      // Leaving the field by Tab or an arrow keeps the name, like Enter.
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.up) || matchesKey(data, Key.down)) return this.saveName();
      return this.nameInput.handleInput(data);
    }
    if (this.focus === "read") {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.tab) || matchesKey(data, Key.enter)) { this.focus = "ask"; return; }
      if (matchesKey(data, Key.up)) return this.scrollBy(1);
      if (matchesKey(data, Key.down)) { if (this.scroll === 0) this.focus = "ask"; else this.scrollBy(-1); return; }
      if (matchesKey(data, Key.home) || data === "g") { this.scroll = this.maxScroll; return; }
      if (matchesKey(data, Key.end) || data === "G") { this.scroll = 0; return; }
      if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) return this.switchThread(matchesKey(data, Key.left) ? -1 : 1);
      if (data === "n") { this.actions.create(); this.scroll = 0; this.focus = "ask"; return; }
      if (data === "r" && this.thread()) {
        this.before = "read"; this.focus = "name"; this.nameInput.setValue(this.thread()!.name ?? ""); return;
      }
      if (data === "s") return this.stop();
      if (data === "c" || data === "i" || data === "f") {
        const exchange = this.answered();
        if (!exchange) return this.flash("No answer yet");
        if (data === "c") { void this.actions.copy(exchange).then(message => { this.flash(message); this.tui.requestRender(); }); return; }
        if (data === "i") return this.flash(this.actions.send(exchange));
        return this.actions.fork(exchange);
      }
      // Any other typing starts a question.
      if (data.length === 1 && data >= " " && data !== "\x7f") { this.focus = "ask"; return this.input.handleInput(data); }
      return;
    }
    const empty = !this.input.getValue();
    // Esc goes back one step: clear the line, then stop this aside's answer, then close.
    if (matchesKey(data, Key.escape)) {
      const thread = this.thread();
      if (!empty) this.input.setValue("");
      else if (thread && this.pending(thread)) this.stop();
      else this.actions.close();
      return;
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, Key.up)) { this.focus = "read"; return; }
    if (empty && (matchesKey(data, Key.left) || matchesKey(data, Key.right))) return this.switchThread(matchesKey(data, Key.left) ? -1 : 1);
    this.input.handleInput(data);
  }
  private hint(count: number): string {
    if (this.focus === "name") return "↵ save · esc cancel";
    const answering = !!this.thread() && this.pending(this.thread()!);
    if (this.focus === "read") return `↑↓ scroll · c copy · i send to chat · f fork · r rename · n new${answering ? " · s stop" : ""}${count > 1 ? " · ←→ asides" : ""} · tab ask`;
    return `↵ ask · tab actions${count > 1 ? " · ←→ asides" : ""} · esc ${this.input.getValue() ? "clear" : answering ? "stop" : "close"}`;
  }
  render(width: number): string[] {
    const theme = this.theme, color = asideColor(theme), inner = Math.max(10, width - 4);
    const thread = this.thread(), count = this.threads().length;
    const body: string[] = [], starts: number[] = [];
    for (const [i, e] of (thread?.exchanges ?? []).entries()) {
      if (i) body.push("");
      starts.push(body.length);
      for (const line of wrapTextWithAnsi(e.question, inner - 2)) body.push(theme.style("❯ ", { fg: userFrameColor(theme), bold: true }) + theme.fg("text", line));
      body.push("");
      if (e.error) body.push(...wrapTextWithAnsi(theme.fg("error", e.error), inner));
      else if (e.answer) body.push(...new Markdown(e.answer, 0, 0, getMarkdownTheme()).render(inner));
      else if (!e.stopped) body.push(theme.fg("dim", "Thinking…"));
      if (e.stopped) body.push(theme.fg("dim", "Stopped."));
    }
    if (!body.length) body.push(theme.fg("dim", thread?.name ? "No side questions here yet. Type one below." : "Type a side question below."));
    // Follow the newest text, or hold your place while an answer grows below it.
    const room = Math.max(4, PLACEMENT.rows(this.tui.terminal.rows) - 2); // minus the question line and its gap
    if (this.scroll > 0 && body.length > this.lastLength) this.scroll += body.length - this.lastLength;
    this.lastLength = body.length;
    this.maxScroll = Math.max(0, body.length - room);
    this.scroll = Math.min(this.scroll, this.maxScroll);
    const end = body.length - this.scroll, start = Math.max(0, end - room);
    const shown = body.slice(start, end);
    const list = thread?.exchanges ?? [];
    this.viewed = list[starts.filter(at => at < end).length - 1];
    this.input.focused = this.focused && this.focus === "ask";
    this.nameInput.focused = this.focused && this.focus === "name";
    const naming = this.focus === "name";
    const prompt = naming ? theme.style("name ", { fg: color, bold: true })
      : theme.style("❯ ", { fg: userFrameColor(theme), bold: this.focus === "ask" });
    const line = naming ? this.nameInput.render(inner - 5)[0] : this.input.render(inner - 2)[0];
    const rows = [...shown, "", prompt + (this.focus === "read" ? theme.fg("dim", stripVTControlCharacters(line ?? "")) : line ?? "")];
    const nav = count > 1 ? theme.fg("muted", ` ‹ ${this.index.value + 1} of ${count} › `) : "";
    const position = [start > 0 ? `↑ ${start}` : "", this.scroll > 0 ? `↓ ${this.scroll}` : ""].filter(Boolean).join(" · ");
    const hint = this.flashText ? theme.fg("accent", ` ${this.flashText} `) : theme.fg("dim", ` ${this.hint(count)} `);
    const title = thread && (thread.name || thread.exchanges.length) ? ` aside · ${truncateToWidth(threadName(thread), Math.max(8, Math.floor(width / 3)), "…")} ` : " aside ";
    return frameRows({ theme, width, rows, inset: 1, color, weight: PLACEMENT.weight,
      corners: { topLeft: theme.style(title, { fg: color, bold: true }), topCenter: nav,
        topRight: theme.fg("muted", ` ${truncateToWidth(this.model(), 24, "…")}${thread && this.pending(thread) ? " · answering" : this.threads().some(t => this.pending(t)) ? " · answering elsewhere" : ""} `), bottomLeft: hint,
        ...(position ? { bottomRight: theme.fg("muted", ` ${position} `) } : {}) } });
  }
}

export function registerAside(pi: ExtensionAPI) {
  let threads: Thread[] = [];
  let streaming = "", refresh: (() => void) | undefined;
  /** Answers still arriving, each stoppable on its own. Closing the panel does not stop them. */
  const running = new Map<Exchange, AbortController>();
  const pending = (thread: Thread) => thread.exchanges.some(e => running.has(e));
  const stop = (thread: Thread) => {
    const active = thread.exchanges.filter(e => running.has(e));
    for (const e of active) running.get(e)!.abort();
    return active.length > 0;
  };
  const index = { value: 0 };
  /** Bumped when the session or branch changes: an answer from before is stopped and not saved here. */
  let generation = 0;
  const reset = (ctx?: ExtensionContext) => {
    generation++;
    for (const controller of running.values()) controller.abort();
    threads = ctx ? restoreThreads(ctx) : []; index.value = Math.max(0, threads.length - 1);
  };
  pi.on("session_start", (_e, ctx) => reset(ctx));
  pi.on("session_tree", (_e, ctx) => reset(ctx));
  pi.on("session_shutdown", () => reset());
  // The main agent's unfinished reply, so a side question can see what it is saying now.
  pi.on("message_update", event => {
    const partial = (event as { assistantMessageEvent?: { partial?: { content?: Array<{ type: string; text?: string }> } } }).assistantMessageEvent?.partial;
    if (partial?.content) streaming = partial.content.filter(c => c.type === "text").map(c => c.text ?? "").join("");
  });
  pi.on("message_end", () => { streaming = ""; });

  async function answer(ctx: ExtensionContext, thread: Thread, question: string) {
    const model = ctx.model;
    const exchange: Exchange = { question, answer: "", at: Date.now(), model: model?.name ?? model?.id };
    const earlier = [...thread.exchanges];
    const controller = new AbortController(), born = generation;
    thread.exchanges.push(exchange); running.set(exchange, controller); refresh?.();
    try {
      if (!model) throw new Error("No model is selected.");
      const stream = ctx.modelRegistry.streamSimple(model, asideRequest(ctx, earlier, question, streaming), { maxTokens: 2000, signal: controller.signal });
      for await (const event of stream) {
        if (controller.signal.aborted) break;
        if (event.type === "text_delta") { exchange.answer += event.delta; refresh?.(); }
      }
      if (controller.signal.aborted) exchange.stopped = true;
      else {
        const result = await stream.result();
        if (result.stopReason === "aborted") exchange.stopped = true;
        else if (result.stopReason === "error" && !exchange.answer) throw new Error(result.errorMessage ?? "The model returned an error.");
        else if (!exchange.answer.trim()) exchange.answer = "_No answer._";
      }
    } catch (error) {
      if (controller.signal.aborted) exchange.stopped = true;
      else exchange.error = error instanceof Error ? error.message : String(error);
    } finally {
      running.delete(exchange);
      // Every outcome is kept, so a reload shows the same thread you saw — on the branch it was asked on.
      if (born === generation) pi.appendEntry(ASIDE_ENTRY, { threadId: thread.id, exchange: { question, answer: exchange.answer, at: exchange.at, model: exchange.model,
        ...(exchange.error ? { error: exchange.error } : {}), ...(exchange.stopped ? { stopped: true } : {}) } });
      refresh?.();
    }
  }

  /** A fresh thread, reusing the current one if it is still empty and unnamed. */
  function create(): Thread {
    const current = threads[index.value];
    if (current && !current.exchanges.length && !current.name) return current;
    const thread: Thread = { id: randomUUID(), exchanges: [] };
    threads.push(thread); index.value = threads.length - 1;
    return thread;
  }
  /** Empty, unnamed threads exist only while the panel is open. */
  function prune() {
    const current = threads[index.value];
    threads = threads.filter(t => t.exchanges.length || t.name);
    const kept = current ? threads.indexOf(current) : -1;
    index.value = kept >= 0 ? kept : Math.max(0, threads.length - 1);
  }
  async function open(ctx: ExtensionCommandContext, question: string) {
    // "/btw @name" reopens a thread by name (or the start of one).
    if (question.startsWith("@")) {
      const wanted = question.slice(1).trim().toLowerCase();
      const found = [...threads.keys()].reverse().find(i => threadName(threads[i]).toLowerCase().startsWith(wanted));
      if (found === undefined) { ctx.ui.notify(`No aside named “${question.slice(1).trim()}”.`, "info"); return; }
      index.value = found; question = "";
    }
    let thread = threads[index.value];
    if (question || !thread) thread = create();
    if (question) void answer(ctx, thread, question);
    const done = await ctx.ui.custom<Done>((tui, theme, _kb, finish) => {
      const panel = new AsidePanel(tui, theme, () => threads, index, pending, () => ctx.model?.name ?? ctx.model?.id ?? "no model",
        follow => { const current = threads[index.value]; if (current) void answer(ctx, current, follow); },
        {
          copy: async exchange => {
            try { await copyToClipboard(exchange.answer); return "Copied"; } catch { return "Copy unavailable here"; }
          },
          send: exchange => {
            const text = `On the side I asked: ${exchange.question}\n\nThe answer was:\n${exchange.answer}`;
            if (ctx.isIdle()) pi.sendUserMessage(text); else pi.sendUserMessage(text, { deliverAs: "followUp" });
            return ctx.isIdle() ? "Sent to the chat" : "Queued for the chat";
          },
          fork: exchange => { panel.dispose(); finish({ action: "fork", exchange }); },
          stop,
          rename: name => {
            const current = threads[index.value]; if (!current) return;
            current.name = name || undefined;
            pi.appendEntry(ASIDE_ENTRY, { threadId: current.id, name });
          },
          create: () => { create(); },
          close: () => { panel.dispose(); finish({ action: "close" }); },
        });
      refresh = () => tui.requestRender();
      return panel;
    }, PLACEMENT.custom);
    prune();
    // Like a question, the aside takes the composer's place, so nothing is half covered;
    // the composer and its draft come back when it closes.
    refresh = undefined;
    if (done?.action !== "fork") return;
    // Fork: a new session from here, continuing with tools from the side answer.
    const last = done.exchange;
    const leaf = ctx.sessionManager.getLeafId();
    if (!last || !leaf) return;
    try {
      if (!ctx.isIdle()) { ctx.ui.notify("Fork waits for the current run to finish.", "info"); await ctx.waitForIdle(); }
      await ctx.fork(leaf, { position: "at", withSession: async next => {
        await next.sendUserMessage(`Earlier, on the side, I asked: ${last.question}\n\nThe answer was:\n${last.answer}\n\nLet's continue from there.`);
      } });
    } catch (error) { ctx.ui.notify(`Fork failed: ${error instanceof Error ? error.message : String(error)}`, "warning"); }
  }

  for (const name of ["btw", "aside"]) pi.registerCommand(name, {
    description: name === "btw" ? "Ask a side question without adding to the chat. /btw reopens the last one, /btw @name a named one" : "Same as /btw",
    getArgumentCompletions: (prefix: string) => prefix.startsWith("@")
      ? [...threads].reverse().map(t => `@${threadName(t)}`).filter(v => v.toLowerCase().startsWith(prefix.toLowerCase())).map(v => ({ value: v, label: v }))
      : null,
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") { ctx.ui.notify("/btw needs the interactive terminal.", "info"); return; }
      await open(ctx, args.trim());
    },
  });
}
