import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { jiti, source, root, theme } from "./host.mjs";
const { NativeHost } = await jiti.import(join(source, "native/host.ts"));
const { inspectNativeCapabilities } = await jiti.import(join(source, "native/capabilities.ts"));
const { TuiAltScreen } = await import(pathToFileURL(join(root, "@earendil-works/pi-tui/dist/index.js")));
const { createInteractiveTuiReference } = await import(pathToFileURL(join(root, "@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js")));

function renderer() {
  const terminal = { columns: 90, rows: 24, write() {}, hideCursor() {}, showCursor() {}, start() {}, stop() {}, clearScreen() {}, moveBy() {}, clearLine() {}, clearFromCursor() {}, setTitle() {}, setProgress() {} };
  return new TuiAltScreen(terminal, false);
}

function options(beforePaint = () => {}, enabled = () => true) {
  return { beforePaint, enabled, theme: () => theme };
}

function byCapability(reports) {
  return Object.fromEntries(reports.map(report => [report.capability, report]));
}

test("native capability inspection classifies full, limited, unavailable and throwing host shapes", () => {
  for (const reference of [undefined, null, {}, 42]) {
    const reports = byCapability(inspectNativeCapabilities(reference));
    assert.equal(reports["selection-cleaning"].status, "native");
    assert.equal(reports["paint-synchronization"].status, "native");
    assert.equal(reports["copy-flash-decoration"].status, "native");
    assert.match(reports["paint-synchronization"].reason, /renderer unavailable/i);
  }
  const limited = byCapability(inspectNativeCapabilities({ render() { return []; } }));
  assert.equal(limited["paint-synchronization"].status, "limited");
  assert.match(limited["paint-synchronization"].reason, /synchronized paint/i);
  assert.equal(limited["selection-cleaning"].status, "native");
  assert.equal(limited["copy-flash-decoration"].status, "native");

  const full = byCapability(inspectNativeCapabilities({
    getActiveSelectionText() {}, getSelectionBounds() {}, getSelectionColumns() {},
    render() { return []; }, doRender() {}, flashes: { render() { return []; } },
  }));
  assert.equal(full["selection-cleaning"].status, "full");
  assert.equal(full["paint-synchronization"].status, "full");
  assert.equal(full["copy-flash-decoration"].status, "full");

  const throwing = {
    get render() { throw new Error("private renderer changed"); },
    get flashes() { throw new Error("private flash owner changed"); },
  };
  assert.doesNotThrow(() => inspectNativeCapabilities(throwing));
  const fallback = byCapability(inspectNativeCapabilities(throwing));
  assert.equal(fallback["paint-synchronization"].status, "native");
  assert.equal(fallback["copy-flash-decoration"].status, "native");
});

test("NativeHost mounts forwarding references without stacked wrappers and restores native methods", () => {
  let tui = renderer();
  const reference = createInteractiveTuiReference(() => tui);
  const host = new NativeHost();
  let prepares = 0;
  const mountOptions = options(() => prepares++);
  try {
    assert.equal(host.active, false);
    assert.ok(host.report().every(report => report.status === "native"));
    for (let cycle = 0; cycle < 5; cycle++) {
      const original = {
        render: tui.render, paint: tui.doRender, selection: tui.getActiveSelectionText, flash: tui.flashes.render,
      };
      host.mount(reference, mountOptions);
      assert.equal(host.active, true);
      assert.notEqual(tui.render, original.render);
      assert.notEqual(tui.doRender, original.paint);
      assert.notEqual(tui.getActiveSelectionText, original.selection);
      assert.notEqual(tui.flashes.render, original.flash);
      const reports = byCapability(host.report());
      assert.equal(reports["selection-cleaning"].status, "full");
      assert.equal(reports["paint-synchronization"].status, "full");
      assert.equal(reports["copy-flash-decoration"].status, "full");
      assert.equal(reports["editor-decoration"].status, "native");

      const retainedRender = tui.render;
      const before = prepares;
      reference.render(90);
      assert.equal(prepares, before + 1, "one prepare per render, not one per prior mount");
      host.mount(reference, mountOptions);
      assert.equal(prepares, before + 1, "remount itself does not prepare or stack");
      retainedRender(90);
      assert.equal(prepares, before + 1, "retained prior wrapper is inert");
      reference.render(90);
      assert.equal(prepares, before + 2, "only the current wrapper prepares");

      const current = { render: tui.render, paint: tui.doRender, selection: tui.getActiveSelectionText, flash: tui.flashes.render };
      host.dispose();
      assert.equal(host.active, false);
      assert.equal(tui.render, original.render);
      assert.equal(tui.doRender, original.paint);
      assert.equal(tui.getActiveSelectionText, original.selection);
      assert.equal(tui.flashes.render, original.flash);
      current.render(90);
      assert.equal(prepares, before + 2, "retained current wrapper is inert after disposal");
      assert.ok(host.report().every(report => report.status === "native"));
      if (cycle === 2) { tui.stop(); tui = renderer(); }
    }
  } finally { host.dispose(); tui.stop(); }
});

