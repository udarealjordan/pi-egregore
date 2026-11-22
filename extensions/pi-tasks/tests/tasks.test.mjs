import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
const source = resolve(fileURLToPath(new URL("..", import.meta.url)));
const install = join(homedir(), ".pi/agent/install");
const root = process.env.PI_EGREGORE_HOST_MODULES || process.env.PI_HOME_HOST_MODULES || join(install, "releases", readFileSync(join(install, "current-version"), "utf8").trim(), "node_modules");
const host = join(root, "@earendil-works/pi-coding-agent/dist");
const { createJiti } = await import(pathToFileURL(join(root, "jiti/lib/jiti.mjs")));
const jiti = createJiti(import.meta.url, { alias: {
  "@earendil-works/pi-coding-agent": join(host, "index.js"),
  "@earendil-works/pi-tui": join(root, "@earendil-works/pi-tui/dist/index.js"),
  "@earendil-works/pi-ai": join(root, "@earendil-works/pi-ai/dist/index.js"),
  "typebox": join(root, "typebox/build/index.mjs"),
} });
const { emptyPlan, mutate, restorePlan, progressText, taskOverview, contextSummary, ENTRY } = await jiti.import(join(source, "state.ts"));
const { dockRows, waitingText, questionAttention, questionAttentionSummary } = await jiti.import(join(source, "typography.ts"));
const { BOOK_ENTRY, COMPLETION_MS, emptyBook, mutateBook, migratePlan, restoreBook, selectedPlan, resultPlan, bookContext, planInfo } = await jiti.import(join(source, "book.ts"));
const factory = await jiti.import(join(source, "index.ts"), { default: true });
// Load Ask exactly as Pi would, through the entry its own manifest declares.
const askPackage = join(source, "../../packages/pi-ask");
const askEntry = JSON.parse(readFileSync(join(askPackage, "package.json"), "utf8")).pi.extensions[0];
const askFactory = await jiti.import(join(askPackage, askEntry), { default: true });
const { POSTED } = await jiti.import("pi-agent-contracts/posted");
const egregoreFactory = await jiti.import(join(source, "../pi-egregore/index.ts"), { default: true });
const { TaskPanel } = await jiti.import(join(source, "panel.ts"));
const { layoutDock } = await jiti.import("pi-agent-contracts/dock");
const { createDock } = await jiti.import(join(source, "../pi-egregore/dock.ts"));
const { taskFrame, taskFrameColor } = await jiti.import(join(source, "../../lib/task-frame.ts"));
const { DEFAULTS, RunClock } = await jiti.import(join(source, "../pi-egregore/state.ts"));
const { DOCK, isSnapshot, isHost, fitDock } = await jiti.import("pi-agent-contracts/dock");
const { initTheme, getEditorTheme, theme, getThemeByName, setThemeInstance } = await import(pathToFileURL(join(host, "modes/interactive/theme/theme.js")));
const { KeybindingsManager } = await import(pathToFileURL(join(host, "core/keybindings.js")));
const { visibleWidth, setKeybindings } = await import(pathToFileURL(join(root, "@earendil-works/pi-tui/dist/index.js")));
const { createEventBus } = await import(pathToFileURL(join(host, "core/event-bus.js")));
const { loadExtensions } = await import(pathToFileURL(join(host, "core/extensions/loader.js")));
const { ToolExecutionComponent } = await import(pathToFileURL(join(host, "modes/interactive/components/tool-execution.js")));
initTheme("dark", false);
const kb = new KeybindingsManager(); setKeybindings(kb);
const plain = (s) => stripVTControlCharacters(s);
const add = (p, titles = ["Read requirements", "Implement", "Verify"]) => mutate(p, p.revision, { op: "add", items: titles.map((title) => ({ title })) }, "agent", 1000);
const update = (p, id, changes, actor = "agent") => mutate(p, p.revision, { op: "update", id, changes }, actor, 2000);

test("blocker responsibility survives restore; dependencies and answer attention do not invent readiness", () => {
  let p=emptyPlan();p=mutate(p,p.revision,{op:'add',items:[{title:'Access source'},{title:'Verify',dependsOn:['t1']}]},'agent');
  p=mutate(p,p.revision,{op:'update',id:'t1',changes:{status:'blocked',reason:'Source access unavailable',blockerOwner:'user',unblockWhen:'Source access is granted and a read probe succeeds'}},'agent');
  assert.deepEqual(restorePlan(p),p);assert.match(waitingText(p.tasks[0],p),/Source access unavailable · continues when Source access is granted/);
  assert.match(waitingText(p.tasks[1],p),/after Access source/);
  assert.throws(()=>mutate(p,p.revision,{op:'update',id:'t2',changes:{status:'active'}},'agent'),/Unfinished dependencies/);
  assert.throws(()=>mutate(p,p.revision,{op:'update',id:'t1',changes:{blockerOwner:'guess'}},'agent'),/owner/);
  p=mutate(p,p.revision,{op:'update',id:'t1',changes:{status:'pending'}},'agent');
  assert.equal(p.tasks[0].blockerOwner,undefined);assert.equal(p.tasks[0].unblockWhen,undefined);
  const q={id:'q1',revision:1,question:'Where?',urgency:'blocking',state:'awaiting',boundary:'Writes wait',taskIds:['t1']};
  assert.equal(questionAttention(q),'Waiting on you');assert.equal(questionAttentionSummary([q]),'1 waiting on you');
  q.state='submitted';assert.equal(questionAttention(q),'Sending your answer');assert.equal(questionAttentionSummary([q]),'','a sent answer needs nothing from you');
  q.state='delivered';q.responseStatus='answered';assert.equal(questionAttention(q),'Answered');assert.equal(questionAttentionSummary([q]),'');
  assert.equal(p.tasks[0].status,'pending','an answer never edits a task');
});

test("dock rows are the checklist in plan order with one status vocabulary", () => {
  let p = add(emptyPlan(), ["Read", "Build", "Check", "Ship"]);
  assert.equal(progressText(p), "0 of 4 done");
  p = update(p, "t1", { status: "done", note: "Read" });
  p = update(p, "t2", { status: "active" });
  p = update(p, "t3", { status: "blocked", reason: "Waiting for approval" });
  p = update(p, "t4", { status: "cancelled" });
  assert.equal(progressText(p), "1 of 4 done · 1 blocked · 1 cancelled");
  assert.equal(progressText(emptyPlan()), "No tasks yet");
  const rows = dockRows(p, true).rows;
  assert.deepEqual(rows.map(r => r.text), ["✓ Read", "◉ Build", "! Check · Waiting for approval"]);
  assert.deepEqual(rows.map(r => r.tone), ["muted", "accent", "warning"]);
  assert.equal(dockRows(p, false).rows[1].text, "◉ Build · paused", "a stopped agent pauses, it does not finish");
  const overview = taskOverview(p);
  assert.equal(overview.activeId, "t2"); assert.equal(overview.activeTitle, "Build");
  assert.equal(overview.total, 4); assert.equal(overview.done, 1);
  assert.equal(isSnapshot({ version: 1, sessionId: "test", id: "pi-tasks", title: "Plan", rows, overview }), true);
  assert.equal(isSnapshot({ version: 1, sessionId: "test", id: "pi-tasks", title: "Plan", rows, overview: { ...overview, activeTitle: "" } }), false);
});

test("focus dock wraps Unicode within its line budget without unused padding", () => {
  const snapshot = { version: 1, sessionId: "test", id: "pi-tasks", title: "Plan", rows: [
    { text: "✓ Done", tone: "muted" },
    { text: "● Working · Long task 界面 é needs enough space to wrap without losing its complete title", tone: "accent" },
    { text: "○ Test later", tone: "text" },
  ] };
  for (const width of [1, 2, 8, 20, 40, 80]) for (const budget of [3, 5, 7]) {
    const lines = layoutDock(snapshot, width, budget);
    assert.ok(lines.length <= budget);
    assert.ok(lines.every(line => visibleWidth(line.text) <= width));
    if (width === 20 && budget === 3) assert.ok(lines.some(line => line.text.includes("…")));
  }
  assert.ok(layoutDock(snapshot, 40, 7).some(line => line.text.startsWith("  ")));
  assert.equal(layoutDock({ ...snapshot, rows: [{ text: "Short" }] }, 40, 7).length, 1);
  assert.equal(layoutDock({ ...snapshot, rows: [{ text: "One" }, { text: "Two" }, { text: "Three" }] }, 40, 7).length, 3);
});

test("standalone task extension loads through the real host with no Egregore dependency", async () => {
  const result = await loadExtensions([join(source, "index.ts")], source);
  assert.deepEqual(result.errors, []);
  assert.ok(result.extensions[0].commands.has("tasks"));
});
test("atomic revisioned updates, stable IDs, explicit start, dependencies and outcomes", () => {
  const empty = emptyPlan(), p = add(empty);
  assert.equal(empty.tasks.length, 0);
  assert.ok(p.tasks.every((t) => t.status === "pending"));
  let q = update(p, "t1", { status: "active" });
  assert.throws(() => update(q, "t2", { status: "active" }), /one focus/);
  assert.throws(() => mutate(q, p.revision, { op: "add", items: [{ title: "stale" }] }, "agent"), /plan changed/);
  assert.throws(() => update(q, "t1", { status: "done" }), /completion note/);
  q = update(q, "t2", { dependsOn: ["t1"] });
  assert.throws(() => update(q, "t2", { status: "done", note: "pretend done" }), /Unfinished dependencies/);
  assert.throws(() => update(q, "t1", { dependsOn: ["t2"], status: "pending" }), /cycle/);
  assert.throws(() => update(q, "t3", { dependsOn: ["t99"] }), /Unknown dependency/);
  assert.throws(() => update(q, "t3", { status: "blocked" }), /reason/);
  q = update(q, "t1", { title: "Read the actual requirements", status: "done", note: "Reviewed", evidence: "read call #1" });
  assert.equal(q.tasks[0].id, "t1");
  assert.equal(q.tasks[1].status, "pending", "no implicit next-task start");
  q = update(q, "t2", { status: "active" });
  q = update(q, "t3", { status: "cancelled" });
  assert.equal(progressText(q), "1 of 3 done · 1 cancelled");
  assert.deepEqual(restorePlan(q), q);
  assert.equal(p.tasks[0].title, "Read requirements", "base snapshot not mutated");
});
test("user closure/clear cannot be undone by the agent, including via an intervening rename", () => {
  let p = add(emptyPlan());
  p = update(p, "t1", { status: "cancelled" }, "user");
  p = update(p, "t1", { title: "Renamed" });
  assert.throws(() => update(p, "t1", { status: "pending" }), /Only the user/);
  p = update(p, "t1", { status: "pending" }, "user");
  p = update(p, "t1", { status: "done", note: "Passed", evidence: "run #2" });
  p = update(p, "t1", { status: "pending" });
  assert.equal(p.tasks[0].note, ""); assert.equal(p.tasks[0].evidence, "");
  const revision = p.revision;
  p = mutate(p, revision, { op: "clear" }, "user");
  assert.throws(() => add(p), /user cleared/);
  const next = mutate(p, p.revision, { op: "add", items: [{ title: "User-added" }] }, "user");
  assert.equal(next.tasks[0].id, "t4");
  assert.equal(next.userCleared, false);
});
test("persisted data, bounds and terminal controls are validated; memory is bounded", () => {
  let p = add(emptyPlan(), ["hello\x1b[31m\n世界"]);
  assert.equal(p.tasks[0].title, "hello 世界");
  assert.throws(() => add(p, ["x".repeat(201)]), /200/);
  assert.throws(() => add(p, Array(101).fill("x")), /100/);
  assert.throws(() => restorePlan({ ...p, version: 2 }), /invalid|Unsupported/);
  assert.throws(() => restorePlan({ ...p, tasks: [...p.tasks, ...p.tasks] }), /Duplicate/);
  p = add(p, Array.from({ length: 90 }, (_, i) => "Task " + i));
  const summary = contextSummary(p);
  assert.ok(summary.length < 8000);
  assert.match(summary, /75 more open/);
  assert.equal(summary.split('"id":').length - 1, 16);
  p = update(p, "t91", { status: "blocked", reason: "Needs your answer" });
  assert.match(contextSummary(p), /Needs your answer/, "late blockers get priority in bounded memory");
  p = update(p, "t1", { status: "active" });
  assert.match(dockRows(p, false).rows[0].text, /◉ hello 世界 · paused/);
  assert.equal(dockRows(p, true).rows[0].text, "◉ hello 世界");
});

