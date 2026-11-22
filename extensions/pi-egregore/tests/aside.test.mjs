import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { jiti, source, theme, plain, visibleWidth } from "./host.mjs";
const { ASIDE_ENTRY, ASIDE_PROMPT, AsidePanel, asideRequest, restoreThreads, settledMessages, registerAside, threadName } = await jiti.import(join(source, "aside.ts"));

const user = (id, parentId, text) => ({ type: "message", id, parentId, timestamp: "2026-11-21T10:00:00Z", message: { role: "user", content: text, timestamp: 1 } });
const assistant = (id, parentId, content) => ({ type: "message", id, parentId, timestamp: "2026-11-21T10:00:01Z",
  message: { role: "assistant", content, api: "openai-responses", provider: "openai", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 2 } });
const ctxFor = entries => ({ sessionManager: { getBranch: () => entries, getLeafId: () => entries.at(-1)?.id ?? null }, getSystemPrompt: () => "SYSTEM" });

test("a side request carries the session, the thread so far, the unfinished reply and the question", () => {
  const entries = [user("u1", null, "Run the tests"), assistant("a1", "u1", [{ type: "text", text: "Running them." }, { type: "toolCall", id: "c1", name: "bash", arguments: { command: "npm test" } }])];
  const request = asideRequest(ctxFor(entries), [{ question: "What runs?", answer: "npm test", at: 1 }], "Is it slow?", "Still going…");
  assert.equal(request.systemPrompt, "SYSTEM" + ASIDE_PROMPT);
  const last = request.messages.at(-1);
  assert.equal(last.role, "user");
  assert.match(last.content, /Earlier side questions in this thread:\nQ: What runs\?\nA: npm test/);
  assert.match(last.content, /The main agent is still replying\. Its text so far:\nStill going…/);
  assert.match(last.content, /Side question: Is it slow\?$/);
  const reply = request.messages.find(m => m.role === "assistant");
  assert.deepEqual(reply.content.map(c => c.type), ["text"], "a tool call with no result yet is dropped; providers reject it");
});

test("settled messages keep answered tool calls and drop an assistant turn left empty", () => {
  const messages = [
    { role: "assistant", content: [{ type: "toolCall", id: "done" }] },
    { role: "toolResult", toolCallId: "done", content: [] },
    { role: "assistant", content: [{ type: "toolCall", id: "pending" }] },
  ];
  const settled = settledMessages(messages);
  assert.equal(settled.length, 2);
  assert.equal(settled[0].content[0].id, "done");
});

test("threads restore from their custom entries on the current branch, in order", () => {
  const entry = (threadId, question, answer) => ({ type: "custom", customType: ASIDE_ENTRY, data: { threadId, exchange: { question, answer, at: 5, model: "m" } } });
  const threads = restoreThreads(ctxFor([entry("a", "One?", "1"), { type: "custom", customType: ASIDE_ENTRY, data: { threadId: "bad" } }, entry("b", "Two?", "2"), entry("a", "And?", "3")]));
  assert.deepEqual(threads.map(t => [t.id, t.exchanges.map(e => e.question)]), [["a", ["One?", "And?"]], ["b", ["Two?"]]]);
});

test("/btw and /aside are registered and refuse non-interactive modes", async () => {
  const commands = new Map(), notices = [];
  registerAside({ on() {}, registerCommand(name, spec) { commands.set(name, spec); }, appendEntry() {}, sendUserMessage() {} });
  assert.ok(commands.has("btw") && commands.has("aside"));
  await commands.get("btw").handler("anything", { mode: "print", ui: { notify: text => notices.push(text) } });
  assert.match(notices[0], /interactive terminal/);
});

