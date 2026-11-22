import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { jiti, source, theme, plain } from "./host.mjs";
const { pathMap, PathsPanel, dayLabel, shortenPaths, pathsColor } = await jiti.import(join(source, "paths.ts"));

const at = minute => `2026-11-21T10:${String(minute).padStart(2, "0")}:00Z`;
const node = (id, entry, children = [], label) => ({ entry: { id, ...entry }, children, ...(label ? { label } : {}) });
const user = (id, text, minute, children, label) => node(id, { type: "message", timestamp: at(minute), message: { role: "user", content: text } }, children, label);
const reply = (id, text, minute, children) => node(id, { type: "message", timestamp: at(minute), message: { role: "assistant", content: [{ type: "text", text }] } }, children);
const custom = (id, minute, children) => node(id, { type: "custom", customType: "pi-footer:timing-v1", timestamp: at(minute) }, children);

// u1 → a1 → custom c1 → u2 → a2 (active)   and a rewind from a1: u2b → a2b   and from c1: u2c
const tree = [user("u1", "Plan the trip", 1, [reply("a1", "Here is a plan.", 2, [
  custom("c1", 3, [user("u2", "Make it cheaper", 10, [reply("a2", "Cheaper plan.", 11)]), user("u2c", "Add a museum", 6)]),
  user("u2b", "Make it longer", 5, [reply("a2b", "Longer plan.", 6)]),
])], "start")];

test("your turns form a spine with the paths you rewound from, even when the fork sits above your message", () => {
  const map = pathMap(tree, "a2");
  assert.deepEqual(map.turns.map(f => f.turn.text), ["Plan the trip", "Make it cheaper"]);
  assert.equal(map.turns[0].turn.label, "start");
  assert.equal(map.turns[0].turn.reply, "Here is a plan.");
  assert.deepEqual(map.turns[1].alternatives.map(a => [a.text, a.leaf]), [["Add a museum", "u2c"], ["Make it longer", "a2b"]], "newest alternative first, each with its own leaf");
  assert.deepEqual(map.path, { index: 3, total: 3 }, "the current path is the newest of three");
  assert.equal(map.turns[1].turn.parentId, "c1");
});

test("an earlier path counts from the start, and a single path has no marker", () => {
  // From the older path, the other branch at the fork is one alternative; its own forks show once you're on it.
  assert.deepEqual(pathMap(tree, "a2b").path, { index: 1, total: 2 });
  assert.equal(pathMap(tree, "a2b").turns[1].alternatives[0].text, "Make it cheaper");
  assert.equal(pathMap([user("x", "Hello", 1, [reply("y", "Hi", 2)])], "y").path, undefined);
  assert.deepEqual(pathMap([], null), { turns: [], leafId: null, path: undefined });
});

test("long file paths keep their last part; days read as Today, Yesterday or a date", () => {
  assert.equal(shortenPaths("From /Users/me/Reading/The Book.pdf read this"), "From …/The Book.pdf read this");
  assert.equal(shortenPaths("see ~/code/pi/paths.ts now"), "see …/paths.ts now");
  assert.equal(shortenPaths("a/b is not a path"), "a/b is not a path");
  const now = Date.parse("2026-11-21T15:00:00");
  assert.equal(dayLabel(Date.parse("2026-11-21T08:00:00"), now), "Today");
  assert.equal(dayLabel(Date.parse("2026-11-20T23:00:00"), now), "Yesterday");
  assert.doesNotMatch(dayLabel(Date.parse("2026-11-18T10:00:00"), now), /Today|Yesterday/);
});

test("the panel is gold, lists messages without a repeated 'you', marks days, highlights the selection and renders the reply", () => {
  const day = (d, h) => `2026-11-${d}T${h}:00:00`;
  const t = [user("u1", "First question", 0, [reply("a1", "A **bold** answer.", 1, [
    node("u2", { type: "message", timestamp: day(20, 9), message: { role: "user", content: "From /Users/me/Reading/Notes.md what now?" } }, [
      node("a2", { type: "message", timestamp: day(20, 9), message: { role: "assistant", content: [{ type: "text", text: "Use **this**." }] } })])])])];
  t[0].entry.timestamp = day(19, 8); t[0].children[0].entry.timestamp = day(19, 8);
  const map = pathMap(t, "a2");
  const panel = new PathsPanel({ terminal: { rows: 40 }, requestRender() {} }, theme, map, () => {});
  const raw = panel.render(80), view = raw.map(plain).join("\n");
  assert.doesNotMatch(view, /\byou\b/, "every row is yours; no column says so");
  const dayLines = view.split("\n").filter(line => /^│ \S/.test(line) && !/\d\d:\d\d/.test(line) && !/─{5}/.test(line));
  assert.equal(dayLines.length, 3, "a line for each of the two days, plus the preview's first line");
  assert.match(view, /…\/Notes\.md what now\?/);
  assert.doesNotMatch(view, /\*\*/, "the reply preview is rendered, not raw markdown");
  const goldInk = theme.style("X", { fg: pathsColor(theme) }).split("X")[0];
  assert.ok(goldInk && raw[0].includes(goldInk), "the frame is gold");
  const selected = raw.find(line => plain(line).includes("what now?") && plain(line).includes("›"));
  assert.ok(selected && /\x1b\[48;/.test(selected), "the selected row has a background, so it is the most visible row");
});
