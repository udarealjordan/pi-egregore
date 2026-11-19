import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { jiti, source, root, theme, plain, kb } from "./host.mjs";
const { installFrameAwareCopy, rememberCopyFrame, forgetCopyFrame } = await jiti.import(join(source, "copy-selection.ts"));
const { SentMessageFrames } = await jiti.import(join(source, "sent-messages.ts"));
const { ActivityBlocks } = await jiti.import(join(source, "activity-blocks.ts"));
const { frameRows } = await jiti.import(join(source, "../../lib/frame.ts"));
const { Container, ScrollView, Text, VStack, TuiAltScreen, TuiMainScreen } = await import(pathToFileURL(join(root, "@earendil-works/pi-tui/dist/index.js")));
const { UserMessageComponent, ToolExecutionComponent, createEditToolDefinition } = await import(pathToFileURL(join(root, "@earendil-works/pi-coding-agent/dist/index.js")));
const { createInteractiveTuiReference } = await import(pathToFileURL(join(root, "@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js")));
const { dressComposerEditor } = await jiti.import(join(source, "composer-editor.ts"));
const { ComposerEditor } = await jiti.import(join(source, "ui.ts"));
const { ModalEditor } = await jiti.import(join(source, "../../node_modules/pi-vim/index.ts"));
const { DEFAULTS, RunClock } = await jiti.import(join(source, "state.ts"));
const { CustomEditor } = await import(pathToFileURL(join(root, "@earendil-works/pi-coding-agent/dist/index.js")));
const { getEditorTheme } = await import(pathToFileURL(join(root, "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")));
function fixture() {
  const copied = [];
  const terminal = { columns: 60, rows: 12, write() {}, hideCursor() {}, showCursor() {}, start() {}, stop() {}, clearScreen() {}, moveBy() {}, clearLine() {}, clearFromCursor() {}, setTitle() {}, setProgress() {} };
  const tui = new TuiAltScreen(terminal, false, undefined, { copySelection: text => { copied.push(text); return true; } });
  const chat = new Container(), document = new Container(); document.addChild(chat);
  const scroll = new ScrollView(document, { primary: true, scrollbar: "hidden", follow: "end" });
  tui.setLayoutRoot(scroll);
  const original = tui.getActiveSelectionText;
  const cleanup = installFrameAwareCopy(createInteractiveTuiReference(() => tui));
  tui.start();
  return { tui, chat, copied, scroll, original, cleanup,
    paint() { tui.renderNow(true); },
    select(startRow, startCol, endRow, endCol, reverse = false) {
      const a = { row: startRow, col: startCol, scrollView: scroll }, b = { row: endRow, col: endCol, scrollView: scroll, boundary: true };
      tui.selectionAnchor = reverse ? b : a; tui.selectionFocus = reverse ? a : b;
      return tui.getActiveSelectionText();
    },
    stop() { cleanup(); tui.stop(); },
  };
}
test("real native chat selection omits owned rails/padding, retains pipes, Unicode and indentation, and uses native clipboard success path", async () => {
  const f = fixture(), messages = new SentMessageFrames();
  try {
    const message = new UserMessageComponent("alpha | beta │ 界面 🧭\n  indented\n╭──literal──╮");
    f.chat.addChild(message); messages.sync(f.chat, () => theme);
    f.paint();
    const rows = f.tui.currentLayout.root.scrollContentLines;
    assert.match(rows.map(plain).join("\n"), /│/);
    assert.equal(f.select(0, 0, rows.length - 1, 60), " alpha | beta │ 界面 🧭\n   indented\n ╭──literal──╮");
    assert.equal(f.select(0, 0, rows.length - 1, 60, true), " alpha | beta │ 界面 🧭\n   indented\n ╭──literal──╮");
    await f.tui.copyActiveSelectionToClipboard();
    assert.deepEqual(f.copied, [" alpha | beta │ 界面 🧭\n   indented\n ╭──literal──╮"]);
    assert.equal(f.tui.flashes.entries.at(-1).message, "Copied!");
    assert.equal(f.select(2, 2, 2, 7), "alpha");
    assert.equal(f.select(2, 0, 2, 1), undefined, "border-only selection has no content");
    assert.equal(f.select(0, 0, 0, 60), undefined, "rail-only selection has no content");
    const retained = f.tui.getActiveSelectionText;
    f.cleanup(); f.cleanup();
    assert.equal(f.tui.getActiveSelectionText, f.original);
    assert.equal(retained(), f.original.call(f.tui));
  } finally { messages.dispose(); f.stop(); }
});
test("unowned lookalikes and literal pipes stay intact across components, scroll and resize", () => {
  const f = fixture();
  let content = ["first | │", "", "  code | x", "╰────────╯"];
  const owner = { render(width) { return rememberCopyFrame(this, width, frameRows({ theme, width, rows: content })); } };
  const literal = new Text("╭────────╮\n│ literal│\n╰────────╯", 0, 0);
  try {
    f.chat.addChild(owner); f.chat.addChild(literal);
    for (const width of [24, 90]) {
      f.tui.terminal.columns = width; f.paint();
      const rows = f.tui.currentLayout.root.scrollContentLines;
      assert.equal(f.select(0, 0, rows.length - 1, width), content.join("\n") + "\n╭────────╮\n│ literal│\n╰────────╯");
    }
    content = Array.from({ length: 30 }, (_, i) => `line ${i} | │`); f.paint();
    assert.ok(f.scroll.scrollTop > 0);
    assert.equal(f.select(20, 0, 24, 90), content.slice(19, 24).join("\n"));
    forgetCopyFrame(owner);
    assert.equal(f.tui.getActiveSelectionText(), f.original.call(f.tui));
  } finally { f.stop(); }
});
test("real tool frame records cached and expanded render provenance", () => {
  const f = fixture(), blocks = new ActivityBlocks(() => theme, () => {});
  try {
    const tool = new ToolExecutionComponent("edit", "e1", { path: "a.ts", oldText: "a | b", newText: "x │ y" }, { showImages: false }, createEditToolDefinition("/tmp"), f.tui, "/tmp");
    tool.updateResult({ content: [{ type: "text", text: "literal | │" }], details: {}, isError: false });
    f.chat.addChild(tool); blocks.sync(f.chat);
    for (const expanded of [false, true, true]) {
      tool.setExpanded(expanded); f.paint();
      const rows = f.tui.currentLayout.root.scrollContentLines;
      const selected = f.select(0, 0, rows.length - 1, 60);
      assert.ok(selected.includes("literal | │"));
      assert.ok(!selected.includes("╭") && !selected.includes("╰"));
      assert.ok(!selected.split("\n").some(line => line.startsWith("│")));
      assert.ok(selected.split("\n").includes("literal | │"), "literal trailing pipe remains");
    }
  } finally { blocks.dispose(); f.stop(); }
});
test("unsupported modes, stale render provenance, extraction drift and later owners fall back safely", () => {
  assert.doesNotThrow(() => installFrameAwareCopy({})());
  assert.doesNotThrow(() => installFrameAwareCopy(undefined)());
  assert.equal(typeof TuiMainScreen.prototype.getActiveSelectionText, "undefined");
  const f = fixture();
  const owner = { render(width) { return rememberCopyFrame(this, width, frameRows({ theme, width, rows: ["a | b"] })); } };
  try {
    f.chat.addChild(owner); f.paint(); f.select(0, 0, 2, 60);
    rememberCopyFrame(owner, 40, ["stale"]);
    assert.equal(f.tui.getActiveSelectionText(), f.original.call(f.tui));
    const later = () => "other owner";
    f.tui.getActiveSelectionText = later; f.cleanup(); assert.equal(f.tui.getActiveSelectionText, later);
  } finally { f.stop(); }
});

