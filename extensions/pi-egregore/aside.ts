import { randomUUID } from "node:crypto";
import { buildSessionContext, convertToLlm, copyToClipboard, getMarkdownTheme, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, Markdown, matchesKey, parseColor, truncateToWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import { framePlacement, frameRows } from "../../lib/frame.ts";

/** An aside is something you type into, so it takes the composer's place like a question. */
const PLACEMENT = framePlacement("input");
import { userFrameColor } from "./composer-style.ts";

/** Side questions ("asides"): asked about the session without entering its transcript. */
export const ASIDE_ENTRY = "pi-egregore:aside-v1";
export type Exchange = { question: string; answer: string; at: number; model?: string; error?: string };
export type Thread = { id: string; exchanges: Exchange[]; name?: string };
/** A thread's name: the one you gave it, or its first question shortened. */
export function threadName(thread: Thread): string {
  const raw = thread.name?.trim() || thread.exchanges[0]?.question || "New aside";
  const words = raw.replace(/\s+/g, " ").trim();
  return words.length > 40 ? words.slice(0, 39).trimEnd() + "…" : words;
}
type Done = { action: "close" } | { action: "fork"; thread: Thread };

export const ASIDE_PROMPT = "\n\n# Side question\nThe user is asking a quick side question about this session. Answer directly and briefly from the conversation so far. Do not continue the main task, call tools or make changes. If answering needs a tool, say what you would check instead. The main agent may still be working.";

/** Teal marks an aside so it never reads as the main chat. */
export function asideColor(theme: Theme) { return parseColor(theme.appearance === "light" ? "#00727a" : "#5fd4d0"); }

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
  const earlier = thread.filter(e => e.answer).map(e => `Q: ${e.question}\nA: ${e.answer}`).join("\n\n");
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
    thread.exchanges.push({ question: e.question, answer: e.answer, at: typeof e.at === "number" ? e.at : 0, model: typeof e.model === "string" ? e.model : undefined });
    threads.set(data.threadId, thread);
  }
  return [...threads.values()];
}

/** One aside panel: a thread's exchanges, a follow-up line and single-key actions. */
class AsidePanel implements Component {
  private input = new Input({ prompt: "", placeholder: "Ask a follow-up…" });
  private scroll = 0;
  private flash = "";
  private naming = false;
  private nameInput = new Input({ prompt: "", placeholder: "Name this aside" });
  focused = false;
  constructor(private tui: TUI, private theme: Theme, private threads: () => Thread[], private index: { value: number },
    private busy: () => boolean, private model: () => string, private ask: (question: string) => void,
    private actions: { copy: () => Promise<string>; send: () => string; fork: () => void; close: () => void; rename: (name: string) => void }) {
    this.input.onSubmit = value => { if (value.trim()) { this.input.setValue(""); this.scroll = 0; this.ask(value.trim()); } };
    this.nameInput.onSubmit = value => { this.naming = false; this.actions.rename(value.trim()); this.flash = value.trim() ? "Named" : "Name cleared"; this.tui.requestRender(); };
  }
  private thread(): Thread | undefined { return this.threads()[this.index.value]; }
  invalidate(): void {}
  handleInput(data: string): void {
    this.flash = "";
    if (this.naming) {
      if (matchesKey(data, Key.escape)) this.naming = false; else this.nameInput.handleInput(data);
      this.tui.requestRender(); return;
    }
    const empty = !this.input.getValue();
    if (matchesKey(data, Key.escape)) return this.actions.close();
    if (empty && data === "n" && this.thread()) {
      this.naming = true; this.nameInput.setValue(this.thread()!.name ?? ""); this.tui.requestRender(); return;
    }
    if (empty && (data === "c" || data === "i" || data === "f")) {
      const thread = this.thread();
      if (!thread?.exchanges.some(e => e.answer)) { this.flash = "No answer yet"; this.tui.requestRender(); return; }
      if (data === "c") { void this.actions.copy().then(message => { this.flash = message; this.tui.requestRender(); }); return; }
      if (data === "i") { this.flash = this.actions.send(); this.tui.requestRender(); return; }
      return this.actions.fork();
    }
    if (empty && (matchesKey(data, Key.left) || matchesKey(data, Key.right))) {
      const count = this.threads().length;
      if (count > 1) { this.index.value = (this.index.value + (matchesKey(data, Key.left) ? -1 : 1) + count) % count; this.scroll = 0; }
      this.tui.requestRender(); return;
    }
    if (matchesKey(data, Key.pageUp)) { this.scroll += 5; this.tui.requestRender(); return; }
    if (matchesKey(data, Key.pageDown)) { this.scroll = Math.max(0, this.scroll - 5); this.tui.requestRender(); return; }
    this.input.handleInput(data);
    this.tui.requestRender();
  }
  render(width: number): string[] {
    const theme = this.theme, color = asideColor(theme), inner = Math.max(10, width - 4);
    const thread = this.thread(), count = this.threads().length;
    const body: string[] = [];
    for (const [i, e] of (thread?.exchanges ?? []).entries()) {
      if (i) body.push("");
      for (const line of wrapTextWithAnsi(e.question, inner - 2)) body.push(theme.style("❯ ", { fg: userFrameColor(theme), bold: true }) + theme.fg("text", line));
      body.push("");
      if (e.error) body.push(...wrapTextWithAnsi(theme.fg("error", e.error), inner));
      else if (e.answer) body.push(...new Markdown(e.answer, 0, 0, getMarkdownTheme()).render(inner));
      else body.push(theme.fg("dim", "Thinking…"));
    }
    if (!body.length) body.push(theme.fg("dim", "No side questions yet. Type one below."));
    // Follow the newest text unless scrolled back; keep within a bounded height.
    const room = Math.max(4, PLACEMENT.rows(this.tui.terminal.rows) - 2); // minus the input line and its gap
    const end = Math.max(0, body.length - Math.min(this.scroll, Math.max(0, body.length - room)));
    const shown = body.slice(Math.max(0, end - room), end);
    this.input.focused = this.focused && !this.naming;
    this.nameInput.focused = this.focused && this.naming;
    const prompt = this.naming ? theme.style("name ", { fg: color, bold: true }) : theme.style("❯ ", { fg: userFrameColor(theme), bold: true });
    const line = this.naming ? this.nameInput.render(inner - 5)[0] : this.input.render(inner - 2)[0];
    const rows = [...shown, "", prompt + (line ?? "")];
    const nav = count > 1 ? theme.fg("muted", ` ‹ ${this.index.value + 1} of ${count} › `) : "";
    const hint = this.flash ? theme.fg("accent", ` ${this.flash} `)
      : this.naming ? theme.fg("dim", " ↵ save name · esc cancel ")
      : theme.fg("dim", ` ↵ ask · c copy · i send to chat · f fork · n name${count > 1 ? " · ←→ asides" : ""} · esc close `);
    const title = thread && (thread.name || thread.exchanges.length) ? ` aside · ${truncateToWidth(threadName(thread), Math.max(8, Math.floor(width / 3)), "…")} ` : " aside ";
    return frameRows({ theme, width, rows, inset: 1, color, weight: PLACEMENT.weight,
      corners: { topLeft: theme.style(title, { fg: color, bold: true }), topCenter: nav,
        topRight: theme.fg("muted", ` ${truncateToWidth(this.model(), 24, "…")}${this.busy() ? " · answering" : ""} `), bottomLeft: hint } });
  }
}

