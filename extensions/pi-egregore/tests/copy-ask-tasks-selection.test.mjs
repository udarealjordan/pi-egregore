import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { jiti, source, root, theme, plain, kb, visibleWidth } from "./host.mjs";
const { installSemanticSelection } = await jiti.import(join(source, "native/selection.ts"));
const { Container, Input, Text, TuiAltScreen, VStack } = await import(pathToFileURL(join(root, "@earendil-works/pi-tui/dist/index.js")));
const { createInteractiveTuiReference } = await import(pathToFileURL(join(root, "@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js")));
const ask = join(source, "../../packages/pi-ask/extensions/ask-user-question");
const { TabbedQuestions } = await jiti.import(join(ask, "batch-ui.ts"));
const { frameQuestion, questionViewport } = await jiti.import(join(ask, "question-surface.ts"));
const { askAppearanceDefaults } = await jiti.import(join(ask, "appearance.ts"));
const { postedQuestionUI, questionEventCard } = await jiti.import(join(ask, "posted-ui.ts"));
const { emptyPostedBook, postQuestion } = await jiti.import(join(ask, "posted-state.ts"));
const { TaskPanel } = await jiti.import(join(source, "../pi-tasks/panel.ts"));
const { emptyBook, mutateBook } = await jiti.import(join(source, "../pi-tasks/book.ts"));
const { createDock } = await jiti.import(join(source, "dock.ts"));
const { DEFAULTS, RunClock } = await jiti.import(join(source, "state.ts"));

const draft = "alpha | beta │ 界面 🧭\n  indented\n\n╭──literal──╮";
const questionDraft = {
  answer: null, textBuffer: draft, otherText: "", selected: [], note: "note | value", skipped: false, committed: false,
};

function fixture({ columns = 100, rows = 40 } = {}) {
  const copied = [];
  let send = (_data) => {};
  const terminal = {
    columns, rows, kittyProtocolActive: false,
    start(callback) { send = callback; }, stop() {}, async drainInput() {}, write() {},
    moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
  };
  const tui = new TuiAltScreen(terminal, false, undefined, { copySelection: text => { copied.push(text); return true; } });
  const native = new Input(); native.setValue("Native draft | unchanged");
  tui.setLayoutRoot(native); tui.setFocus(native);
  const original = tui.getActiveSelectionText;
  const cleanup = installSemanticSelection(createInteractiveTuiReference(() => tui));
  tui.start();
  return {
    tui, terminal, native, copied, original, cleanup,
    paint() { tui.renderNow(true); },
    select(startRow, startCol, endRow, endCol, reverse = false) {
      const a = { row: startRow, col: startCol }, b = { row: endRow, col: endCol, boundary: true };
      tui.selectionAnchor = reverse ? b : a; tui.selectionFocus = reverse ? a : b;
      return tui.getActiveSelectionText();
    },
    selectLayout(reverse = false) {
      const box = tui.currentLayout.root;
      const last = box.children.at(-1) ?? box;
      const bottom = last.rect.y + (last.lines?.length ?? last.rect.height) - 1;
      return this.select(box.rect.y, box.rect.x, bottom, box.rect.x + box.rect.width, reverse);
    },
    rowOf(text, from = 0) {
      const row = tui.previousScreen.findIndex((line, index) => index >= from && plain(line).includes(text));
      assert.notEqual(row, -1, `missing rendered row ${text}`);
      return row;
    },
    colOf(row, text) {
      const line = plain(tui.previousScreen[row]), index = line.indexOf(text);
      assert.notEqual(index, -1, `missing rendered text ${text}`);
      return visibleWidth(line.slice(0, index));
    },
    fallback() {
      const expected = original.call(tui);
      assert.equal(tui.getActiveSelectionText(), expected, "unsupported/stale layout retains native extraction");
    },
    send,
    stop() { cleanup(); tui.stop(); },
  };
}

