import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  COPY_PROJECTION_PROPERTY, CopyLines, appendCopyLines, asCopyLines, cloneCopyLines,
  copyRowSelection, copyRowText, copySegment, forgetCopyProjection, projectCopyLines,
  projectFrameCopy, projectRailCopy, readCopyProjection, rememberCopyProjection,
} from "../src/copy.ts";

/** @param {import("../src/copy.ts").CopyProjection["rows"]} rows */
function projection(rows, revision = 1) {
  return { version: 1, surfaceId: "test:surface", width: 20, height: rows.length, rows, revision };
}

test("copy projection validates version, geometry, plain text and ordered cell spans", () => {
  const valid = projection([
    { row: 0, renderedText: "╭──────────╮", segments: [] },
    { row: 1, renderedText: "│ alpha 界  │", segments: [{ start: 1, end: 12, text: " alpha 界  ", kind: "content" }] },
  ]);
  assert.equal(readCopyProjection(valid), valid);
  assert.equal(COPY_PROJECTION_PROPERTY, "piCopyProjection");
  assert.equal(copySegment("界", 2).end, 4);
  assert.equal(visibleWidth(copySegment("界", 2).text), 2);

  assert.equal(readCopyProjection({ ...valid, version: 2 }), undefined);
  assert.equal(readCopyProjection({ ...valid, surfaceId: "bad surface" }), undefined);
  assert.equal(readCopyProjection({ ...valid, height: 3 }), undefined);
  assert.equal(readCopyProjection(projection([{ row: 1, renderedText: "x", segments: [] }])), undefined);
  assert.equal(readCopyProjection(projection([{ row: 0, renderedText: "\x1b[31mx\x1b[0m", segments: [] }])), undefined);
  assert.equal(readCopyProjection(projection([{ row: 0, renderedText: "x", segments: [{ start: 0, end: 2, text: "x", kind: "content" }] }])), undefined);
  assert.equal(readCopyProjection(projection([
    { row: 0, renderedText: "xx", segments: [
      { start: 1, end: 2, text: "x", kind: "content" },
      { start: 0, end: 1, text: "x", kind: "content" },
    ] },
  ])), undefined);
  assert.equal(readCopyProjection(projection([{ row: 0, renderedText: "x", segments: [{ start: 0, end: 1, text: "x", kind: "unknown" }] }])), undefined);
});

test("copy row selection separates content, metadata, decoration and padding", () => {
  const row = { row: 0, renderedText: "│ note │ text  │", segments: [
    { start: 0, end: 1, text: "│", kind: "decoration" },
    { start: 1, end: 7, text: " note ", kind: "metadata" },
    { start: 7, end: 8, text: "│", kind: "decoration" },
    { start: 8, end: 14, text: " text ", kind: "content" },
    { start: 14, end: 15, text: "│", kind: "decoration" },
  ] };
  assert.equal(copyRowSelection(row, 0, 1), undefined, "border-only selection has no semantic text");
  assert.equal(copyRowSelection(row, 1, 7), " note");
  assert.equal(copyRowSelection(row, 8, 14), " text");
  assert.equal(copyRowSelection(row, 0, 15), " note  text");
  assert.equal(copyRowSelection(row, 0, 15, false), " note  text ", "composed native/projected ranges can retain interior trailing cells until row completion");
  assert.equal(copyRowText(row, 0, 1), "");

  const blank = { row: 0, renderedText: "│     │", segments: [{ start: 1, end: 6, text: "     ", kind: "content" }] };
  assert.equal(copyRowSelection(blank, 0, 7), "", "a selected blank content row is not decoration");
});

test("copy row selection slices wide and combining characters by terminal cells", () => {
  const text = "A界e\u0301🧭Z";
  const row = { row: 0, renderedText: text, segments: [copySegment(text)] };
  assert.equal(copyRowSelection(row, 0, 1), "A");
  assert.equal(copyRowSelection(row, 1, 3), "界");
  assert.equal(copyRowSelection(row, 3, 4), "e\u0301");
  assert.equal(copyRowSelection(row, 4, 6), "🧭");
  assert.equal(copyRowSelection(row, 6, 7), "Z");
});

