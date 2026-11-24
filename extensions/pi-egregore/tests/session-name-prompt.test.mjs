import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jiti, source, theme, kb, plain } from "./host.mjs";

const { default: sessionNamePrompt, shouldPromptForSessionName } = await jiti.import(join(source, "session-name-prompt.ts"));

function fixture(overrides = {}) {
  const handlers = new Map(), notifications = [], named = [];
  let currentName = overrides.name;
  const sessionManager = {
    getSessionFile: () => overrides.file,
    getHeader: () => overrides.header,
    getEntries: () => overrides.entries ?? [],
  };
  const ctx = {
    mode: overrides.mode ?? "tui",
    sessionManager,
    ui: {
      theme,
      notify: (message, type) => notifications.push([message, type]),
      custom: overrides.custom ?? (async () => undefined),
    },
  };
  const pi = {
    on: (name, handler) => handlers.set(name, handler),
    getSessionName: () => currentName,
    setSessionName: value => { currentName = value; named.push(value); },
  };
  sessionNamePrompt(pi);
  return {
    pi, ctx, notifications, named,
    eligible(reason = "startup") {
      return shouldPromptForSessionName(pi, { type: "session_start", reason }, ctx);
    },
    emit(reason = "startup") {
      return handlers.get("session_start")({ type: "session_start", reason }, ctx);
    },
  };
}

test("a fresh startup uses Egregore's framed text prompt, trims the answer, and names the session", async t => {
  const scratch = mkdtempSync(join(tmpdir(), "pi-session-name-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  let view, customOptions;
  const h = fixture({
    file: join(scratch, "not-persisted-yet.jsonl"),
    entries: [{ type: "model_change" }, { type: "thinking_level_change" }],
    custom: async (factory, options) => {
      customOptions = options;
      const component = factory({ terminal: { rows: 40 }, requestRender() {} }, theme, kb, () => {});
      component.focused = true;
      view = component.render(64).map(plain);
      return "  Fix login bug  ";
    },
  });

  assert.equal(h.eligible(), true);
  await h.emit();
  assert.match(view[0], /^╭ Name this session ─+╮$/);
  assert.match(view.join("\n"), /e\.g\. Fix login bug/);
  assert.match(view.at(-1), /^╰ ↵ save · esc cancel ─+╯$/);
  assert.equal(customOptions.overlay, undefined, "the prompt takes the composer's input placement");
  assert.deepEqual(h.named, ["Fix login bug"]);
  assert.deepEqual(h.notifications, [["Session named: Fix login bug", "info"]]);
});

test("cancelled and whitespace-only answers leave the session unnamed", async () => {
  for (const answer of [undefined, "   "]) {
    const h = fixture({ custom: async () => answer });
    await h.emit();
    assert.deepEqual(h.named, []);
    assert.deepEqual(h.notifications, []);
  }
});

test("only a truly fresh unnamed TUI startup is eligible", async t => {
  const scratch = mkdtempSync(join(tmpdir(), "pi-session-name-existing-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const existing = join(scratch, "existing.jsonl");
  writeFileSync(existing, "{}\n");

  const cases = [
    ["non-TUI", { mode: "rpc" }, "startup"],
    ["reload", {}, "reload"],
    ["new-session event", {}, "new"],
    ["resume event", {}, "resume"],
    ["fork event", {}, "fork"],
    ["already named", { name: "Existing name" }, "startup"],
    ["persisted startup session", { file: existing }, "startup"],
    ["forked header", { header: { parentSession: existing } }, "startup"],
    ["meaningful entry", { entries: [{ type: "custom" }] }, "startup"],
  ];

  for (const [label, options, reason] of cases) {
    let prompted = false;
    const h = fixture({ ...options, custom: async () => { prompted = true; return "Unexpected"; } });
    assert.equal(h.eligible(reason), false, label);
    await h.emit(reason);
    assert.equal(prompted, false, label);
    assert.deepEqual(h.named, [], label);
  }
});