async function harness({ egregore = false, ask = false, order = "egregore-first", mode = "tui", prefs } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "pi-tasks-test-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = scratch;
  if (prefs !== undefined) writeFileSync(join(scratch, "pi-tasks.json"), typeof prefs === "string" ? prefs : JSON.stringify(prefs));
  const handlers = new Map(), commands = new Map(), tools = new Map(), entries = [], widgets = new Map(), notices = [], active = new Set(["read", "bash"]);
  const events = createEventBus(), messages = [];
  let branch = entries, currentFactory, editor, footer, renderCount = 0, failStorage = false;
  const tui = { terminal: { rows: 40 }, requestRender() { renderCount++; } };
  const data = { getGitBranch: () => undefined, getExtensionStatuses: () => new Map(), onBranchChange: () => () => {} };
  const context = { mode, hasUI: mode === "tui" || mode === "rpc", cwd: scratch, model: { id: "offline-test" },
    sessionManager: { getLeafId: () => null, getBranch: () => branch, getSessionId: () => "test-session", getSessionName: () => "Current session", getHeader: () => ({ timestamp: new Date().toISOString() }) }, getContextUsage: () => ({ percent: 10 }),
    ui: { theme, getTheme: getThemeByName, setTheme(value) { setThemeInstance(value); return { success: true }; },
      getEditorComponent: () => currentFactory, setEditorComponent(f) { const text = editor?.getText() ?? ""; currentFactory = f; editor = f?.(tui, getEditorTheme(), kb); if (editor) { editor.focused = true; editor.setText(text); } },
      getEditorText: () => editor?.getExpandedText() ?? "", setEditorText: (text) => editor?.setText(text),
      setWorkingVisible() {}, setHeader() {}, setFooter(f) { footer?.dispose(); footer = f?.(tui, theme, data); },
      setWidget(key, f) { if (!f) widgets.delete(key); else widgets.set(key, typeof f === "function" ? f(tui, theme) : { render: () => f }); },
      notify: (text, tone) => notices.push({ text, tone }), confirm: async () => true, input: async () => undefined,
      custom: async (factory) => { let result; const panel = factory(tui, theme, kb, (value) => result = value); panel.render(100); panel.handleInput("\x1b"); return result; },
    } };
  const api = { events,
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); return () => {}; },
    registerCommand: (name, command) => commands.set(name, command),
    registerEntryRenderer() {}, registerMessageRenderer() {},
    sendMessage(message, options) { messages.push({ ...structuredClone(message), role: "custom", options }); },
    registerTool(tool) { tools.set(tool.name, tool); active.delete(tool.name); if (tool.exposure === "direct") active.add(tool.name); },
    getActiveTools: () => [...active], setActiveTools(names) { active.clear(); names.forEach((n) => active.add(n)); },
    getThinkingLevel: () => "high",
    appendEntry(customType, value) { if (failStorage) throw new Error("disk failed"); const entry = { type: "custom", customType, data: structuredClone(value) }; branch.push(entry); },
  };
  if (egregore && order === "egregore-first") await egregoreFactory(api);
  if (ask && order === "ask-first") await askFactory(api);
  await factory(api);
  if (ask && order !== "ask-first") await askFactory(api);
  if (egregore && order !== "egregore-first") await egregoreFactory(api);
  const emit = async (name, value = {}) => { const results = []; for (const fn of handlers.get(name) ?? []) results.push(await fn({ type: name, ...value }, context)); return results; };
  const command = (name, args = "") => commands.get(name).handler(args, context);
  if (egregore) await command("sounds", "off"); // Task fixtures do not require an audio device.
  const call = (params, signal) => tools.get("tasks").execute("task-test", params, signal, undefined, context);
  return { scratch, context, tools, handlers, entries, messages, widgets, notices, events, active, tui, emit, command, call,
    callQuestion: params => tools.get("question_queue").execute("question-test", params, undefined, undefined, context),
    get editor() { return editor; }, get renders() { return renderCount; },
    branch(value) { branch = value; }, failStorage() { failStorage = true; },
    async close() { await emit("session_shutdown"); events.clear(); if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); },
  };
}

test("both dock hosts show the same plan title, work rows and summary", async () => {
  for (const egregore of [false, true]) {
    const h = await harness({ egregore });
    try {
      await h.emit("session_start");
      const initial = JSON.parse((await h.call({ op: "list" })).content[0].text);
      let result = await h.call({ op: "create", revision: initial.revision, title: "Dock parity", items: Array.from({ length: 8 }, (_, i) => ({ title: `Step ${i + 1} 界面` })) });
      result = await h.call({ op: "update", revision: JSON.parse(result.content[0].text).revision, id: "t4", changes: { status: "active" } });
      await h.emit("agent_start");
      const before = structuredClone(h.entries);
      const render = width => [...h.widgets.values()].flatMap(widget => widget.render(width)).map(plain).join("\n");
      const shown = render(100);
      assert.match(shown, /Dock parity/);
      assert.match(shown, /◉ Step 4 界面/, "the active task leads even in a short dock");
      assert.match(shown, /○ Step 5 界面/, "followed by what comes next");
      assert.match(shown, /0 of 8 done/);
      assert.match(shown, /\+ \d+ more/, "tasks past the viewport become a count");
      for (const rows of [12, 24, 40]) for (const width of [20, 40, 80]) {
        h.tui.terminal.rows = rows;
        assert.ok([...h.widgets.values()].flatMap(widget => widget.render(width)).every(line => visibleWidth(line) <= width));
      }
      await h.command("tasks", "prev");
      assert.match(h.notices.at(-1).text, /Usage: \/tasks/);
      await h.command("tasks", "view compact");
      assert.match(h.notices.at(-1).text, /Usage: \/tasks/);
      assert.deepEqual(h.entries, before, "retired view commands change nothing");
    } finally { await h.close(); }
  }
});

test("the dock leads with the plan, counts open work and keeps its facts when hidden", async () => {
  for (const egregore of [false, true]) {
    const h = await harness({ egregore, ask: true });
    let last;
    try {
      await h.emit("session_start");
      h.events.on(DOCK.update, value => last = value);
      const initial = JSON.parse((await h.call({ op: "list" })).content[0].text);
      const created = JSON.parse((await h.call({ op: "create", revision: initial.revision, title: "Photos for Mom", items: [{ title: "Choose cover" }, { title: "Print" }] })).content[0].text);
      await h.call({ op: "update", revision: created.revision, id: "t2", changes: { status: "active" } });
      await h.callQuestion({ op: "post", question: { question: "Which cover?", why: "Needed", boundary: "Print waits", urgency: "blocking", planId: "p1", taskIds: ["t1"] } });
      await h.emit("agent_start");
      const shown = [...h.widgets.values()].flatMap(w => w.render(80)).map(plain).join("\n");
      assert.match(shown, /Photos for Mom/);
      assert.match(shown, /1 waiting on you · 0 of 2 done/);
      assert.match(shown, /\? Which cover\? · \/questions q1/);
      assert.match(shown, /◉ Print/);
      await h.command("tasks", "hide");
      assert.deepEqual(last.rows, []);
      assert.equal(last.overview.activeTitle, "Print", "the composer hint still receives the active title");
      assert.equal(last.title, "Photos for Mom");
      if (egregore) {
        await h.emit("agent_settled");
        const rail = h.editor.render(80).map(plain).join("\n");
        assert.match(rail, /Next: Print/, "the composer hint carries the active task while the dock is hidden");
        await h.command("tasks", "unhide");
        assert.match([...h.widgets.values()].flatMap(w => w.render(80)).map(plain).join("\n"), /◉ Print · paused/);
        assert.doesNotMatch(h.editor.render(80).map(plain).join("\n"), /Next: Print/, "a visible dock does not duplicate the hint");
      }
    } finally { await h.close(); }
  }
});

test("legacy task appearance is read without disabling Tasks and dropped on the next save", async () => {
  const h = await harness({ prefs: { enabled: true, appearance: "compact", hidden: false } });
  try {
    await h.emit("session_start");
    await h.command("tasks", "add Migrated task");
    assert.equal(h.active.has("tasks"), true, "an old view preference never disables tracking");
    await h.command("tasks", "hide");
    const saved = JSON.parse(readFileSync(join(h.scratch, "pi-tasks.json"), "utf8"));
    assert.deepEqual(Object.keys(saved).sort(), ["enabled", "hidden"]);
  } finally { await h.close(); }
});

