import assert from "node:assert/strict";
import { test } from "node:test";
import { join, relative } from "node:path";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { jiti, source, theme, plain } from "./host.mjs";
const repo = join(source, "../..");
const { TextDialog, ChoiceDialog, ConfirmDialog, askText, askChoice, askConfirm } = await jiti.import(join(repo, "lib/dialogs.ts"));
const tui = { terminal: { rows: 40 }, requestRender() {} };
const KEY = { esc: "\x1b", enter: "\r", up: "\x1b[A", down: "\x1b[B" };

test("Egregore never opens Pi's built-in dialogs directly; it uses the framed ones in lib/dialogs.ts", () => {
  // Ask is a standalone package and cannot import lib/; its one confirmation is listed here on purpose.
  const allowed = new Set(["lib/dialogs.ts", "packages/pi-ask/extensions/ask-user-question/posted.ts"]);
  const offenders = [];
  const walk = dir => { for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name === "tests" || name === "test") continue;
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.ts$/.test(name) && !allowed.has(relative(repo, path))
      && /\bui\.(input|select|confirm|editor)\(/.test(readFileSync(path, "utf8"))) offenders.push(relative(repo, path));
  } };
  for (const dir of ["extensions", "lib", "packages"]) walk(join(repo, dir));
  assert.deepEqual(offenders, [], "use askText / askChoice / askConfirm from lib/dialogs.ts");
});

test("a text prompt is a rounded frame with its keys in the footer; Enter saves, Esc cancels, the value starts filled in", () => {
  let got = "unset";
  const dialog = new TextDialog(tui, theme, "Task title", "Old title", "", {}, value => { got = value; });
  dialog.focused = true;
  const view = dialog.render(60).map(plain);
  assert.match(view[0], /^╭ Task title ─+╮$/); assert.match(view.at(-1), /^╰ ↵ save · esc cancel ─+╯$/);
  assert.match(view.join("\n"), /❯ Old title/);
  dialog.handleInput("!"); dialog.handleInput(KEY.enter); assert.equal(got, "Old title!");
  const cancel = new TextDialog(tui, theme, "T", "x", "", {}, value => { got = value; });
  cancel.handleInput(KEY.esc); assert.equal(got, undefined);
});

test("a choice moves with arrows (wrapping), picks by number, and shows its keys", () => {
  let got = "unset";
  const dialog = new ChoiceDialog(tui, theme, "Task status", ["pending", "active", "done"], {}, value => { got = value; });
  assert.match(plain(dialog.render(60).at(-1)), /↑↓ move · ↵ choose · 1–9 pick · esc cancel/);
  dialog.handleInput(KEY.up); dialog.handleInput(KEY.enter); assert.equal(got, "done", "up from the first wraps to the last");
  new ChoiceDialog(tui, theme, "T", ["a", "b"], {}, value => { got = value; }).handleInput("2"); assert.equal(got, "b");
  new ChoiceDialog(tui, theme, "T", ["a", "b"], {}, value => { got = value; }).handleInput(KEY.esc); assert.equal(got, undefined);
});

test("a confirmation says yes on Enter or y and no on Esc or n", () => {
  const answers = [];
  for (const key of [KEY.enter, "y", KEY.esc, "n"]) new ConfirmDialog(theme, "Archive?", "Unfinished tasks pause.", {}, v => answers.push(v)).handleInput(key);
  assert.deepEqual(answers, [true, true, false, false]);
  assert.match(plain(new ConfirmDialog(theme, "Archive?", "Unfinished tasks pause.", {}, () => {}).render(60).join("\n")), /Unfinished tasks pause\.[\s\S]*↵ or y yes · esc or n no/);
});

test("terminal prompts default to the composer and text can opt into a centered panel; elsewhere Pi asks", async () => {
  const seen = [];
  const tuiCtx = { mode: "tui", ui: { custom: async (_factory, options) => { seen.push(options); return "x"; } } };
  assert.equal(await askText(tuiCtx, "T"), "x");
  assert.equal(seen[0].overlay, undefined, "input placement: in place, not floating");
  assert.equal(await askText(tuiCtx, "T", "", { placement: "panel" }), "x");
  assert.deepEqual(seen[1], { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "80%" } });
  const rpc = { mode: "rpc", ui: { input: async () => "typed", select: async (_t, c) => c[1], confirm: async () => true } };
  assert.equal(await askText(rpc, "T"), "typed"); assert.equal(await askChoice(rpc, "T", ["a", "b"]), "b"); assert.equal(await askConfirm(rpc, "T"), true);
  assert.equal(await askChoice(tuiCtx, "T", []), undefined, "an empty list asks nothing");
});