test("CopyLines keeps kinds and multiple cell spans through ordinary array mutations", () => {
  const lines = new CopyLines("rail", "body");
  lines.copySafe = false;
  lines.mark(0, 1, "decoration");
  lines.mark(1, 2, "content", [{ start: 2, end: 5 }, { start: 8, end: 11 }]);
  lines.push("tail");
  lines.unshift("head");
  assert.deepEqual(lines.copyKinds, ["content", "decoration", "content", "content"]);
  assert.equal(lines.shift(), "head");
  assert.equal(lines.pop(), "tail");
  lines.splice(1, 1, "inserted", "appended");
  assert.deepEqual([...lines], ["rail", "inserted", "appended"]);
  assert.deepEqual(lines.copyKinds, ["decoration", "content", "content"]);
  assert.deepEqual(lines.copySpans[0], undefined);

  const slice = lines.slice(-2);
  assert.deepEqual([...slice], ["inserted", "appended"]);
  assert.ok(slice instanceof CopyLines, "slice preserves semantic row metadata");
  assert.ok(!(lines.map(line => line) instanceof CopyLines), "native map results stay plain arrays");
  assert.equal(slice.copySafe, false);
  assert.equal(lines.slice(0, 0).copySafe, false, "empty slices retain fail-closed safety");
  assert.equal(lines.slice(2, 1).length, 0);
  assert.deepEqual(lines.splice(1, 99).copyKinds, undefined, "removed rows return a plain native array");

  lines.remap([2, 0]);
  lines[0] = "appended";
  lines[1] = "rail";
  assert.deepEqual(lines.copyKinds, ["content", "decoration"]);
  lines.mark(0, 2, "metadata", { start: 1, end: 4 });
  const cloned = cloneCopyLines(lines);
  cloned.mark(0, 1, "padding");
  assert.deepEqual(lines.copyKinds, ["metadata", "metadata"], "clone metadata is independent");
  assert.equal(cloned.copySafe, false);
});

test("copy lines use structural detection and append offsets without losing safety or spans", () => {
  const reloaded = ["left", "right"];
  reloaded.copyKinds = ["content", "decoration"];
  reloaded.copySpans = [[{ start: 1, end: 3 }, { start: 5, end: 7 }], undefined];
  reloaded.copySafe = false;
  assert.equal(asCopyLines(reloaded), reloaded, "no stale instanceof dependency");
  assert.deepEqual(asCopyLines(["plain"]).copyKinds, ["content"]);

  const target = new CopyLines();
  appendCopyLines(target, reloaded, line => `  ${line}`, 2);
  assert.deepEqual(target.copyKinds, ["content", "decoration"]);
  assert.deepEqual(target.copySpans[0], [{ start: 3, end: 5 }, { start: 7, end: 9 }]);
  assert.equal(target.copySafe, false);
  appendCopyLines(target, ["native"]);
  assert.equal(target.copySafe, false, "one unsafe source keeps the composed surface unsafe");
  const emptyUnsafe = new CopyLines(); emptyUnsafe.copySafe = false;
  const safeTarget = new CopyLines();
  appendCopyLines(safeTarget, emptyUnsafe);
  assert.equal(safeTarget.copySafe, false, "an empty unsafe source still fails closed");
});

test("line and frame builders project only declared semantic cells", () => {
  const semantic = new CopyLines("╭────────╮", "│ a │ b  │", "╰────────╯");
  semantic.mark(0, 1, "decoration");
  semantic.mark(1, 2, "content", [{ start: 1, end: 6 }, { start: 6, end: 9 }]);
  semantic.mark(2, 3, "decoration");
  const rendered = [...semantic];
  const projected = projectCopyLines("test:lines", 10, rendered, semantic, 2);
  assert.deepEqual(projected.rows[1].segments.map(segment => segment.text), [" a │ ", "b  "]);
  assert.equal(copyRowSelection(projected.rows[1], 0, 10), " a │ b");
  assert.equal(copyRowSelection(projected.rows[0], 0, 10), undefined);
  assert.equal(readCopyProjection(projected), projected);

  const frame = projectFrameCopy("test:frame", 12, ["top        ", "pad        ", "   body   ", "pad        ", "bottom     ", "menu       "], 3,
    { inset: 2, padding: 1, bottom: 4, height: 5 });
  assert.equal(frame.height, 5, "native rows after the frame stay outside the projection");
  assert.deepEqual(frame.rows.map(row => row.segments.length), [0, 0, 1, 0, 0]);
  assert.deepEqual(frame.rows[2].segments[0], { start: 3, end: 9, text: "body  ", kind: "content" });

  const rail = projectRailCopy("test:rail", 8, ["│ text  ", "        "], 4);
  assert.deepEqual(rail.rows.map(row => row.segments.length), [1, 0]);
  assert.equal(rail.rows[0].segments[0].text, "text  ");
});

test("projection memory accepts only matching visible prefixes and can be forgotten", () => {
  const owner = {};
  const rows = ["\x1b[31m│ body │\x1b[0m", "menu"];
  const projection = projectFrameCopy("test:owner", 9, rows, 5, { inset: 1 });
  assert.deepEqual(rememberCopyProjection(owner, 9, rows, projection), rows);
  assert.equal(owner.piCopyProjection, projection);
  rememberCopyProjection(owner, 9, ["drift", "menu"], projection);
  assert.equal(owner.piCopyProjection, undefined, "render drift removes stale provenance");
  rememberCopyProjection(owner, 8, rows, projection);
  assert.equal(owner.piCopyProjection, undefined, "width drift removes stale provenance");
  rememberCopyProjection(owner, 9, rows, { ...projection, version: 2 });
  assert.equal(owner.piCopyProjection, undefined, "unknown contract versions fail open");
  rememberCopyProjection(owner, 9, rows, projection);
  forgetCopyProjection(owner);
  assert.equal(Object.hasOwn(owner, COPY_PROJECTION_PROPERTY), false);
});
