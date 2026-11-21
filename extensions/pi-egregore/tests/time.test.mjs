import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { jiti, source } from "./host.mjs";
const { gapLabel, GAP_MS } = await jiti.import(join(source, "sent-messages.ts"));
const { welcomeLine, AWAY_MS } = await jiti.import(join(source, "welcome.ts"));
const { settling, SETTLE_MS, RunClock, DEFAULTS } = await jiti.import(join(source, "state.ts"));

test("pauses of half an hour or more get a plain label", () => {
  assert.equal(GAP_MS, 30 * 60_000);
  assert.equal(gapLabel(45 * 60_000), "45 min later");
  assert.equal(gapLabel(2 * 3_600_000), "2 h later");
  assert.equal(gapLabel(26 * 3_600_000), "a day later");
  assert.equal(gapLabel(3 * 86_400_000), "3 days later");
});

test("resuming after two hours shows where you left off; a recent or empty session shows nothing", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const message = (role, text, at) => ({ type: "message", timestamp: new Date(at).toISOString(), message: { role, content: role === "user" ? text : [{ type: "text", text }] } });
  const branch = [message("user", "Rename the photos   by date", now - 3 * 86_400_000), message("assistant", "Done.", now - 3 * 86_400_000 + 5000)];
  assert.equal(welcomeLine(branch, now), "Back after 3 days · you last asked: “Rename the photos by date”");
  assert.equal(welcomeLine(branch, now - 3 * 86_400_000 + AWAY_MS - 1), undefined, "under two hours is not a return");
  assert.equal(welcomeLine([], now), undefined);
  assert.equal(welcomeLine([message("assistant", "Hi", now - AWAY_MS * 2)], now), undefined, "no message of yours, nothing to remind you of");
});

test("the finish animation plays once, briefly, only after a successful run and only with motion on", () => {
  const state = { prefs: { ...DEFAULTS, enabled: true }, clock: new RunClock(), promptDepth: 0, layout: undefined };
  state.clock.begin(1000);
  assert.equal(settling(state, 1100), false, "not while running");
  state.clock.settle(5000, "done");
  assert.equal(settling(state, 5000 + SETTLE_MS - 1), true);
  assert.equal(settling(state, 5000 + SETTLE_MS), false);
  state.prefs = { ...state.prefs, motion: "off" };
  assert.equal(settling(state, 5100), false);
  state.prefs = { ...state.prefs, motion: "work" }; state.clock.begin(6000); state.clock.settle(7000, "error");
  assert.equal(settling(state, 7100), false, "a failed run does not celebrate");
});