for (const kind of ["native", "vim", "fallback"]) test(`fixed ${kind} Composer copies only draft text through native clipboard`, async () => {
  const f = fixture();
  f.tui.stop();
  const workspace = { prefs: { ...DEFAULTS }, clock: new RunClock(), tools: new Map(), phase: "working", promptDepth: 0, compacting: false, lastInputAt: 0 };
  const ctx = { ui: { theme }, cwd: process.cwd(), sessionManager: { getSessionName: () => "Copy test" } };
  const editor = kind === "fallback" ? new ComposerEditor(f.tui, getEditorTheme(), kb, () => ctx, workspace, () => "off")
    : new (kind === "vim" ? ModalEditor : CustomEditor)(f.tui, getEditorTheme(), kb);
  const undress = kind === "fallback" ? () => {} : dressComposerEditor(editor, () => ctx, workspace, () => 10000, () => f.tui.terminal.rows);
  const draft = "alpha | beta │ 界面 🧭\n  indented\n\n╭──literal──╮";
  editor.setText(draft);
  const dock = new Container(); dock.addChild(editor);
  f.tui.setLayoutRoot(new VStack([{ component: f.scroll, grow: 1 }, { component: dock }]));
  f.tui.setFocus(editor);
  f.tui.start();
  try {
    for (const width of [40, 90]) {
      f.tui.terminal.columns = width; f.tui.terminal.rows = 24; f.paint();
      const box = f.tui.currentLayout.root.children[1];
      const top = box.rect.y, bottom = top + box.lines.length - 1;
      const select = (a, x, b, y, reverse = false) => {
        const start = { row: a, col: x }, end = { row: b, col: y, boundary: true };
        f.tui.selectionAnchor = reverse ? end : start; f.tui.selectionFocus = reverse ? start : end;
        return f.tui.getActiveSelectionText();
      };
      assert.equal(select(top, 0, bottom, width), draft);
      assert.equal(select(top, 0, bottom, width, true), draft);
      await f.tui.copyActiveSelectionToClipboard();
      assert.equal(f.copied.at(-1), draft);
      assert.equal(select(top, 0, top, width), undefined);
      const body = f.tui.previousScreen.findIndex(line => plain(line).includes("alpha | beta"));
      assert.equal(select(body, 0, body, 1), undefined);
      assert.equal(select(body, 3, body, 8), "alpha");
      assert.equal(editor.getText(), draft);
      const cursor = editor.getCursor();
      select(top, 0, bottom, width);
      const savedRow = f.tui.previousScreen[body];
      f.tui.previousScreen[body] = "unowned overlay | │";
      assert.ok(f.tui.getActiveSelectionText().includes("unowned overlay | │"), "overlaid/stale rows stay native");
      f.tui.previousScreen[body] = savedRow;
      assert.deepEqual(editor.getCursor(), cursor, "copy never moves the native cursor");
    }
    f.tui.terminal.columns = 7; f.paint();
    assert.equal(f.tui.getActiveSelectionText(), f.original.call(f.tui), "narrow native fallback clears provenance");
    undress();
    f.paint();
    if (kind !== "fallback") assert.equal(f.tui.getActiveSelectionText(), f.original.call(f.tui));
  } finally { undress(); f.stop(); }
});