async function withEmptyAgentDir(run) {
  const directory = mkdtempSync(join(tmpdir(), "pi-copy-surfaces-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try { return await run(); }
  finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
}

function overlayLayout(tui, component) {
  const layout = tui.renderedOverlayLayouts.find(item => item.entry.component === component);
  assert.ok(layout, "visible overlay has a rendered layout");
  return layout;
}

test("real framed Ask copies prompt, draft blanks, literals and note while mixed native rows stay intact", async () => {
  await withEmptyAgentDir(async () => {
    const f = fixture();
    const form = new TabbedQuestions([
      { question: "Question | 界面?", details: "Context | line", mode: "text", options: [] },
    ], questionViewport(f.tui), theme, kb, () => {}, process.cwd(), questionDraft, false);
    const shell = frameQuestion(form, theme, f.tui, { appearance: askAppearanceDefaults() });
    shell.focused = true;
    const root = new VStack([{ component: new Text("native | before", 0, 0) }, { component: shell }, { component: new Text("native | after", 0, 0) }]);
    f.tui.setLayoutRoot(root); f.tui.setFocus(shell);
    try {
      f.paint();
      const before = form.captureDraft();
      const selected = f.selectLayout();
      assert.ok(selected.includes(draft), selected);
      assert.ok(selected.includes("note | value"), selected);
      assert.ok(selected.includes("native | before") && selected.includes("native | after"), selected);
      assert.ok(!selected.includes("Enter Submit"), "action hints are decoration");
      assert.ok(!selected.split("\n").some(line => /^[┏┡┗┕]/.test(line)), "outer rails are decoration");
      const rootBox = f.tui.currentLayout.root;
      const all = (reverse = false) => f.selectLayout(reverse);
      assert.equal(all(true), selected, "reverse multi-row selection agrees");
      const row = f.rowOf("alpha");
      assert.equal(f.select(row, f.colOf(row, "alpha"), row, f.colOf(row, "alpha") + 5), "alpha");
      const rail = f.rowOf("Questions");
      assert.equal(f.select(rail, 0, rail, f.terminal.columns), undefined, "rail-only selection has no semantic text");
      all();
      await f.tui.copyActiveSelectionToClipboard();
      assert.equal(f.copied.at(-1), selected, "Ask uses the native clipboard success path");
      assert.deepEqual(form.captureDraft(), before, "copy never edits the draft");

      f.terminal.columns = 64; f.terminal.rows = 32; f.paint();
      assert.ok(f.selectLayout().includes(draft), "resize records current render provenance");
      f.selectLayout();
      shell.render(40);
      f.fallback();
      f.paint();
      f.terminal.columns = 8; f.terminal.rows = 24; f.paint();
      f.selectLayout();
      f.fallback();
    } finally { shell.dispose(); f.stop(); }
  });
});

test("real posted Ask overlay honors column offsets, row-local drift, resize and native fallback", async () => {
  await withEmptyAgentDir(async () => {
    const f = fixture();
    const q = postQuestion(emptyPostedBook(), {
      question: "Posted | 界面?", details: "Posted context | line", why: "Needed | reason", boundary: "Only | this waits", urgency: "blocking",
    }).questions[0];
    q.draft = structuredClone(questionDraft);
    let shell, handle;
    const ctx = { cwd: process.cwd(), ui: { custom(make, options) {
      return new Promise(resolve => {
        let overlay;
        shell = make(f.tui, theme, kb, value => { overlay.hide(); resolve(value); });
        overlay = f.tui.showOverlay(shell, options.overlayOptions); handle = overlay;
      });
    } } };
    const pending = postedQuestionUI(ctx, q, () => true, () => {});
    try {
      f.paint();
      let layout = overlayLayout(f.tui, shell);
      assert.ok(layout.col > 0, "posted overlay is horizontally inset");
      const selectOverlay = (reverse = false) => {
        layout = overlayLayout(f.tui, shell);
        return f.select(layout.row, layout.col, layout.row + layout.height - 1, layout.col + layout.width, reverse);
      };
      const selected = selectOverlay();
      assert.ok(selected.includes(q.definition.question), selected);
      assert.ok(selected.includes(draft), selected);
      assert.ok(!selected.includes("Enter Submit"), "overlay action hints are decoration");
      assert.equal(selectOverlay(true), selected);
      const row = f.rowOf("alpha");
      assert.equal(f.select(row, f.colOf(row, "alpha"), row, f.colOf(row, "alpha") + 5), "alpha");
      assert.equal(f.native.getValue(), "Native draft | unchanged");

      f.terminal.columns = 80; f.terminal.rows = 30; f.paint();
      const resized = selectOverlay();
      assert.ok(resized.includes(draft), resized);
      layout = overlayLayout(f.tui, shell);
      const driftRow = layout.row + 2, saved = f.tui.previousScreen[driftRow];
      f.tui.previousScreen[driftRow] = "unowned overlay | │".padEnd(f.terminal.columns, " ");
      const drifted = selectOverlay();
      assert.ok(drifted.includes("unowned overlay | │"), "drifted row falls back on its own");
      assert.ok(drifted.includes(draft), "other overlay rows remain clean");
      f.tui.previousScreen[driftRow] = saved;

      const hidden = { ...layout };
      handle.hide(); f.paint();
      // The old bounds still identify the selected screen area after hiding.
      f.select(hidden.row, hidden.col, hidden.row + hidden.height - 1, hidden.col + hidden.width);
      f.fallback();
      shell.handleInput("\x1b"); shell.handleInput("\x1b");
      const outcome = await pending;
      assert.equal(outcome.result, null);
      assert.equal(outcome.draft.textBuffer, draft);
      assert.equal(f.native.getValue(), "Native draft | unchanged");
    } finally { handle?.hide(); shell?.dispose(); f.stop(); }
  });
});

test("real Ask question event card copies only its framed body", () => {
  const f = fixture();
  const q = postQuestion(emptyPostedBook(), {
    question: "Event | 界面?", why: "Reason", boundary: "Boundary", urgency: "deferred",
    options: [{ label: "Choice | one", value: "one" }],
  }).questions[0];
  q.state = "delivered";
  q.response = { status: "answered", answers: [{ questionIndex: 0, answer: { type: "option", label: "Choice | one", value: "one", index: 1 } }] };
  const card = questionEventCard({ label: "Question event", question: q }, theme, true);
  const root = new VStack([{ component: card }, { component: new Text("native | after", 0, 0) }]);
  f.tui.setLayoutRoot(root);
  try {
    f.paint();
    const box = f.tui.currentLayout.root.children[0];
    const selected = f.select(box.rect.y, 0, box.rect.y + box.lines.length - 1, f.terminal.columns);
    assert.ok(selected.includes(q.definition.question), selected);
    assert.ok(selected.includes("Choice | one"), selected);
    assert.ok(!selected.split("\n").some(line => /^[╭╰]/.test(line)), "event rails are decoration");
    assert.ok(!selected.includes("Question event"), "event label is decoration");
  } finally { f.stop(); }
});

test("real Tasks panel overlay copies work rows but not rails or action bar", () => {
  const f = fixture();
  let book = mutateBook(emptyBook(), undefined, {
    op: "create", title: "Plan | 界面", items: [{ title: "alpha | beta │ 界面 🧭" }, { title: "╭──literal──╮" }],
  }, "agent", 1000);
  book = mutateBook(book, book.revision, {
    op: "task", planId: "p1", mutation: { op: "update", id: "t1", changes: { status: "active" } },
  }, "agent", 2000);
  const panel = new TaskPanel(f.tui, theme, () => book, () => undefined, () => {}, { showDone: true });
  const handle = f.tui.showOverlay(panel, { width: "85%", maxHeight: "85%", anchor: "center" });
  try {
    f.paint();
    const selectPanel = (reverse = false) => {
      const layout = overlayLayout(f.tui, panel);
      return f.select(layout.row, layout.col, layout.row + layout.height - 1, layout.col + layout.width, reverse);
    };
    const selected = selectPanel();
    assert.ok(selected.includes("Plan | 界面"), selected);
    assert.ok(selected.includes("alpha | beta │ 界面 🧭"), selected);
    assert.ok(selected.includes("╭──literal──╮"), selected);
    assert.ok(!selected.includes("Enter details"), "panel action bar is decoration");
    assert.ok(!selected.split("\n").some(line => /^[┏┡┗┕]/.test(line)), "panel rails are decoration");
    assert.equal(selectPanel(true), selected);
    const row = f.rowOf("alpha");
    assert.equal(f.select(row, f.colOf(row, "alpha"), row, f.colOf(row, "alpha") + 5), "alpha");
    assert.equal(f.native.getValue(), "Native draft | unchanged");

    f.terminal.columns = 80; f.terminal.rows = 30; f.paint();
    assert.ok(selectPanel().includes("alpha | beta │ 界面 🧭"));
    selectPanel(); panel.render(30); f.fallback(); f.paint();
    f.terminal.columns = 6; f.terminal.rows = 24; f.paint(); selectPanel(); f.fallback();
  } finally { handle.hide(); f.stop(); }
});

test("real composite Tasks dock cleans frames and padding while preserving provider metadata and native input", () => {
  const f = fixture({ columns: 90, rows: 40 });
  const tasks = {
    version: 1, sessionId: "s", id: "pi-tasks", title: "Plan | 界面",
    rows: [
      { text: "◉ alpha | beta │ 界面 🧭", tone: "accent", kind: "task" },
      { text: "○ ╭──literal──╯", tone: "text", kind: "task" },
    ],
    overview: { revision: "r1", planId: "p1", total: 2, done: 0, blocked: 0, cancelled: 0, activeId: "t1", activeTitle: "alpha | beta │ 界面 🧭" },
  };
  const other = { version: 1, sessionId: "s", id: "other", title: "Other | provider", summary: "2 notes", rows: [{ text: "note | body" }] };
  const docks = new Map([["pi-tasks", tasks], ["other", other]]);
  const state = {
    prefs: { ...DEFAULTS, motion: "off" }, clock: new RunClock(), tools: new Map(), phase: "working", promptDepth: 0,
    compacting: false, lastInputAt: 0, activityRows: () => ["activity | meta"], statusRows: () => ["status | meta"],
  };
  const dock = createDock(f.tui, () => ({ ui: { theme } }), state, docks, () => true, () => 1000);
  f.tui.setLayoutRoot(new VStack([{ component: dock }, { component: f.native }])); f.tui.setFocus(f.native);
  try {
    f.paint();
    const selectDock = () => {
      const box = f.tui.currentLayout.root.children[0];
      return f.select(box.rect.y, 0, box.rect.y + box.lines.length - 1, f.terminal.columns);
    };
    const selected = selectDock();
    assert.ok(selected.includes("alpha | beta │ 界面 🧭"), selected);
    assert.ok(selected.includes("╭──literal──╯"), selected);
    assert.ok(selected.includes("Other | provider") && selected.includes("note | body"), selected);
    assert.ok(selected.includes("activity | meta") && selected.includes("status | meta"), selected);
    assert.ok(!selected.split("\n").some(line => /^[┏┡┗┕]/.test(line)), "task rails are decoration");
    assert.ok(!selected.split("\n").includes(""), "composer padding is omitted");
    const root = f.tui.currentLayout.root;
    const all = (reverse = false) => f.select(root.rect.y, 0, root.rect.y + root.rect.height - 1, f.terminal.columns, reverse);
    assert.ok(all().includes("Native draft | unchanged"), "native input row remains intact");
    assert.equal(all(true), all());
    const row = f.rowOf("alpha");
    assert.equal(f.select(row, f.colOf(row, "alpha"), row, f.colOf(row, "alpha") + 5), "alpha");

    f.terminal.columns = 40; f.terminal.rows = 32; f.paint();
    assert.ok(selectDock().includes("alpha | beta │ 界面 🧭"));
    f.terminal.columns = 12; f.terminal.rows = 24;
    tasks.rows = [{ text: "One | 界", tone: "accent", kind: "task" }, { text: "Two │", tone: "text", kind: "task" }];
    docks.delete("other"); state.activityRows = () => []; state.statusRows = () => [];
    f.paint();
    const narrow = selectDock();
    assert.ok(narrow.includes("One | 界") && narrow.includes("Two │"), narrow);
    f.terminal.columns = 90; f.terminal.rows = 40; f.paint(); selectDock(); dock.render(30); f.fallback();
    assert.equal(f.native.getValue(), "Native draft | unchanged");
  } finally { f.stop(); }
});