export function registerAside(pi: ExtensionAPI) {
  let threads: Thread[] = [];
  let streaming = "", busy = false, refresh: (() => void) | undefined;
  const index = { value: 0 };
  pi.on("session_start", (_e, ctx) => { threads = restoreThreads(ctx); index.value = Math.max(0, threads.length - 1); });
  pi.on("session_tree", (_e, ctx) => { threads = restoreThreads(ctx); index.value = Math.max(0, threads.length - 1); });
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
    thread.exchanges.push(exchange); busy = true; refresh?.();
    try {
      if (!model) throw new Error("No model is selected.");
      const stream = ctx.modelRegistry.streamSimple(model, asideRequest(ctx, earlier, question, streaming), { maxTokens: 2000 });
      for await (const event of stream) {
        if (event.type === "text_delta") { exchange.answer += event.delta; refresh?.(); }
      }
      const result = await stream.result();
      if (result.stopReason === "error" && !exchange.answer) throw new Error(result.errorMessage ?? "The model returned an error.");
      if (!exchange.answer.trim()) exchange.answer = "_No answer._";
      pi.appendEntry(ASIDE_ENTRY, { threadId: thread.id, exchange: { question, answer: exchange.answer, at: exchange.at, model: exchange.model } });
    } catch (error) {
      exchange.error = error instanceof Error ? error.message : String(error);
    } finally { busy = false; refresh?.(); }
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
    if (question || !thread) {
      thread = { id: randomUUID(), exchanges: [] };
      threads.push(thread); index.value = threads.length - 1;
    }
    if (question) void answer(ctx, thread, question);
    const done = await ctx.ui.custom<Done>((tui, theme, _kb, finish) => {
      const panel = new AsidePanel(tui, theme, () => threads, index, () => busy, () => ctx.model?.name ?? ctx.model?.id ?? "no model",
        follow => { const current = threads[index.value]; if (current) void answer(ctx, current, follow); },
        {
          copy: async () => {
            const last = threads[index.value]?.exchanges.filter(e => e.answer).at(-1);
            try { await copyToClipboard(last?.answer ?? ""); return "Copied"; } catch { return "Copy unavailable here"; }
          },
          send: () => {
            const last = threads[index.value]?.exchanges.filter(e => e.answer).at(-1);
            if (!last) return "No answer yet";
            const text = `On the side I asked: ${last.question}\n\nThe answer was:\n${last.answer}`;
            if (ctx.isIdle()) pi.sendUserMessage(text); else pi.sendUserMessage(text, { deliverAs: "followUp" });
            return ctx.isIdle() ? "Sent to the chat" : "Queued for the chat";
          },
          fork: () => finish({ action: "fork", thread: threads[index.value]! }),
          rename: name => {
            const current = threads[index.value]; if (!current) return;
            current.name = name || undefined;
            pi.appendEntry(ASIDE_ENTRY, { threadId: current.id, name });
          },
          close: () => finish({ action: "close" }),
        });
      refresh = () => tui.requestRender();
      return panel;
    }, PLACEMENT.custom);
    // Like a question, the aside takes the composer's place, so nothing is half covered;
    // the composer and its draft come back when it closes.
    refresh = undefined;
    if (done?.action !== "fork") return;
    // Fork: a new session from here, continuing with tools from the side answer.
    const last = done.thread.exchanges.filter(e => e.answer).at(-1);
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