test("hide/unhide only controls the dock, persists, and leaves tracking and panel available", async () => {
  for (const egregore of [false, true]) {
    const h = await harness({ egregore });
    try {
      await h.emit("session_start");
      await h.command("tasks", "add Visibility test task");
      const render = () => plain([...h.widgets.values()].flatMap(w => w.render(100)).join("\n"));
      assert.match(render(), /Visibility test task/);
      const before = structuredClone(h.entries);
      const hiding = h.command("tasks", "hide");
      assert.doesNotMatch(render(), /Visibility test task/);
      await hiding;
      assert.deepEqual(h.entries, before);
      assert.equal(h.active.has("tasks"), true);
      assert.equal(h.tools.get("tasks").exposure, "direct");
      assert.equal((await h.emit("context", { messages: [] }))[0].messages.length, 1);
      assert.equal(JSON.parse(readFileSync(join(h.scratch, "pi-tasks.json"))).hidden, true);
      const current = JSON.parse((await h.call({ op: "list" })).content[0].text);
      await h.call({ op: "update", revision: current.revision, id: "t1", changes: { status: "active" } });
      await h.emit("agent_start");
      await h.emit("session_compact");
      await h.emit("agent_settled");
      assert.doesNotMatch(render(), /Visibility test task/);
      let opened = false;
      const custom = h.context.ui.custom;
      h.context.ui.custom = async (...args) => { opened = true; return custom(...args); };
      await h.command("tasks", "");
      assert.equal(opened, true);
      assert.doesNotMatch(render(), /Visibility test task/);
      await h.emit("session_start");
      assert.doesNotMatch(render(), /Visibility test task/);
      if (egregore) {
        await h.command("composer", "off");
        assert.equal(h.widgets.has("pi-tasks:fallback"), false);
        await h.command("composer", "on");
        assert.doesNotMatch(render(), /Visibility test task/);
      }
      await h.command("tasks", "off");
      await h.command("tasks", "on");
      assert.doesNotMatch(render(), /Visibility test task/);
      await h.command("tasks", "unhide");
      assert.match(render(), /Visibility test task/);
      assert.equal(JSON.parse(readFileSync(join(h.scratch, "pi-tasks.json"))).hidden, false);
      await h.command("tasks", "off");
      await h.command("tasks", "hide");
      await h.command("tasks", "unhide");
      assert.equal(h.active.has("tasks"), false, "unhide never enables tracking");
      assert.doesNotMatch(render(), /Visibility test task/);
      assert.equal(h.notices.filter(n => n.tone === "warning").length, 0);
    } finally { await h.close(); }
  }
});

test("tasks off is immediate, hides the tool/context/UI and preserves the plan", async () => {
  const h = await harness();
  try {
    await h.emit("session_start");
    await h.command("tasks", "add Preserve this task");
    const before = (await h.call({ op: "list" })).details.plan;
    assert.ok(h.widgets.has("pi-tasks:fallback"));
    assert.equal(h.handlers.has("agent_before_settle"), false);
    assert.equal(h.handlers.has("turn_end"), false);
    const off = h.command("tasks", "off");
    assert.equal(h.tools.get("tasks").exposure, "hidden", "off takes effect before filesystem save completes");
    await assert.rejects(h.call({ op: "update", revision: before.revision, id: "t1", changes: { status: "active" } }), /Tasks are off/);
    assert.equal(h.active.has("tasks"), false);
    assert.equal(h.active.has("bash"), true);
    assert.equal(h.widgets.size, 0);
    const offContext = (await h.emit("context", { messages: [{ role: "user", content: "hello" }] }))[0];
    assert.equal(offContext.messages.length, 1);
    await off;
    assert.equal(JSON.parse(readFileSync(join(h.scratch, "pi-tasks.json"))).enabled, false);
    await h.emit("session_start");
    assert.equal(h.tools.get("tasks").exposure, "hidden");
    await h.command("tasks", "on");
    assert.deepEqual((await h.call({ op: "list" })).details.plan, before);
    assert.ok(h.active.has("tasks"));
    const first = (await h.emit("context", { messages: [] }))[0];
    const second = (await h.emit("context", { messages: first.messages }))[0];
    assert.equal(second.messages.length, 1, "no growing reminder history");
  } finally { await h.close(); }
});
test("tool lists are paginated and completion-note attribution survives unrelated edits", async () => {
  const h = await harness();
  try {
    await h.emit("session_start");
    const p = (await h.call({ op: "list" })).details.plan;
    const added = await h.call({ op: "add", revision: p.revision, items: Array.from({ length: 25 }, (_, i) => ({ title: "Task " + i })) });
    assert.equal(JSON.parse(added.content[0].text).tasks.length, 20);
    const nextPage = JSON.parse((await h.call({ op: "list", offset: 20 })).content[0].text);
    assert.equal(nextPage.tasks.length, 5);
    let q = update(added.details.plan, "t1", { status: "done", note: "I accepted this" }, "user");
    q = update(q, "t1", { title: "Renamed by agent" });
    assert.equal(q.tasks[0].noteBy, "user");
    assert.equal(q.tasks[0].updatedBy, "agent");
  } finally { await h.close(); }
});

test("Egregore and Tasks remain independent in both extension startup orders", async () => {
  for (const order of ["egregore-first", "tasks-first"]) {
    const h = await harness({ egregore: true, order });
    try {
      await h.emit("session_start");
      await h.command("tasks", "add A real task");
      const editor = h.editor; editor.setText("draft stays intact");
      assert.equal(h.widgets.has("pi-tasks:fallback"), false);
      let egregore = h.widgets.get("pi-egregore:dock").render(100).map(plain).join("\n");
      assert.match(egregore, /A real task/);
      assert.match(h.editor.render(100).map(plain).join("\n"), /Current session/, "identity belongs in Composer's native editor rail");
      assert.match(egregore, /╭ Session plan .*╮[\s\S]*╰─/);
      await h.command("tasks", "off");
      assert.equal(h.editor, editor);
      assert.equal(h.editor.getText(), "draft stays intact");
      egregore = h.widgets.get("pi-egregore:dock").render(100).map(plain).join("\n");
      assert.doesNotMatch(egregore, /A real task/);
      assert.match(h.editor.render(100).map(plain).join("\n"), /Current session/);
      await h.command("tasks", "on");
      await h.command("composer", "off");
      assert.ok(h.widgets.has("pi-tasks:fallback"));
      assert.match(h.widgets.get("pi-tasks:fallback").render(100).map(plain).join("\n"), /^╭ Session plan .*╮[\s\S]*╰─/);
      assert.ok(h.active.has("tasks"));
      assert.equal(h.widgets.has("pi-egregore:dock"), false);
      await h.command("composer", "on");
      assert.equal(h.widgets.has("pi-tasks:fallback"), false);
      assert.match(h.widgets.get("pi-egregore:dock").render(100).map(plain).join("\n"), /A real task/);
      await h.command("composer", "motion off");
      assert.match(h.widgets.get("pi-egregore:dock").render(100).map(plain).join("\n"), /A real task/);
      await h.command("tasks", "");
      assert.equal(h.notices.filter((n) => n.tone === "warning").length, 0);
    } finally { await h.close(); }
  }
});
test("active-branch restoration, compaction, abort and failed storage preserve truthful state", async () => {
  const h = await harness();
  try {
    await h.emit("session_start"); await h.command("tasks", "add Original branch");
    const initial = (await h.call({ op: "list" })).details.plan;
    const branchPoint = structuredClone(h.entries);
    await h.call({ op: "update", revision: initial.revision, id: "t1", changes: { status: "active" } });
    await h.emit("agent_start"); await h.emit("agent_settled");
    assert.match(h.widgets.get("pi-tasks:fallback").render(120).map(plain).join("\n"), /◉ Original branch · paused/);
    h.branch(branchPoint); await h.emit("session_tree");
    assert.deepEqual((await h.call({ op: "list" })).details.plan, initial);
    await h.command("tasks", "add Fork only");
    assert.equal((await h.call({ op: "list" })).details.plan.tasks.length, 2);
    h.branch(h.entries); await h.emit("session_tree");
    assert.equal((await h.call({ op: "list" })).details.plan.tasks.length, 1);
    await h.emit("session_compact");
    const p = (await h.call({ op: "list" })).details.plan;
    assert.equal(p.tasks[0].title, "Original branch");
    const controller = new AbortController(); controller.abort();
    await assert.rejects(h.call({ op: "list" }, controller.signal), /cancelled/);
    h.failStorage();
    await assert.rejects(h.call({ op: "update", revision: p.revision, id: "t1", changes: { status: "done", note: "done" } }), /disk failed/);
    assert.deepEqual((await h.call({ op: "list" })).details.plan, p);
  } finally { await h.close(); }
});
test("non-TUI tasks work, off works, corrupt preferences fail closed and corrupt snapshots are not overwritten", async () => {
  for (const mode of ["print", "json", "rpc"]) {
    const h = await harness({ mode });
    try {
      await h.emit("session_start"); await h.command("tasks", "add Headless task");
      assert.equal((await h.call({ op: "list" })).details.plan.tasks.length, 1);
      assert.equal(h.widgets.size, 0);
      await h.command("tasks", "off");
      await assert.rejects(h.call({ op: "list" }), /off/);
    } finally { await h.close(); }
  }
  const h = await harness({ prefs: "not JSON" });
  try {
    await h.emit("session_start");
    assert.equal(h.tools.get("tasks").exposure, "hidden");
    await h.command("tasks", "on");
    h.entries.push({ type: "custom", customType: ENTRY, data: { version: 99 } });
    await h.emit("session_tree");
    await assert.rejects(h.call({ op: "list" }), /unreadable/);
    assert.equal(h.entries.length, 1);
    await h.command("tasks", "clear");
    assert.equal(h.entries.length, 2);
  } finally { await h.close(); }
});
test("task panel clips Unicode, shows closed work only on request, uses committed data and handles keys", () => {
  let p = add(emptyPlan(), ["Unicode 界面 🪴", "Check the result", "Cancel this"]);
  p = update(p, "t1", { status: "done", note: "Reviewed", evidence: "user acceptance" }, "user");
  p = update(p, "t3", { status: "cancelled" });
  let result;
  for (const rows of [12, 24, 40]) {
    const b = migratePlan(p);
    const panel = new TaskPanel({ terminal: { rows }, requestRender() {} }, theme, () => b, () => undefined, (r) => result = r, { showDone: true });
    for (const width of [1, 2, 8, 20, 40, 80, 120]) for (const line of panel.render(width)) assert.ok(visibleWidth(line) <= width);
    assert.match(panel.render(80).map(plain).join("\n"), /✓ Unicode 界面 🪴/, "F reveals completed work");
    panel.handleInput("\r");
    for (const width of [1, 2, 8, 20, 80]) for (const line of panel.render(width)) assert.ok(visibleWidth(line) <= width);
    panel.handleInput("\x1b");
    panel.handleInput("e"); assert.deepEqual(result, { op: "edit", planId: "p1", revision: b.revision, id: "t2" });
    panel.handleInput("\x1b"); assert.equal(result, undefined);
  }
});
test("open work rows keep working, blocked and not-started in one order; overflow is explicit", () => {
  let p = add(emptyPlan());
  assert.equal(progressText(p), "0 of 3 done");
  p = update(p, "t1", { status: "done", note: "Read" });
  p = update(p, "t2", { status: "active" });
  const rows = dockRows(p, false).rows;
  assert.deepEqual(rows.map((r) => r.text), ["✓ Read requirements", "◉ Implement · paused", "○ Verify"]);
  const snapshot = { version: 1, sessionId: "s", id: "test", title: "Plan", rows, hint: "/tasks" };
  assert.equal(fitDock(snapshot, 3).length, 3);
  assert.equal(progressText(p), "1 of 3 done");
  const big = add(emptyPlan(), Array.from({ length: 20 }, (_, i) => `Step ${i + 1}`));
  const all = dockRows(big, false);
  assert.equal(all.rows.length, 6); assert.equal(all.more, 14, "the viewport counts what it leaves out");
  const compact = fitDock({ ...snapshot, rows: all.rows, more: all.more }, 6);
  assert.equal(compact.length, 6);
  assert.equal(compact.at(-1).text, "+ 15 more · /tasks");
  assert.equal(isSnapshot({ ...snapshot, more: -1 }), false);
  assert.equal(isSnapshot({ ...snapshot, summary: 123 }), false);
});
test("tool results show committed checklist state without raw revisions, and updates avoid reprinting the entire plan", async () => {
  const h = await harness();
  try {
    await h.emit("session_start");
    const initial = await h.call({ op: "list" });
    const result = await h.call({ op: "add", revision: initial.details.plan.revision, items: [{ title: "One" }, { title: "Two" }, { title: "Three" }] });
    const tool = h.tools.get("tasks");
    const row = (args) => tool.renderResult(result, { expanded: false }, theme, { args }).render(80).map(plain).join("\n");
    assert.match(row({ op: "add" }), /^│ \+ Added +One \+2 more +0\/3$/, "a collapsed add is one row naming the first task");
    assert.match(row({ op: "update", id: "t2" }), /^│ · Updated +Two +0\/3$/);
    const render = (args) => tool.renderResult(result, { expanded: true }, theme, { args }).render(80).map(plain).join("\n");
    assert.match(render({ op: "add" }), /^╭ Tasks /);
    assert.doesNotMatch(render({ op: "add" }).split("\n")[0], /\bresult\b/);
    assert.match(render({ op: "add" }), /One[\s\S]*Two[\s\S]*Three/);
    assert.doesNotMatch(render({ op: "add" }), /revision|0\/3/);
    assert.match(render({ op: "add" }), /\+ Added 3 tasks · not started/);
    assert.equal((render({ op: "add" }).match(/Added 3 tasks/g) ?? []).length, 1, "one acknowledgment for a batch");
    assert.match(render({ op: "add" }), /○ One/);
    assert.doesNotMatch(render({ op: "add" }), /\bpending\b/);
    assert.equal(result.details.plan.tasks[0].status, "pending", "the display label does not change stored state");
    for (const selected of [getThemeByName("dark"), getThemeByName("light")]) {
      const card = tool.renderResult(result, { expanded: true }, selected, { args: { op: "add", items: [1, 2, 3] } }).render(80);
      assert.ok(card.some(line => line.includes(selected.style("+ Added 3 tasks · not started", { fg: "accent", bold: false }))));
    }
    assert.match(render({ op: "update", id: "t2" }), /Updated · not started/);
    assert.match(render({ op: "update", id: "t2" }), /○ Two/);
    assert.doesNotMatch(render({ op: "update", id: "t2" }), /○ One|○ Three|Task ·/);
    const emptyHistory = tool.renderResult({ content: [], details: { plan: result.details.plan, plans: [] } }, { expanded: true }, theme, { args: { op: "plans" } }).render(80).map(plain).join("\n");
    assert.match(emptyHistory, /No saved plans/);
    const error = tool.renderResult({ content: [{ type: "text", text: "Update rejected" }] }, {}, theme, { args: { op: "update" } }).render(80);
    assert.match(plain(error.join("\n")), /Update rejected/);
    assert.ok(error[1].includes(theme.fg("error", "Update rejected")));
    const next = await h.call({ op: "add", revision: JSON.parse(result.content[0].text).revision, items: [{ title: "Four" }] });
    assert.match(tool.renderResult(next, {}, theme, { args: { op: "add" } }).render(80).map(plain).join("\n"), /\+ Added +Four +0\/4/, "the result's own added IDs name the task");
    const single = tool.renderResult(next, { expanded: true }, theme, { args: { op: "add", items: [{ title: "Four" }] } }).render(80).map(plain).join("\n");
    assert.match(single, /\+ Added 1 task · not started/);
    assert.match(single, /○ Four/);
  } finally { await h.close(); }
});
test("task transcript cards wrap full titles and show status without a row cutoff", async () => {
  const h = await harness();
  try {
    await h.emit("session_start");
    const initial = JSON.parse((await h.call({ op: "list" })).content[0].text);
    const title = "Review Unicode 界面 and all the long implementation details through the final acceptance checkpoint";
    const args = { op: "create", revision: initial.revision, title: "Full card", items: Array.from({ length: 15 }, (_, i) => ({ title: `${i} ${title}` })) };
    const result = await h.call(args);
    const tool = h.tools.get("tasks");
    for (const width of [12, 30, 80]) {
      assert.ok(tool.renderResult(result, { expanded: false }, theme, { args }).render(width).every(line => visibleWidth(line) <= width));
      const lines = tool.renderResult(result, { expanded: true }, theme, { args }).render(width).map(plain);
      assert.ok(lines.every(line => visibleWidth(line) <= width));
      const joined = lines.slice(1, -1).map(line => line.slice(1, -1).trimEnd()).join("").replace(/\s+/g, "");
      for (let i = 0; i < 15; i++) assert.ok(joined.includes(`○ ${i} ${title}`.replace(/\s+/g, "")));
      assert.doesNotMatch(joined, /…|pending/);
    }
    const updateArgs = { op: "update", revision: JSON.parse(result.content[0].text).revision, id: "t15", changes: { status: "active" } };
    const updated = await h.call(updateArgs);
    for (const selected of [getThemeByName("dark"), getThemeByName("light")]) {
      const pending = tool.renderCall(updateArgs, selected, { isPartial: true }).render(80);
      assert.equal(pending.length, 1);
      assert.match(plain(pending[0]), /^│ ◌ Updating +…$/);
      assert.deepEqual(tool.renderCall(updateArgs, selected, { isPartial: false }).render(80), [], "completed call yields to result");
      assert.deepEqual(tool.renderCall(updateArgs, selected, { isPartial: false, isError: true }).render(80), [], "failed call yields to error");
      for (const width of [8, 12, 30, 80]) {
        const lines = tool.renderCall(updateArgs, selected, { isPartial: true }).render(width);
        assert.ok(lines.every(line => visibleWidth(line) <= width));
      }
    }
    assert.match(plain(tool.renderResult(updated, { expanded: false }, theme, { args: updateArgs }).render(80)[0]), /^│ ◉ Started +14 Review/);
    const text = tool.renderResult(updated, { expanded: true }, theme, { args: updateArgs }).render(30).map(plain).slice(1, -1).map(line => line.slice(1, -1).trimEnd()).join("").replace(/\s+/g, "");
    assert.ok(text.includes(`◉ 14 ${title}`.replace(/\s+/g, "")));
    assert.doesNotMatch(text, /pending/);
  } finally { await h.close(); }
});

