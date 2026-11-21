import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { jiti, source } from "./host.mjs";
const { pathMap } = await jiti.import(join(source, "paths.ts"));

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