test("a thread is named by its first question until you name it; the latest name entry wins", () => {
  const entry = data => ({ type: "custom", customType: ASIDE_ENTRY, data });
  const threads = restoreThreads(ctxFor([
    entry({ threadId: "a", exchange: { question: "What does a heavy frame mean in this interface and why do we use it at all?", answer: "x", at: 1 } }),
    entry({ threadId: "a", name: "Frame" }), entry({ threadId: "a", name: "Frame weights" }),
    entry({ threadId: "b", exchange: { question: "Short one?", answer: "y", at: 2 } }),
  ]));
  assert.equal(threadName(threads[0]), "Frame weights");
  assert.equal(threadName(threads[1]), "Short one?");
  assert.equal(threadName({ id: "c", exchanges: [{ question: "x".repeat(80), answer: "", at: 0 }] }).length, 40);
  assert.equal(threadName({ id: "d", exchanges: [] }), "New aside");
});

test("/btw @ completes thread names", async () => {
  const commands = new Map(), hooks = new Map();
  registerAside({ on(name, fn) { hooks.set(name, fn); }, registerCommand(name, spec) { commands.set(name, spec); }, appendEntry() {}, sendUserMessage() {} });
  hooks.get("session_start")({}, ctxFor([{ type: "custom", customType: ASIDE_ENTRY, data: { threadId: "a", name: "Frame weights" } }]));
  assert.deepEqual(commands.get("btw").getArgumentCompletions("@fr").map(c => c.value), ["@Frame weights"]);
  assert.equal(commands.get("btw").getArgumentCompletions("plain question"), null);
});