test("Pi transcript replaces a pending Tasks call with its final result, including restored results and failures", async () => {
  const h = await harness();
  try {
    await h.emit("session_start");
    const tool = h.tools.get("tasks");
    const args = { op: "update", id: "t1", changes: { status: "active" } };
    const component = () => new ToolExecutionComponent("tasks", "test-call", args, {}, tool, h.tui, h.scratch);
    const card = component();
    assert.match(plain(card.render(80).join("\n")), /◌ Updating/);
    const result = { content: [], details: { plan: { tasks: [{ id: "t1", title: "Check the outcome", status: "active" }] } }, isError: false };
    card.updateResult(result);
    const completed = plain(card.render(80).join("\n"));
    assert.match(completed, /◉ Started +Check the outcome/);
    assert.doesNotMatch(completed, /Updating/);
    const restored = component();
    restored.updateResult(result);
    assert.equal(plain(restored.render(80).join("\n")), completed);
    const failed = component();
    failed.updateResult({ content: [{ type: "text", text: "Revision expired" }], isError: true });
    const failure = plain(failed.render(80).join("\n"));
    assert.match(failure, /× Tasks/); assert.match(failure, /Revision expired/);
    assert.doesNotMatch(failure, /Updating/);
  } finally { await h.close(); }
});

test("Tasks summaries use semantic theme colors without changing status text or source state", async () => {
  const { taskResultCard } = await jiti.import(join(source, "transcript.ts"));
  const tasks = ["done", "active", "blocked", "pending", "cancelled"].map((status, i) => ({
    id: `t${i + 1}`, title: `Task 界面 ${i + 1}`, status, reason: status === "blocked" ? "Approval" : "",
  }));
  const details = { plan: { tasks } }, before = structuredClone(details);
  for (const name of ["dark", "light"]) {
    const selected = getThemeByName(name);
    const labels = ["Done", "In progress", "Blocked", "Not started", "Dropped"];
    const tones = ["success", "accent", "warning", "muted", "muted"];
    tasks.forEach((task, i) => {
      for (const updated of [false, true]) {
        const args = { op: "update", id: task.id, changes: updated ? {} : { status: task.status } };
        const text = updated ? `Updated · ${labels[i].toLowerCase()}` : labels[i];
        for (const expanded of [false, true]) {
          const rows = taskResultCard(details, args, expanded, selected, 100);
          assert.ok(rows[0].includes(selected.fg(tones[i], text)), `${name}: ${text}`);
          assert.ok(rows[0].includes(selected.style(" Tasks ", { fg: selected.colors.accent })));
          assert.match(plain(rows[0]), new RegExp(text));
        }
        for (const width of [1, 8, 12, 24, 40]) {
          const rows = taskResultCard(details, args, false, selected, width);
          assert.ok(rows.every(row => visibleWidth(row) <= width));
        }
      }
    });
    const mixed = taskResultCard(details, { op: "list" }, false, selected, 140)[0];
    assert.ok(mixed.includes(selected.fg("muted", "1 of 5 done")));
    assert.ok(mixed.includes(selected.fg("accent", " · 1 working")));
    assert.ok(mixed.includes(selected.fg("warning", " · 1 blocked")));
    assert.ok(mixed.includes(selected.fg("muted", " · 1 cancelled")));
    assert.match(plain(mixed), /1 of 5 done · 1 working · 1 blocked · 1 cancelled/);
    const complete = { plan: { tasks: tasks.map(t => ({ ...t, status: "done" })) } };
    assert.ok(taskResultCard(complete, { op: "list" }, false, selected, 100)[0].includes(selected.fg("success", "5 of 5 done")));
  }
  assert.deepEqual(details, before);
});

test("Tasks frame matches assistant lavender in dark/light themes, while body remains its own color", () => {
  for (const name of ["dark", "light"]) {
    const selected = getThemeByName(name), color = taskFrameColor(selected);
    const frame = taskFrame(selected, 40, [selected.fg("warning", "Blocked task")], "Tasks", "1 blocked");
    assert.ok(frame[0].includes(selected.style("╭", { fg: color })));
    assert.ok(frame[0].includes(selected.style(" Tasks ", { fg: color })));
    assert.ok(frame[1].includes(selected.fg("warning", "Blocked task")), "frame does not recolor task contents");
    assert.ok(frame.every(line => visibleWidth(line) === 40));
    assert.deepEqual(taskFrame(selected, 8, ["Narrow"], "Tasks"), ["Narrow"]);
  }
});

const bookWrite = (b, action, actor = "agent", now = 1000) => mutateBook(b, b.revision, action, actor, now);
const create = (b, title, titles = ["Read", "Build", "Check"], actor = "agent") => bookWrite(b, { op: "create", title, items: titles.map((title) => ({ title })) }, actor);
const taskWrite = (b, id, changes, actor = "agent", now = 2000) => bookWrite(b, { op: "task", planId: b.selectedId, mutation: { op: "update", id, changes } }, actor, now);

