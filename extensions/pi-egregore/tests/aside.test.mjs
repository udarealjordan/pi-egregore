import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { jiti, source, theme, plain, visibleWidth } from "./host.mjs";
const { ASIDE_ENTRY, ASIDE_PROMPT, asideRequest, restoreThreads, settledMessages, registerAside, threadName } = await jiti.import(join(source, "aside.ts"));

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