test("NativeHost owns dynamic adapters independently, replaces one slot and returns immutable reports", () => {
  const host = new NativeHost(), calls = [];
  try {
    host.mount(renderer(), options());
    host.own("editor-decoration", () => calls.push("editor-old"));
    host.own("message-decoration", () => calls.push("message"));
    host.own("tool-decoration", () => calls.push("tool"));
    host.own("editor-decoration", () => calls.push("editor-new"));
    assert.deepEqual(calls, ["editor-old"]);
    assert.equal(byCapability(host.report())["editor-decoration"].status, "full");
    const snapshot = host.report();
    snapshot[0].status = "native";
    snapshot[0].reason = "mutated by caller";
    assert.equal(host.report()[0].status, "full", "callers cannot mutate the capability report");
    assert.equal(host.report()[0].reason, undefined);

    host.mount(undefined, options());
    assert.equal(host.active, false);
    assert.equal(byCapability(host.report())["editor-decoration"].status, "full", "host remount does not discard dynamic surface adapters");
    assert.equal(byCapability(host.report())["selection-cleaning"].status, "native");
    host.release("message-decoration");
    assert.deepEqual(calls, ["editor-old", "message"]);
    host.release("message-decoration");
    assert.deepEqual(calls, ["editor-old", "message"], "release is idempotent");
    host.dispose(); host.dispose();
    assert.deepEqual(calls, ["editor-old", "message", "editor-new", "tool"], "dynamic teardown is reverse registration order and idempotent");
  } finally { host.dispose(); }
});

test("NativeHost contains non-writable adapter failures and preserves later owners", () => {
  const host = new NativeHost();
  const nativeSelection = () => "native";
  const partial = {
    getActiveSelectionText: nativeSelection,
    getSelectionBounds() {}, getSelectionColumns() {},
    render() { return []; }, doRender() {}, flashes: { render() { return []; } },
    terminal: { write() {}, hideCursor() {}, showCursor() {} },
  };
  Object.defineProperty(partial, "getActiveSelectionText", { value: nativeSelection, writable: false, configurable: false });
  const originalRender = partial.render, originalFlash = partial.flashes.render;
  try {
    assert.doesNotThrow(() => host.mount(partial, options()));
    const reports = byCapability(host.report());
    assert.equal(reports["selection-cleaning"].status, "native");
    assert.match(reports["selection-cleaning"].reason, /could not be installed/i);
    assert.equal(reports["paint-synchronization"].status, "full", "one failed adapter does not block later capabilities");
    assert.equal(reports["copy-flash-decoration"].status, "full");
    host.dispose();
    assert.equal(partial.render, originalRender);
    assert.equal(partial.flashes.render, originalFlash);
    assert.equal(partial.getActiveSelectionText, nativeSelection);
  } finally { host.dispose(); }

  const tui = renderer(), later = new NativeHost();
  try {
    later.mount(tui, options());
    const laterRender = () => ["later renderer"];
    const laterSelection = () => "later selection";
    const laterFlash = () => ["later flash"];
    tui.render = laterRender; tui.getActiveSelectionText = laterSelection; tui.flashes.render = laterFlash;
    later.dispose();
    assert.equal(tui.render, laterRender);
    assert.equal(tui.getActiveSelectionText, laterSelection);
    assert.equal(tui.flashes.render, laterFlash);
  } finally { later.dispose(); tui.stop(); }
});