test("completed work stays quiet and full outcome details wrap and scroll", () => {
  let b = create(emptyBook(), "Preview");
  b = taskWrite(b, "t1", { status: "done", note: "Inspected task state, dock hosts, question theme and rendering. Confirmed the final words remain visible." });
  const tui = { terminal: { rows: 40 }, requestRender() {} };
  const panel = new TaskPanel(tui, theme, () => b, () => undefined, () => {});
  assert.doesNotMatch(plain(panel.render(60).join("\n")), /Inspected task state/);
  panel.handleInput("f"); panel.handleInput("\x1b[B"); panel.handleInput("\x1b[B"); panel.handleInput("\r");
  const lines = panel.render(60);
  assert.match(plain(lines.join("\n")), /remain visible\./);
  assert.ok(lines.every(line => visibleWidth(line) <= 60));
  b = taskWrite(b, "t1", { note: "Long finding with Unicode 界面. ".repeat(35) });
  tui.terminal.rows = 24;
  const clipped = panel.render(40);
  assert.match(plain(clipped.join("\n")), /↑↓ scroll/);
  for (let i = 0; i < 999; i++) panel.handleInput("\x1b[B");
  assert.match(plain(panel.render(40).join("\n")), /Long finding|Unicode/);
  assert.ok(clipped.length <= Math.floor(24 * .85));
});

test("legacy migration is deterministic, lossless, read-only until a mutation and branch-local", async () => {
  let legacy = add(emptyPlan(), ["Original accepted task", "Original blocker"]);
  legacy = update(legacy, "t1", { status: "done", note: "Accepted by user", evidence: "artifact 界面" }, "user");
  legacy = update(legacy, "t2", { status: "blocked", reason: "Waiting for approval", dependsOn: ["t1"] });
  assert.deepEqual(migratePlan(legacy), migratePlan(legacy));
  assert.deepEqual(migratePlan(legacy).plans[0].state, legacy);
  const h = await harness();
  try {
    h.entries.push({ type: "custom", customType: ENTRY, data: legacy });
    await h.emit("session_start");
    assert.equal(h.entries.length, 1, "opening a legacy session does not rewrite history");
    assert.deepEqual((await h.call({ op: "list" })).details.plan, legacy);
    const forkPoint = structuredClone(h.entries);
    await h.command("tasks", "new Next request");
    const entry = h.entries.at(-1); assert.equal(entry.customType, BOOK_ENTRY);
    assert.equal(entry.data.plans.length, 2); assert.deepEqual(entry.data.plans[0].state, legacy);
    assert.equal(entry.data.plans[1].title, "Next request");
    await h.emit("session_compact"); assert.equal(JSON.parse((await h.call({ op: "plans" })).content[0].text).plans.length, 2);
    h.branch(forkPoint); await h.emit("session_tree");
    assert.equal(JSON.parse((await h.call({ op: "plans" })).content[0].text).plans.length, 1);
    assert.deepEqual((await h.call({ op: "list" })).details.plan, legacy);
  } finally { await h.close(); }
});