const KEY = { esc: "\x1b", tab: "\t", enter: "\r", up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", pgUp: "\x1b[5~", pgDown: "\x1b[6~" };
function panelHarness(threads = [{ id: "a", exchanges: [{ question: "Q?", answer: "A.", at: 1 }] }], rows = 40) {
  const log = [], index = { value: 0 }, list = { threads }, running = new Set();
  const tui = { terminal: { rows }, requestRender() {} };
  const pending = thread => thread.exchanges.some(e => running.has(e));
  const panel = new AsidePanel(tui, theme, () => list.threads, index, pending, () => "m", q => log.push(["ask", q]), {
    copy: async e => { log.push(["copy", e.question]); return "Copied"; }, send: e => { log.push(["send", e.question]); return "Sent"; },
    fork: e => log.push(["fork", e.question]), close: () => log.push(["close"]),
    stop: thread => { const hit = thread.exchanges.filter(e => running.has(e)); hit.forEach(e => running.delete(e)); log.push(["stop", hit.length]); return hit.length > 0; },
    rename: name => { list.threads[index.value].name = name || undefined; log.push(["rename", name]); },
    create: () => { list.threads.push({ id: "new", exchanges: [] }); index.value = list.threads.length - 1; log.push(["create"]); },
  });
  panel.focused = true;
  const type = text => { for (const ch of text) panel.handleInput(ch); };
  const view = (w = 80) => panel.render(w).map(plain).join("\n");
  return { panel, log, index, list, running, type, view };
}

test("typing always reaches the question: letters that are actions elsewhere are not swallowed", () => {
  const h = panelHarness();
  h.type("can I fork it?"); h.panel.handleInput(KEY.enter);
  assert.deepEqual(h.log, [["ask", "can I fork it?"]]);
});

test("Tab or Up opens actions; letters act there, and any other key returns to the question with that key", () => {
  const h = panelHarness();
  h.panel.handleInput(KEY.tab); assert.equal(h.panel.focus, "read");
  assert.match(h.view(), /c copy · i send to chat · f fork · r rename · n new/);
  h.panel.handleInput("i"); assert.deepEqual(h.log.at(-1), ["send", "Q?"]);
  h.panel.handleInput("w"); assert.equal(h.panel.focus, "ask");
  h.type("hy"); h.panel.handleInput(KEY.enter); assert.deepEqual(h.log.at(-1), ["ask", "why"]);
  h.panel.handleInput(KEY.up); assert.equal(h.panel.focus, "read");
  h.panel.handleInput(KEY.esc); assert.equal(h.panel.focus, "ask", "Esc goes back one level, not straight out");
  h.panel.handleInput(KEY.esc); assert.deepEqual(h.log.at(-1), ["close"]);
});

test("Esc with a half-typed question clears it before closing", () => {
  const h = panelHarness();
  h.type("draft"); h.panel.handleInput(KEY.esc);
  assert.ok(!h.log.some(e => e[0] === "close"));
  assert.match(h.view(), /esc close/);
});

test("renaming leaves by Enter, Tab or an arrow (keeping the name) or Esc (cancelling), and the acknowledgement clears itself", async () => {
  for (const leave of [KEY.enter, KEY.tab, KEY.down]) {
    const h = panelHarness();
    h.panel.handleInput(KEY.tab); h.panel.handleInput("r"); assert.equal(h.panel.focus, "name");
    h.type("Frames"); h.panel.handleInput(leave);
    assert.equal(h.panel.focus, "read"); assert.equal(h.list.threads[0].name, "Frames");
    assert.match(h.view(), /aside · Frames/); assert.match(h.view(), /Named “Frames”/);
    h.panel.dispose();
  }
  const h = panelHarness();
  h.panel.handleInput(KEY.tab); h.panel.handleInput("r"); h.type("Nope"); h.panel.handleInput(KEY.esc);
  assert.equal(h.panel.focus, "read"); assert.equal(h.list.threads[0].name, undefined);
  h.panel.handleInput("r"); h.type("Kept"); h.panel.handleInput(KEY.enter);
  assert.match(h.view(), /Named/);
  await new Promise(resolve => setTimeout(resolve, 1900));
  assert.doesNotMatch(h.view(), /Named/, "the footer goes back to the key hints");
  assert.match(h.view(), /↑↓ scroll/);
});

test("n starts a new aside from inside the panel and returns to the question line", () => {
  const h = panelHarness();
  h.panel.handleInput(KEY.tab); h.panel.handleInput("n");
  assert.deepEqual(h.log.at(-1), ["create"]); assert.equal(h.panel.focus, "ask");
  assert.match(h.view(), /‹ 2 of 2 ›/);
  h.panel.handleInput(KEY.left); assert.equal(h.index.value, 0, "←→ moves between asides on an empty line");
});

test("scrolling is bounded, shows what is hidden, holds its place while an answer grows, and follows the wheel", () => {
  const long = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join("\n\n");
  const thread = { id: "a", exchanges: [{ question: "Long?", answer: long, at: 1 }] };
  const h = panelHarness([thread], 24);
  const first = h.view();
  assert.match(first, /Line 60/); assert.match(first, /↑ \d+/);
  for (let i = 0; i < 100; i++) h.panel.handleInput(KEY.pgUp);
  h.view();
  assert.match(h.view(), /❯ Long\?/, "PageUp reaches the top");
  h.panel.handleInput(KEY.pgDown); h.view();
  assert.doesNotMatch(h.view(), /❯ Long\?/, "one PageDown moves at once; scrolling does not pile up past the top");
  h.panel.handleInput(KEY.tab); h.panel.handleInput("g"); h.view(); assert.match(h.view(), /❯ Long\?/);
  const anchored = h.view().split("\n")[1];
  thread.exchanges[0].answer += "\n\nMore\n\nAnd more";
  assert.equal(h.view().split("\n")[1], anchored, "new text below does not move what you are reading");
  h.panel.handleInput("G"); assert.match(h.view(), /And more/);
  assert.deepEqual(h.panel.handleMouse({ type: "wheel", wheelDelta: -3 }), { handled: true });
  assert.match(h.view(), /↓ 9/);
  h.panel.handleMouse({ type: "wheel", wheelDelta: 10 }); assert.match(h.view(), /And more/);
  assert.equal(h.panel.handleMouse({ type: "click" }), undefined);
});

test("Esc stops this aside's answer before it closes; s stops it from actions; another aside's answer is untouched", () => {
  const busy = { question: "Slow?", answer: "Partly", at: 1 }, other = { question: "Other?", answer: "", at: 2 };
  const h = panelHarness([{ id: "a", exchanges: [busy] }, { id: "b", exchanges: [other] }]);
  h.running.add(busy); h.running.add(other);
  assert.match(h.view(), /· answering/); assert.match(h.view(), /esc stop/);
  h.panel.handleInput(KEY.esc);
  assert.deepEqual(h.log.at(-1), ["stop", 1]); assert.ok(h.running.has(other), "only the aside you are in stops");
  assert.match(h.view(), /answering elsewhere/, "the status reflects this aside, not whichever finished first");
  h.panel.handleInput(KEY.esc); assert.deepEqual(h.log.at(-1), ["close"]);
  const h2 = panelHarness([{ id: "a", exchanges: [busy] }]); h2.running.add(busy);
  h2.panel.handleInput(KEY.tab); assert.match(h2.view(), /s stop/); h2.panel.handleInput("s");
  assert.deepEqual(h2.log.at(-1), ["stop", 1]); assert.match(h2.view(), /Stopped/);
});

test("copy, send and fork use the answer in view, not always the newest", () => {
  const long = Array.from({ length: 40 }, (_, i) => `Old ${i}`).join("\n\n");
  const h = panelHarness([{ id: "a", exchanges: [{ question: "First?", answer: long, at: 1 }, { question: "Second?", answer: "New.", at: 2 }] }], 24);
  h.view(); h.panel.handleInput(KEY.tab); h.panel.handleInput("c");
  assert.deepEqual(h.log.at(-1), ["copy", "Second?"]);
  h.panel.handleInput("g"); h.view(); h.panel.handleInput("c");
  assert.deepEqual(h.log.at(-1), ["copy", "First?"]);
  h.panel.handleInput("f"); assert.deepEqual(h.log.at(-1), ["fork", "First?"]);
});

test("stopped and failed answers restore as you saw them; a thread whose name was cleared before asking is dropped", () => {
  const entry = data => ({ type: "custom", customType: ASIDE_ENTRY, data });
  const threads = restoreThreads(ctxFor([
    entry({ threadId: "a", exchange: { question: "Cut?", answer: "Half", at: 1, stopped: true } }),
    entry({ threadId: "a", exchange: { question: "Broke?", answer: "", at: 2, error: "Rate limited" } }),
    entry({ threadId: "b", name: "Temp" }), entry({ threadId: "b", name: "" }),
  ]));
  assert.equal(threads.length, 1);
  assert.deepEqual(threads[0].exchanges.map(e => [e.stopped ?? false, e.error ?? ""]), [[true, ""], [false, "Rate limited"]]);
  const request = asideRequest(ctxFor([]), threads[0].exchanges, "Next?");
  assert.match(request.messages.at(-1).content, /Q: Cut\?\nA: Half \(stopped early\)/);
  assert.doesNotMatch(request.messages.at(-1).content, /Broke/, "a failed question is not context");
});

test("an answer still arriving when you change branch is stopped and not saved onto the new branch", async () => {
  const hooks = new Map(), commands = new Map(), saved = [];
  registerAside({ on(name, fn) { hooks.set(name, fn); }, registerCommand(name, spec) { commands.set(name, spec); }, appendEntry: (type, data) => saved.push(data), sendUserMessage() {} });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const stream = signal => ({
    async *[Symbol.asyncIterator]() { yield { type: "text_delta", delta: "Hal" }; await Promise.race([gate, new Promise(r => signal.addEventListener("abort", r))]); },
    result: async () => ({ stopReason: signal.aborted ? "aborted" : "stop" }),
  });
  const ctx = { ...ctxFor([]), mode: "tui", model: { id: "m" }, isIdle: () => true,
    modelRegistry: { streamSimple: (_m, _r, options) => stream(options.signal) },
    ui: { notify() {}, custom: async () => { await new Promise(r => setTimeout(r, 5)); hooks.get("session_tree")({}, ctxFor([])); await new Promise(r => setTimeout(r, 5)); return { action: "close" }; } } };
  hooks.get("session_start")({}, ctx);
  await commands.get("btw").handler("Slow question?", ctx);
  release();
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(saved, [], "nothing lands on the branch you moved to");
});