test("plans have stable identities, isolated tasks and an optimistic revision covering selection", () => {
  let b = create(emptyBook(), "First 界面 request");
  b = taskWrite(b, "t1", { status: "active" });
  const first = structuredClone(b.plans[0]), oldRevision = b.revision;
  b = create(b, "Second request");
  assert.equal(b.selectedId, "p2"); assert.deepEqual(b.plans[0], first);
  assert.equal(b.plans[1].state.tasks[0].id, "t1", "task IDs are local to their plan");
  assert.throws(() => mutateBook(b, oldRevision, { op: "task", planId: "p1", mutation: { op: "update", id: "t1", changes: { title: "stale" } } }, "agent"), /plan changed/);
  assert.throws(() => bookWrite(b, { op: "task", planId: "p1", mutation: { op: "update", id: "t1", changes: { title: "wrong plan" } } }), /Select this plan/);
  assert.match(bookContext(b), /Other unfinished plans \(paused/);
  const beforeSecond = structuredClone(b.plans[1]);
  b = bookWrite(b, { op: "select", planId: "p1" });
  b = taskWrite(b, "t1", { title: "Resume the first request" });
  assert.deepEqual(b.plans[1], beforeSecond);
  assert.equal(b.plans[0].state.tasks[0].status, "active", "select does not mutate task statuses or auto-start anything");
  assert.deepEqual(restoreBook(b), b);
});

test("a write may omit the revision, while a supplied stale revision still fails closed", async () => {
  // Library-level: omission applies to live state; a stale assertion is rejected.
  let b = create(emptyBook(), "First request");
  const stale = b.revision;
  b = bookWrite(b, { op: "task", planId: b.selectedId, mutation: { op: "update", id: "t1", changes: { status: "active" } } });
  assert.throws(() => mutateBook(b, stale, { op: "task", planId: b.selectedId, mutation: { op: "update", id: "t1", changes: { title: "stale" } } }, "agent"), /plan changed/);
  b = mutateBook(b, undefined, { op: "task", planId: b.selectedId, mutation: { op: "update", id: "t1", changes: { title: "Live update" } } }, "agent");
  assert.equal(b.plans[0].state.tasks[0].title, "Live update");

  // Tool-level: a small model that omits the field still creates and updates.
  const h = await harness();
  try {
    await h.emit("session_start");
    const created = JSON.parse((await h.call({ op: "create", title: "No revision supplied", items: [{ title: "First step" }] })).content[0].text);
    assert.equal(created.title, "No revision supplied");
    const updated = JSON.parse((await h.call({ op: "update", id: "t1", changes: { status: "done", note: "Finished without echoing a token" } })).content[0].text);
    assert.equal(updated.counts, "1 of 1 done");
    await assert.rejects(h.call({ op: "update", revision: "stale-revision", id: "t1", changes: { status: "active" } }), /plan changed/);
  } finally { await h.close(); }
});

test("archives are reversible, user-owned, and cannot be bypassed by agent writes or restore", () => {
  let b = create(emptyBook(), "Paused work");
  assert.throws(() => bookWrite(b, { op: "archive", planId: "p1" }), /Only the user/);
  b = bookWrite(b, { op: "archive", planId: "p1" }, "user");
  assert.equal(b.selectedId, null); assert.equal(b.plans[0].archivedBy, "user");
  assert.throws(() => bookWrite(b, { op: "select", planId: "p1" }), /archived/);
  assert.throws(() => bookWrite(b, { op: "restore", planId: "p1" }), /Only the user/);
  assert.throws(() => bookWrite(b, { op: "task", planId: "p1", mutation: { op: "add", items: [{ title: "Recreated" }] } }), /Archived/);
  const old = structuredClone(b.plans[0].state);
  b = create(b, "An unrelated request"); assert.deepEqual(b.plans[0].state, old);
  b = bookWrite(b, { op: "restore", planId: "p1" }, "user");
  assert.equal(b.selectedId, "p1"); assert.equal(b.plans[0].archivedAt, null); assert.deepEqual(b.plans[0].state, old);
  b = bookWrite(b, { op: "task", mutation: { op: "clear" } }, "user");
  assert.throws(() => create(b, "Bypass the clear"), /user cleared/);
  b = create(b, "Explicit fresh start", [], "user"); assert.equal(b.userCleared, false);
});

test("completion time persists, survives edits, resets on reopening and does not mislabel cancellations", () => {
  let b = create(emptyBook(), "Finish this", ["Only task"]);
  assert.equal(selectedPlan(b).closedAt, null);
  b = taskWrite(b, "t1", { status: "done", note: "Verified" }, "agent", 2000);
  assert.equal(selectedPlan(b).closedAt, 2000);
  b = taskWrite(b, "t1", { evidence: "test log" }, "agent", 9000); assert.equal(selectedPlan(b).closedAt, 2000);
  b = taskWrite(b, "t1", { status: "pending" }); assert.equal(selectedPlan(b).closedAt, null);
  b = taskWrite(b, "t1", { status: "cancelled" }); assert.equal(planInfo(selectedPlan(b), b).state, "closed");
  assert.equal(bookWrite(b, { op: "archive", planId: "p1" }).plans[0].archivedBy, "agent");
});

test("library restore rejects invalid IDs, selection, archives and limits without partial mutation", () => {
  const b = create(emptyBook(), "Valid");
  assert.throws(() => restoreBook({ ...b, selectedId: "p999" }), /current plan/);
  assert.throws(() => restoreBook({ ...b, plans: [...b.plans, ...b.plans] }), /Duplicate/);
  assert.throws(() => restoreBook({ ...b, plans: [{ ...b.plans[0], closedAt: 2000 }] }), /completion state/);
  assert.throws(() => restoreBook({ ...b, plans: [{ ...b.plans[0], archivedBy: "user" }] }), /Invalid saved/);
  assert.throws(() => create(b, "x".repeat(121)), /120/);
  assert.throws(() => create(b, "Atomic failure", ["okay", "x".repeat(201)]), /200/);
  assert.equal(b.plans.length, 1);
  let many = emptyBook();
  for (let i = 0; i < 100; i++) many = create(many, "Plan " + i, []);
  assert.throws(() => create(many, "Over capacity", []), /100 saved plans/);
  assert.equal(many.plans.length, 100);
});

test("tool creates and reads plan history without switching it; stale cross-plan edits are rejected", async () => {
  const h = await harness();
  const payload = async (args) => JSON.parse((await h.call(args)).content[0].text);
  try {
    await h.emit("session_start");
    let current = await payload({ op: "plans" });
    current = await payload({ op: "create", revision: current.revision, title: "First request", items: [{ title: "First item" }] });
    assert.equal(current.planId, "p1"); assert.deepEqual(current.addedIds, ["t1"]);
    current = await payload({ op: "create", revision: current.revision, title: "Second request", items: [{ title: "Second item" }] });
    const history = await payload({ op: "list", planId: "p1" });
    assert.equal(history.selectedId, "p2"); assert.equal(history.tasks[0].title, "First item");
    await assert.rejects(h.call({ op: "update", planId: "p1", revision: history.revision, id: "t1", changes: { title: "Don't update the wrong plan" } }), /Select this plan/);
    current = await payload({ op: "select", planId: "p1", revision: current.revision });
    await assert.rejects(h.call({ op: "update", planId: "p1", revision: history.revision, id: "t1", changes: { title: "stale" } }), /plan changed/);
    current = await payload({ op: "update", planId: "p1", revision: current.revision, id: "t1", changes: { status: "done", note: "Finished" } });
    const archived = await payload({ op: "archive", revision: current.revision });
    assert.equal(archived.planId, "p1", "archive returns the identity it changed even when it deselects it");
    assert.equal(archived.selectedId, null);
    const firstPage = await payload({ op: "plans", limit: 1 }); assert.equal(firstPage.nextOffset, 1); assert.equal(firstPage.total, 2);
    const secondPage = await payload({ op: "plans", offset: 1 }); assert.equal(secondPage.plans[0].state, "archived");
    assert.equal(h.handlers.has("agent_before_settle"), false);
  } finally { await h.close(); }
});

test("v2/v3 libraries migrate to the checklist form and discard the retired requirement ledger", async () => {
  for (const version of [2, 3]) {
    const legacy = create(emptyBook(), "Existing work", ["One", "Two"]);
    legacy.version = version;
    for (const p of legacy.plans) p.requirements = [{ id: "r1", title: "Retired", source: "User: x", acceptance: "y",
      taskIds: ["t1"], disposition: "accepted", reason: "", updatedBy: "agent" }];
    const migrated = restoreBook(legacy);
    assert.equal(migrated.version, 4);
    assert.equal("requirements" in migrated.plans[0], false);
    assert.deepEqual(migrated.plans[0].state, legacy.plans[0].state);
    assert.equal(planInfo(migrated.plans[0], migrated).state, "open");
    assert.deepEqual(restoreBook(migrated), migrated);
  }
  assert.throws(() => restoreBook({ ...emptyBook(), version: 5 }), /Unsupported/);

  // Closure follows the checklist, not a retired coverage ledger.
  const done = taskWrite(create(emptyBook(), "Finished", ["Only"]), "t1", { status: "done", note: "Verified" });
  for (const p of done.plans) p.requirements = [{ id: "r1", title: "Uncovered", source: "User: x", acceptance: "y",
    taskIds: [], disposition: "accepted", reason: "", updatedBy: "agent" }];
  assert.notEqual(restoreBook(done).plans[0].closedAt, null);

  const h = await harness();
  try {
    h.entries.push({ type: "custom", customType: BOOK_ENTRY, data: { ...done, version: 3 } });
    await h.emit("session_start");
    assert.equal(h.entries.length, 1, "migration is read-only until a mutation");
    const listed = JSON.parse((await h.call({ op: "list" })).content[0].text);
    assert.equal(listed.tasks.length, 1);
    assert.equal(listed.tasks[0].status, "done");
  } finally { await h.close(); }
});


test("completed plans leave both dock implementations on schedule, remain in history, and do not flash again on resume", async (t) => {
  const h = await harness({ egregore: true });
  const snapshot = () => h.widgets.get("pi-egregore:dock").render(110).map(plain).join("\n");
  try {
    await h.emit("session_start"); await h.command("tasks", "new Ephemeral checklist"); await h.command("tasks", "add One task");
    const p = (await h.call({ op: "list" })).details.plan;
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
    await h.call({ op: "update", revision: p.revision, id: "t1", changes: { status: "done", note: "Done" } });
    const saved = h.entries.length;
    assert.match(snapshot(), /Plan finished/); assert.doesNotMatch(snapshot(), /✓ One task/);
    t.mock.timers.tick(COMPLETION_MS + 10);
    assert.doesNotMatch(snapshot(), /Plan finished/);
    assert.doesNotMatch(snapshot(), /Ephemeral checklist/, "the finished plan leaves the dock; /tasks history keeps it");
    assert.equal(h.entries.length, saved, "expiry is UI-only, not a persistent plan edit");
    assert.equal(JSON.parse((await h.call({ op: "plans" })).content[0].text).plans[0].state, "completed");
    await h.emit("session_tree"); assert.doesNotMatch(snapshot(), /Plan finished/);
    await h.command("composer", "off"); assert.equal(h.widgets.has("pi-tasks:fallback"), false);
    const current = (await h.call({ op: "list" })).details.plan;
    await h.call({ op: "update", revision: current.revision, id: "t1", changes: { status: "pending" } });
    assert.ok(h.widgets.has("pi-tasks:fallback"));
    const reopened = (await h.call({ op: "list" })).details.plan;
    await h.call({ op: "update", revision: reopened.revision, id: "t1", changes: { status: "done", note: "Done again" } });
    t.mock.timers.tick(COMPLETION_MS + 10); assert.equal(h.widgets.has("pi-tasks:fallback"), false);
    await h.close(); t.mock.timers.tick(10_000); assert.equal(h.widgets.size, 0);
  } finally { t.mock.timers.reset(); if (process.env.PI_CODING_AGENT_DIR === h.scratch) await h.close(); }
});

test("manual new preserves earlier plans, stale dialogs cannot overwrite them, and off/on retains the whole library", async () => {
  const h = await harness();
  try {
    await h.emit("session_start"); await h.command("tasks", "new User named plan"); await h.command("tasks", "add User item");
    let answer;
    h.context.ui.input = () => new Promise((resolve) => answer = resolve);
    const pending = h.command("tasks", "new");
    const revision = JSON.parse((await h.call({ op: "plans" })).content[0].text).revision;
    await h.call({ op: "create", revision, title: "Agent plan" });
    answer("Stale dialog plan"); await pending;
    assert.equal(JSON.parse((await h.call({ op: "plans" })).content[0].text).total, 2);
    assert.match(h.notices.at(-1).text, /plan changed/);
    await h.command("tasks", "archive p1");
    await h.command("tasks", "restore p1");
    assert.equal((await h.call({ op: "list" })).details.plan.tasks[0].title, "User item");
    const before = h.entries.at(-1).data;
    await h.command("tasks", "off"); await h.emit("session_start"); await h.command("tasks", "on");
    assert.deepEqual(h.entries.at(-1).data, before);
    assert.equal(JSON.parse((await h.call({ op: "plans" })).content[0].text).total, 2);
  } finally { await h.close(); }
});

test("raised panel library opens plans read-only and stale rendered task edits are ignored", async () => {
  let b = create(emptyBook(), "First plan"); b = create(b, "Second plan");
  let result, paints = 0;
  const nav = {};
  const panel = new TaskPanel({ terminal: { rows: 40 }, requestRender() { paints++; } }, theme, () => b, () => undefined, (r) => result = r, nav);
  const lines = panel.render(90), revision = b.revision;
  assert.match(plain(lines[0]), /╭.*Tasks.*╮/);
  for (const line of lines) { assert.equal(visibleWidth(line), 90); assert.match(line, /\x1b\[48;/, "every modal row has an explicit surface"); }
  panel.handleInput("h"); panel.render(90);
  assert.match(panel.render(90).map(plain).join("\n"), /╭.*Plans.*╮/);
  for (const group of ["Current", "Open"]) assert.match(panel.render(90).map(plain).join("\n"), new RegExp(group));
  panel.handleInput("\x1b[B"); panel.handleInput("\r");
  assert.equal(nav.viewId, "p1"); assert.equal(b.selectedId, "p2"); assert.equal(b.revision, revision);
  assert.match(panel.render(90).map(plain).join("\n"), /Open · 0 of 3 done/);
  panel.handleInput("\r"); assert.equal(result, undefined, "opening a historical task shows details only");
  panel.handleInput("\x1b");
  panel.handleInput("s"); assert.deepEqual(result, { op: "select", planId: "p1", revision, id: undefined });
  b = bookWrite(b, { op: "select", planId: "p1" }, "user"); panel.render(90); result = undefined;
  b = taskWrite(b, "t1", { title: "Changed since last paint" }); panel.handleInput("e");
  assert.equal(result, undefined); assert.ok(paints > 0);
  panel.render(90); panel.handleInput("e"); assert.equal(result.revision, b.revision);
  for (const rows of [8, 12, 24, 40]) for (const width of [1, 2, 8, 20, 48, 90, 140]) {
    const p = new TaskPanel({ terminal: { rows }, requestRender() {} }, theme, () => b, () => undefined, () => {});
    for (const mode of ["", "?", "h", "v"]) { if (mode) p.handleInput(mode); const rendered = p.render(width); assert.ok(rendered.length <= Math.max(4, Math.floor(rows * .85))); for (const line of rendered) assert.ok(visibleWidth(line) <= width); }
  }
});

test("Composer dock is responsive, motion-off stays still, and shows only sourced work", () => {
  const state = { prefs: { ...DEFAULTS, motion: "off" }, clock: new RunClock(), phase: "thinking", tools: new Map(), promptDepth: 0, compacting: false, lastInputAt: 0 };
  const tui = { terminal: { rows: 40 }, requestRender() {} };
  const ctx = { ui: { theme }, sessionManager: { getSessionName: () => "My 界面 plan" } };
  const docks = new Map([["test", { title: "Plan", rows: [{ text: "○ Real work" }], hint: "/tasks" }]]);
  let now = 1000;
  const egregore = createDock(tui, () => ctx, state, docks, () => true, () => now);
  const first = egregore.render(100); now = 5000;
  assert.deepEqual(egregore.render(100), first);
  assert.match(first.map(plain).join("\n"), /Real work/);
  assert.doesNotMatch(first.map(plain).join("\n"), /DEMO|Finding the shape|mission/i);
  for (const height of [16, 24, 30, 40]) {
    tui.terminal.rows = height;
    for (const width of [1, 2, 8, 20, 48, 80, 140]) for (const line of egregore.render(width)) assert.ok(visibleWidth(line) <= width);
  }
  docks.clear();
  assert.deepEqual(egregore.render(100), [], "without a real provider, no demo or artwork appears");
  assert.equal(isSnapshot({ version: 1, sessionId: "test", id: "id", title: "Okay", rows: [{ text: "x", tone: "invalid" }] }), false);
  assert.equal(isHost({ version: 1, sessionId: "test", available: true, colors: {} }), false);
});

test("panel help lists every key, F reveals completed work and the library groups and searches plans", () => {
  let b = emptyBook();
  b = create(b, "Archived plan", ["Old work"]); b = bookWrite(b, { op: "archive", planId: "p1" }, "user");
  b = create(b, "Photos for Mom", ["Choose cover"]);
  b = create(b, "Finished plan", ["Only"]); b = taskWrite(b, "t1", { status: "done", note: "Done" });
  b = create(b, "Current plan", ["Print"]);
  const nav = {};
  const panel = new TaskPanel({ terminal: { rows: 24 }, requestRender() {} }, theme, () => b, () => undefined, () => {}, nav);
  panel.render(64);
  panel.handleInput("?");
  let help = panel.render(64).map(plain).join("\n");
  assert.match(help, /N  new plan/); assert.match(help, /R  restore archived/);
  for (let i = 0; i < 20; i++) { panel.handleInput("\x1b[B"); help = panel.render(64).map(plain).join("\n"); }
  assert.match(help, /O      turn Tasks off/); assert.match(help, /Esc    close the panel/, "help scrolls to every key");
  panel.handleInput("x"); // Every other key is ignored while help is open.
  assert.match(panel.render(64).map(plain).join("\n"), /N  new plan/);
  panel.handleInput("\x1b");
  assert.doesNotMatch(panel.render(64).map(plain).join("\n"), /N  new plan/);
  panel.tui.terminal.rows = 40;
  panel.handleInput("h");
  for (let i = 0; i < 2; i++) panel.handleInput("\x1b[B"); // Library order: Current, Open, Finished…
  panel.handleInput("\r");
  panel.handleInput("f");
  assert.match(panel.render(80).map(plain).join("\n"), /\u2713 Only/, "F reveals completed work");
  panel.handleInput("f");
  assert.doesNotMatch(panel.render(80).map(plain).join("\n"), /\u2713 Only/);
  panel.handleInput("h");
  const groups = ["Current", "Open", "Finished", "Archived"];
  const lib = panel.render(64).map(plain).join("\n");
  for (const group of groups) assert.match(lib, new RegExp(group), `library groups include ${group}`);
  const order = groups.map(group => lib.indexOf(group));
  assert.deepEqual([...order].sort((a, c) => a - c), order, "library groups keep their fixed order");
  assert.match(lib, /Photos for Mom/);
  panel.handleInput("/");
  for (const char of "photos") panel.handleInput(char);
  const filtered = panel.render(64).map(plain).join("\n");
  assert.match(filtered, /Search: photos/); assert.match(filtered, /Photos for Mom/);
  assert.doesNotMatch(filtered, /Current plan|Finished plan|Archived plan/);
  panel.handleInput("\r");
  assert.doesNotMatch(panel.render(64).map(plain).join("\n"), /Search: photos/, "Enter keeps the filter and closes search");
  panel.handleInput("/");
  for (const char of "zzz") panel.handleInput(char);
  assert.match(panel.render(64).map(plain).join("\n"), /No plans match "zzz" · Esc clears/);
  panel.handleInput("\x1b");
  assert.doesNotMatch(panel.render(64).map(plain).join("\n"), /No plans match/);
});

test("work rows select by the clicked screen line, title or subline", () => {
  let b = create(emptyBook(), "Click plan", ["Print", "Mail"]);
  b = taskWrite(b, "t1", { status: "active" });
  const nav = {};
  const panel = new TaskPanel({ terminal: { rows: 24 }, requestRender() {} }, theme, () => b, () => undefined, () => {}, nav);
  const lines = panel.render(80).map(plain);
  const title = lines.findIndex(line => line.includes("○ Mail"));
  assert.notEqual(title, -1);
  assert.ok(panel.handleMouse({ type: "click", button: "left", x: 2, y: title })?.handled);
  assert.equal(nav.key, "t:t2", "the clicked title selects its task");
  const subline = panel.render(80).map(plain).findIndex(line => line.includes("Paused"));
  assert.notEqual(subline, -1);
  assert.ok(panel.handleMouse({ type: "click", button: "left", x: 2, y: subline })?.handled);
  assert.equal(nav.key, "t:t1", "the clicked subline selects its task");
});

test("library clicks resolve the clicked plan title and subline, including after scrolling", () => {
  let b = emptyBook();
  const ids = new Map();
  for (let i = 1; i <= 12; i++) {
    const title = `Photo set ${String(i).padStart(2, "0")}`;
    b = create(b, title, [`Task ${i}`]);
    ids.set(title, selectedPlan(b).id);
  }
  b = bookWrite(b, { op: "select", planId: "p4" }, "user");
  const nav = { history: true };
  const panel = new TaskPanel({ terminal: { rows: 12 }, requestRender() {} }, theme, () => b, () => undefined, () => {}, nav);
  const click = (y, title, row) => {
    const handled = panel.handleMouse({ type: "click", button: "left", x: 2, y });
    assert.ok(handled?.handled, `${title} ${row} at y=${y} was not clickable`);
  };
  // Coordinates come from the rendered screen, not from assumed offsets.
  const openAt = (title, row = 0) => {
    nav.history = true; nav.viewId = undefined; nav.planIndex = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      const lines = panel.render(80).map(plain);
      const y = lines.findIndex((line, index) => index > 0 && index < lines.length - 2 && line.includes(title));
      if (y >= 0) {
        if (row) assert.match(lines[y + 1], /\d+ of \d+ done · /, `${title} has a progress subline`);
        click(y + row, title, row ? "subline" : "title");
        return nav.viewId;
      }
      panel.handleInput("\x1b[B");
    }
    assert.fail(`${title} never became visible`);
  };
  for (const title of ["Photo set 04", "Photo set 12"]) {
    assert.equal(openAt(title), ids.get(title), `${title} title opens its own plan`);
    assert.equal(openAt(title, 1), ids.get(title), `${title} subline opens its own plan`);
  }
  // Scroll to the end, then click coordinates from the scrolled screen.
  for (let i = 0; i < 12; i++) panel.handleInput("\x1b[B");
  assert.equal(openAt("Photo set 01"), ids.get("Photo set 01"), "scrolled title opens its own plan");
  assert.equal(openAt("Photo set 01", 1), ids.get("Photo set 01"), "scrolled subline opens its own plan");
});

test("the panel action bar never clips at 64 columns; keyboard help is the only route to destructive keys", () => {
  let b = create(emptyBook(), "Narrow plan", ["One", "Two", "Three"]);
  const panel = new TaskPanel({ terminal: { rows: 24 }, requestRender() {} }, theme, () => b, () => undefined, () => {}, {});
  const lines = panel.render(64).map(plain);
  assert.ok(lines.every(line => visibleWidth(line) <= 64), "every line fits 64 columns");
  assert.match(lines.at(-2), /\? help\s*│$/, "the last action-bar segment is the help key");
  for (const line of lines) assert.doesNotMatch(line, /Q requests|Tab\/|J questions|←→/);
  const help = (() => { panel.handleInput("?"); return panel.render(64).map(plain); })();
  assert.ok(help.every(line => visibleWidth(line) <= 64));
  assert.equal(help.length <= Math.floor(24 * .85), true);
});

test("a default panel shows the work view and keeps the F disclosure in the footer", () => {
  let b = create(emptyBook(), "Default view", ["Finished", ...Array.from({ length: 20 }, (_, i) => `Pending ${i + 1}`)]);
  b = taskWrite(b, "t1", { status: "done", note: "Done" });
  const nav = {}; // The command handler opens a fresh panel with no view; it must mean work.
  const panel = new TaskPanel({ terminal: { rows: 24 }, requestRender() {} }, theme, () => b, () => undefined, () => {}, nav);
  const lines = panel.render(80).map(plain);
  assert.doesNotMatch(lines.join("\n"), /Requests · read-only/);
  assert.match(lines.at(-2), /\? help\s*│$/);
  assert.match(lines.join("\n"), /▸ 1 done · F/, "the F disclosure survives a full list");
  panel.handleInput("f");
  assert.match(panel.render(80).map(plain).join("\n"), /▾ 1 done · F/, "F flips the disclosure");
  for (let i = 0; i < 20; i++) panel.handleInput("\x1b[B");
  assert.match(panel.render(80).map(plain).join("\n"), /✓ Finished/);
  // The action bar survives every supported height, not just the test's first geometry.
  for (const rows of [12, 24, 40]) for (const width of [40, 64, 80, 120]) {
    const sized = new TaskPanel({ terminal: { rows }, requestRender() {} }, theme, () => b, () => undefined, () => {}, {});
    const rendered = sized.render(width).map(plain);
    assert.ok(rendered.every(line => visibleWidth(line) <= width), `${rows}x${width}`);
    assert.match(rendered.at(-2), /\? help\s*│$/, `${rows}x${width}: action bar stays last`);
    assert.match(rendered.join("\n"), /▸ 1 done · F/, `${rows}x${width}: F is never clipped`);
  }
});

test("both hosts render the same rows, title and summary for one snapshot at width 80", async () => {
  const plan = { title: "Parity plan", tasks: [["Print 4x6 copies", "active"], ["Choose cover", "blocked"], ["Mail album", "pending"]] };
  const facts = { title: plan.title, rows: ["◉ Print 4x6 copies", "! Choose cover · waiting", "○ Mail album"], summary: "0 of 3 done · 1 blocked" };
  const rendered = {};
  for (const egregore of [false, true]) {
    const h = await harness({ egregore });
    try {
      await h.emit("session_start");
      let p = JSON.parse((await h.call({ op: "list" })).content[0].text);
      p = JSON.parse((await h.call({ op: "create", revision: p.revision, title: plan.title, items: plan.tasks.map(([title]) => ({ title })) })).content[0].text);
      p = JSON.parse((await h.call({ op: "update", revision: p.revision, id: "t1", changes: { status: "active" } })).content[0].text);
      p = JSON.parse((await h.call({ op: "update", revision: p.revision, id: "t2", changes: { status: "blocked", reason: "waiting" } })).content[0].text);
      await h.emit("agent_start");
      const text = [...h.widgets.values()].flatMap(w => w.render(80)).map(plain).join("\n");
      assert.match(text, /Parity plan/);
      assert.match(text, /0 of 3 done · 1 blocked/);
      for (const row of facts.rows) assert.ok(text.includes(row), `${egregore ? "egregore" : "fallback"}: ${row}`);
      rendered[egregore] = text;
    } finally { await h.close(); }
  }
  assert.deepEqual(facts.rows.length, 3);
  assert.ok(rendered.false && rendered.true);
});

test("native question bridge shows attention without gating task starts or completions", async () => {
  for (const order of ["ask-first", "tasks-first"]) {
    const h = await harness({ ask: true, egregore: true, order });
    try {
      await h.emit("session_start");
      const initial = JSON.parse((await h.call({ op: "list" })).content[0].text);
      const created = JSON.parse((await h.call({ op: "create", revision: initial.revision, title: "Native thread", items: [{ title: "Release boundary" }, { title: "Independent verification" }] })).content[0].text);
      await h.callQuestion({ op: "post", question: { question: "Keep it local?", why: "Release scope belongs to you.", boundary: "Release waits; verification continues.", urgency: "blocking", planId: "p1", taskIds: ["t1"] } });
      // A question is surfaced, not a lock: the checklist owner records real work state.
      await h.call({ op: "update", id: "t1", changes: { status: "active" } });
      await h.call({ op: "update", id: "t1", changes: { status: "done", note: "Applied the local-only choice" } });
      await h.call({ op: "update", id: "t2", changes: { status: "active" } });
      await assert.rejects(() => h.callQuestion({ op: "post", question: { question: "Unknown?", why: "Test", boundary: "Test", urgency: "blocking", planId: "p1", taskIds: ["t99"] } }), /unavailable/);
      const display = [...h.widgets.values()].flatMap(w => w.render(120)).map(plain).join("\n");
      assert.match(display, /1 waiting on you/); assert.match(display, /\? Keep it local\?/); assert.match(display, /1 of 2 done/);
      assert.equal(h.widgets.has("pi-ask:posted"), false, "Tasks owns the hosted attention hint, not duplicate Ask fallback");
      await h.command("tasks", "hide"); assert.ok(h.widgets.has("pi-ask:posted"), "hiding the dock does not hide Ask attention");
      await h.command("tasks", "unhide"); assert.equal(h.widgets.has("pi-ask:posted"), false, "visible Tasks hosts exactly one cue");
      await h.command("tasks", "off"); assert.ok(h.widgets.has("pi-ask:posted"), "standalone Ask returns when Tasks is off");
      await h.command("tasks", "on"); assert.equal(h.widgets.has("pi-ask:posted"), false);
    } finally { await h.close(); }
  }
});

test("unresolved questions lead the work list with readable plan links", () => {
  let b = emptyBook();
  b = mutateBook(b, b.revision, { op: "create", title: "First plan", items: [{ title: "First work" }] }, "agent", 1000);
  b = mutateBook(b, b.revision, { op: "create", title: "Second plan", items: [{ title: "Second work" }] }, "agent", 2000);
  const records = () => [
    { id: "q1", revision: 1, question: "First boundary?", state: "awaiting", urgency: "blocking", boundary: "First work waits", planId: "p1", taskIds: ["t1"] },
    { id: "q2", revision: 1, question: "Second boundary?", state: "awaiting", urgency: "deferred", boundary: "Can wait", planId: "p2", taskIds: ["t1"] },
    { id: "q3", revision: 1, question: "Standalone boundary?", state: "awaiting", urgency: "deferred", boundary: "No links", taskIds: [] },
  ];
  const nav = { viewId: "p2" };
  const panel = new TaskPanel({ terminal: { rows: 60 }, requestRender() {} }, theme, () => b, () => undefined, () => {}, nav, () => true,
    { available: true, records, open() {} });
  const text = () => panel.render(120).map(plain).join("\n");
  assert.match(text(), /Waiting on you · First plan \/ First work/);
  assert.match(text(), /When you're ready · Second plan \/ Second work/);
  assert.match(text(), /This session/);
  assert.ok(text().indexOf("First boundary?") < text().indexOf("○ Second work"), "questions lead the list");
  panel.handleInput("\x1b[B"); panel.handleInput("\x1b[B"); panel.handleInput("\x1b[B"); panel.handleInput("\r");
  assert.match(text(), /Questions/); assert.match(text(), /Second boundary/); assert.doesNotMatch(text(), /First boundary/);
});

test("Tasks keeps its selected question under an Ask overlay and stable across answer reordering", async () => {
  const h = await harness({ ask: true });
  try {
    await h.emit("session_start");
    await h.callQuestion({ op: "post", question: { question: "First question?", why: "First reason", boundary: "One boundary", urgency: "blocking" } });
    await h.callQuestion({ op: "post", question: { question: "Second question?", why: "Second reason", boundary: "Can wait", urgency: "deferred" } });
    const book = emptyBook(), nav = {}, forms = [];
    const records = () => h.entries.filter(e => e.customType === "pi-ask:posted-v1").at(-1).data.questions.map(q => ({ id: q.id, revision: q.revision, question: q.definition.question, urgency: q.urgency, state: q.state, boundary: q.boundary, taskIds: q.taskIds }));
    h.context.ui.custom = (make, options) => new Promise(resolve => { const component = make(h.tui, theme, kb, resolve); component.focused = true; forms.push({ component, options }); });
    const panel = new TaskPanel(h.tui, theme, () => book, () => undefined, () => assert.fail("answering must not close/edit Tasks"), nav, () => true,
      { available: true, records, open(q) { h.events.emit(POSTED.open, { version: 1, sessionId: "test-session", id: q.id, revision: q.revision }); } });
    panel.render(100); panel.handleInput("\r");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(forms.at(-1).options.overlay, true);
    forms.at(-1).component.handleInput("Keep it local"); forms.at(-1).component.handleInput("\x1b"); forms.at(-1).component.handleInput("\x1b");
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(nav.key, "q:q1"); assert.match(panel.render(100).map(plain).join("\n"), /› ! First question/);
    panel.handleInput("\r"); await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(forms.at(-1).component.render(80).map(plain).join("\n"), /Keep it local/);
    forms.at(-1).component.handleInput("\r"); forms.at(-1).component.handleInput("\r"); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(h.messages.length, 1);
    await h.emit("context", { messages: h.messages });
    const q = JSON.parse((await h.callQuestion({ op: "list" })).content[0].text).questions[0];
    await h.callQuestion({ op: "apply", id: q.id, revision: q.revision, reason: "A local handoff, not publication." });
    panel.render(100); assert.equal(nav.key, "q:q2", "an answered question leaves the list and the selection follows the remaining records");
  } finally { await h.close(); }
});

test("dock snapshots validate question attention metadata", () => {
  const base = { version: 1, sessionId: "test", id: "tasks", title: "Tasks", rows: [], overview: { revision: "r", total: 0, done: 0, blocked: 0, cancelled: 0, activeId: "t1", activeTitle: "Print" } };
  assert.equal(isSnapshot({ ...base, overview: { ...base.overview, questions: { blocking: -1, deferred: 0 } } }), false);
  assert.equal(isSnapshot({ ...base, overview: { ...base.overview, questions: { blocking: 1, deferred: 2 } } }), true);
});

test("compact typography uses semantic glyphs and neutral titles without changing records", async () => {
  const h = await harness();
  try {
    await h.emit("session_start"); const initial = JSON.parse((await h.call({ op: "list" })).content[0].text);
    const result = await h.call({ op: "create", revision: initial.revision, title: "Synthetic typography", items: ["Complete item", "Active item", "Blocked item", "Pending item", "Cancelled item"].map(title => ({ title })) });
    const states = ["done", "active", "blocked", "pending", "cancelled"];
    result.details.plan.tasks.forEach((t, i) => Object.assign(t, { status: states[i], note: i === 0 ? "Checked locally; not independently verified." : "", reason: i === 2 ? "Waiting for permission." : "" }));
    const before = structuredClone(result), tool = h.tools.get("tasks");
    for (const th of [getThemeByName("dark"), getThemeByName("light")]) {
      assert.match(plain(tool.renderResult(result, { expanded: false }, th, { args: { op: "list" } }).render(120)[0]), /^│ · Read +Synthetic typography · 5 tasks +2\/5$/);
      const lines = tool.renderResult(result, { expanded: true }, th, { args: { op: "list" } }).render(120);
      const text = lines.map(plain).join("\n");
      assert.match(text, /✓ Complete item/); assert.match(text, /◉ Active item/); assert.match(text, /! Blocked item/);
      assert.match(text, /○ Pending item/); assert.match(text, /– Cancelled item · cancelled/);
      assert.match(text, /Blocked: Waiting for permission/); assert.match(text, /1 working/);
      assert.doesNotMatch(text, /Task ·|Task done:|Task active:|verified complete/i);
      const complete = lines.find(line => plain(line).includes("Complete item"));
      assert.ok(complete.includes(th.fg("success", "✓ ")));
      assert.ok(complete.includes(th.style("Complete item", { fg: "text", bold: false })));
      assert.ok(!complete.includes(th.fg("success", "Complete item")), "success colors the mark, not the title");
      const expanded = text;
      assert.match(expanded, /Outcome · agent report/); assert.match(expanded, /not independently verified/); assert.match(expanded, /Reference\s+t1/);
    }
    assert.deepEqual(result, before, "rendering must never mutate stored outcomes");
  } finally { await h.close(); }
});

test("task cards stay bounded at every supported width", async () => {
  const h = await harness();
  try {
    await h.emit("session_start"); const initial = JSON.parse((await h.call({ op: "list" })).content[0].text);
    const result = await h.call({ op: "create", revision: initial.revision, title: "Width fixture", items: [{ title: "A long title 界面 🧭 e\u0301 with the final words preserved at normal widths" }] });
    const tool = h.tools.get("tasks");
    for (const th of [getThemeByName("dark"), getThemeByName("light")]) for (const width of [0, 1, 2, 8, 12, 30, 80, 200]) for (const expanded of [false, true]) {
      const lines = tool.renderResult(result, { expanded }, th, { args: { op: "list" } }).render(width);
      assert.ok(lines.every(line => visibleWidth(line) <= width), `width ${width}`);
      assert.ok(lines.every(line => !line.includes("\n")), "one physical line per rendered row");
    }
  } finally { await h.close(); }
});

test("native Tasks shares neutral status typography, short grouped details and distinct selection", () => {
  let b = create(emptyBook(), "Typography fixture", ["Completed item", "Active item", "Blocked item", "Pending item"]);
  b = taskWrite(b, "t1", { status: "done", note: "Synthetic outcome only.", evidence: "local fixture" });
  b = taskWrite(b, "t2", { status: "active" });
  b = taskWrite(b, "t3", { status: "blocked", reason: "Explicit permission is required." });
  const before = structuredClone(b);
  for (const th of [getThemeByName("dark"), getThemeByName("light")]) {
    const nav = { showDone: true }, panel = new TaskPanel({ terminal: { rows: 60 }, requestRender() {} }, th, () => b, () => undefined, () => {}, nav, () => true);
    const work = panel.render(150), text = work.map(plain).join("\n");
    assert.match(text, /› ├─ ◉ Active item/); assert.match(text, /✓ Completed item/); assert.match(text, /! Blocked item/);
    assert.match(text, /! Blocked item[\s\S]*Explicit permission is required/); assert.match(text, /Working/);
    assert.doesNotMatch(text, /Completion reported|Task · done|Current plan/);
    const complete = work.find(line => plain(line).includes("Completed item"));
    assert.ok(complete.includes(th.style("└─ ✓ ", { fg: th.colors.success })));
    assert.ok(complete.includes(th.style("Completed item", { fg: th.colors.text, bold: false })));
    const active = work.find(line => plain(line).includes("Active item"));
    assert.ok(active.includes(th.style("Active item", { fg: th.colors.text, bold: true })), "active title stands out independently of selection");
    assert.match(active, /\x1b\[48;/, "active task has a steady surface");
    const pausedPanel = new TaskPanel({ terminal: { rows: 60 }, requestRender() {} }, th, () => b, () => undefined, () => {}, { showDone: true }, () => false);
    assert.match(pausedPanel.render(150).map(plain).join("\n"), /Paused/);
    assert.doesNotMatch(pausedPanel.render(150).map(plain).join("\n"), /Working/);
    assert.ok(work.some(line => line.includes(th.style("Typography fixture", { fg: th.colors.text, bold: true }))));
    for (let i = 0; i < 3; i++) panel.handleInput("\x1b[B");
    panel.handleInput("\r");
    const outcome = panel.render(150).map(plain).join("\n");
    assert.match(outcome, /Outcome · agent report/); assert.match(outcome, /Synthetic outcome only/);
    assert.match(outcome, /Evidence/); assert.match(outcome, /local fixture/);
    panel.handleInput("\x1b");
    for (const width of [1, 2, 8, 12, 30, 80, 150]) {
      const rendered = panel.render(width); assert.ok(rendered.every(line => visibleWidth(line) <= width));
    }
  }
  assert.deepEqual(b, before, "panel appearance must not change canonical state");
});

test("layoutDock keeps each row's kind so hosts can style finished tasks and questions", () => {
  const snapshot = { version: 1, sessionId: "s", id: "pi-tasks", title: "Plan", hint: "", rows: [
    { text: "? Which name? · /questions q1", tone: "warning", kind: "question" },
    { text: "✓ Pick a name", tone: "muted", kind: "task" },
    { text: "◉ Write it down", tone: "accent", kind: "task" },
  ] };
  assert.deepEqual(layoutDock(snapshot, 60, 7).map(line => line.kind), ["question", "task", "task"]);
});
