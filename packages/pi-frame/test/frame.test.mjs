import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
const root = process.env.PI_FRAME_HOST_MODULES || process.env.PI_EGREGORE_HOST_MODULES || process.env.PI_HOME_HOST_MODULES || process.env.PI_ASK_HOST_MODULES || (() => {
  const install = join(homedir(), ".pi/agent/install");
  try { return join(install, "releases", readFileSync(join(install, "current-version"), "utf8").trim(), "node_modules"); }
  catch { throw new Error("Pi test host unavailable. Set PI_FRAME_HOST_MODULES (or PI_EGREGORE_HOST_MODULES / PI_ASK_HOST_MODULES) to a compatible host node_modules directory."); }
})();
const { createJiti } = await import(pathToFileURL(join(root, "jiti/lib/jiti.mjs")));
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-tui": join(root, "@earendil-works/pi-tui/dist/index.js") } });
const { frameRail, frameRows, paintFramePerimeter, statusPreset, frameGlyphs, toolRows, fitLabel, FRAME_SWEEP_SPEED } = await jiti.import(fileURLToPath(new URL("../index.js", import.meta.url)));
const { visibleWidth, CURSOR_MARKER, colorToRgb } = await import(pathToFileURL(join(root, "@earendil-works/pi-tui/dist/index.js")));
const theme = { style: (text, { fg }) => `\x1b[38;2;100;120;180m${text}\x1b[39m` };
const plain = text => text.replace(/\x1b\[[0-9;]*m/g, "");

test("dedicated primitive entry preserves the public root API and ships its declarations", async () => {
  const direct = await jiti.import("pi-embeddable-frame/primitives");
  for (const [name, fn] of Object.entries({ frameRail, frameRows, paintFramePerimeter, statusPreset })) assert.equal(direct[name], fn);
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const entry = manifest.exports["./primitives"];
  assert.equal(entry.types, "./primitives.d.ts");
  assert.equal(entry.default, "./primitives.js");
  for (const path of Object.values(entry)) {
    assert.ok(manifest.files.includes(path.replace(/^\.\//, "")));
    assert.ok(readFileSync(new URL(`../${path}`, import.meta.url), "utf8").length);
  }
});

test("four independent optional corners, ANSI labels, CJK and input cursor", () => {
  for (const width of [4, 8, 24, 60]) {
    const rows = frameRows({ theme, width, rows: [`hello 界面${CURSOR_MARKER}界`], color: "#445566", inset: 1,
      corners: { topLeft: " one ", topRight: " two ", bottomLeft: " three ", bottomRight: " four " } });
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => visibleWidth(row) === width));
    assert.equal(rows.join("").split(CURSOR_MARKER).length - 1, width >= 24 ? 1 : 0);
    if (width >= 60) for (const label of ["one", "two", "three", "four"]) assert.match(plain(rows.join("")), new RegExp(label));
  }
  assert.match(plain(frameRows({ width: 10, rows: ["body"] })[1]), /^│body\s+│$/);
  assert.equal(plain(frameRail({ width: 9, left: " much-too-long ", right: " x " })).length, 9);
});

test("center labels stay centered and optional side labels yield at narrow widths", () => {
  for (const width of [8, 17, 42, 70]) {
    const row = frameRail({ width, left: " state ", center: " 聊天 ", right: " Next: tests " });
    const content = plain(row);
    assert.equal(visibleWidth(row), width);
    const start = content.indexOf("聊天");
    assert.ok(start >= 0);
    // The center is anchored by terminal cells, not by unequal side labels.
    const before = visibleWidth(content.slice(0, start));
    assert.ok(Math.abs(before + visibleWidth("聊天") / 2 - width / 2) <= 1);
    if (width >= 42) assert.match(content, /state.*聊天.*Next: tests/);
  }
  const rows = frameRows({ width: 36, rows: ["body"], corners: { topCenter: " Name ", bottomCenter: " NORMAL " } });
  assert.match(rows[0], /Name/); assert.match(rows.at(-1), /NORMAL/);
  assert.ok(rows.every(row => visibleWidth(row) === 36));
});

test("status preset is pure, optional and allows independent color, icon and label overrides", () => {
  const markers = { preparing: "·", running: "◉", returned: "✓", failed: "×", cancelled: "■", observed: "·" };
  for (const appearance of ["dark", "light"]) for (const [state, marker] of Object.entries(markers)) {
    const result = statusPreset({ state, appearance });
    assert.equal(result.marker, marker);
    assert.match(result.color, /^#[0-9a-f]{6}$/i);
    assert.equal(result.label, state);
  }
  assert.equal(statusPreset({ state: "returned", attention: true }).marker, "!");
  assert.equal(statusPreset({ state: "failed", attention: true }).marker, "×");
  assert.deepEqual(statusPreset({ state: "running", markers: { running: "↻" }, colors: { running: "#123456" }, labels: { running: "working" } }),
    { marker: "↻", color: "#123456", label: "working" });
  const decorated = statusPreset({ state: "returned" });
  const row = frameRows({ width: 28, rows: ["unchanged"], corners: { topLeft: ` ${decorated.marker} Task ` } });
  assert.match(plain(row[0]), /✓ Task/);
  assert.match(plain(row[1]), /unchanged/);
});

test("narrow fallback never produces overflowing rows", () => {
  for (const width of [0, 1, 2, 3, 7]) {
    const rows = frameRows({ width, rows: ["wide 界面 input"], minWidth: 8 });
    assert.equal(rows.length, 1);
    assert.ok(visibleWidth(rows[0]) <= width);
  }
});

test("perimeter paint preserves styled border-shaped labels, ANSI context and unknown rails", () => {
  const label = "\x1b[1;38;2;234;127;129mA─╭界面🌈B\x1b[0m";
  for (const position of ["topLeft", "topCenter", "topRight", "bottomLeft", "bottomCenter", "bottomRight"]) {
    const fixed = frameRows({ width: 52, rows: ["body"], corners: { [position]: label }, color: "#333333" });
    const moving = paintFramePerimeter(fixed, { theme, width: 52, color: "#333333", accent: "#ffffff", active: true, now: 500 });
    assert.ok(moving.join("").includes(label));
    assert.deepEqual(moving.map(plain), fixed.map(plain)); assert.deepEqual(moving.map(visibleWidth), fixed.map(visibleWidth));
  }
  const unknown = ["╭ " + label + " ───────────╮", "│body│", "╰────────────────╯"];
  const width = visibleWidth(unknown[0]);
  const moving = paintFramePerimeter(unknown, { theme, width, accent: "#ffffff", active: true, now: 500 });
  assert.ok(moving[0].includes(label), "unknown rails do not guess ownership inside labels");
  const ambiguous = frameRail({ width: 20 });
  assert.equal(frameRail({ width: 20, left: "─" }), ambiguous);
  const painted = paintFramePerimeter([ambiguous, frameRail({ width: 20, side: "bottom" })],
    { theme, width: 20, accent: "#ffffff", active: true, now: 500 });
  assert.deepEqual(painted.map(plain), [ambiguous, frameRail({ width: 20, side: "bottom" })].map(plain));
});

test("motion is opt-in, stable in geometry and never paints content", () => {
  const fixed = frameRows({ width: 36, rows: ["editor content"], color: "#333333", corners: { topLeft: " Header " } });
  const moving = paintFramePerimeter(fixed, { theme, width: 36, bottom: 2, color: "#333333", accent: "#ffffff", active: true, now: 500 });
  assert.deepEqual(moving.map(visibleWidth), fixed.map(visibleWidth));
  assert.equal(moving[1].includes("editor content"), true);
  assert.equal(plain(moving[1]), plain(fixed[1]));
  // A shade-sensitive theme proves the horizontal rails still carry the travelling light.
  const channels = color => color?.kind === "rgb" ? `${color.r},${color.g},${color.b}`
    : color?.kind === "indexed" ? `i${color.index}` : `o${color.l},${color.c},${color.h}`;
  const shade = { style: (text, { fg, bold }) => `\x1b[38;2;${channels(fg)};${bold ? 1 : 0}m${text}\x1b[39m` };
  const first = paintFramePerimeter(fixed, { theme: shade, width: 36, bottom: 2, color: "#333333", accent: "#ffffff", active: true, now: 500 });
  const later = paintFramePerimeter(fixed, { theme: shade, width: 36, bottom: 2, color: "#333333", accent: "#ffffff", active: true, now: 900 });
  assert.notEqual(later[0], first[0], "the top rail still travels");
  assert.notEqual(later.at(-1), first.at(-1), "the bottom rail still travels");
  assert.deepEqual(paintFramePerimeter(fixed, { theme, width: 36, active: false, accent: "#ffffff" }), fixed);
});

test("heavy weight swaps every perimeter glyph and keeps geometry; perimeter motion still paints it", () => {
  const light = frameRows({ theme, width: 30, rows: ["body"], corners: { topLeft: " Title " } });
  const heavy = frameRows({ theme, width: 30, rows: ["body"], corners: { topLeft: " Title " }, weight: "heavy" });
  assert.deepEqual(heavy.map(row => visibleWidth(row)), light.map(row => visibleWidth(row)));
  assert.match(plain(heavy[0]), /^╭ Title ─+╮$/); assert.match(plain(heavy[1]), /^│body +│$/); assert.match(plain(heavy[2]), /^╰─+╯$/);
  assert.equal(frameGlyphs().vertical, "│");
  assert.deepEqual(frameGlyphs("heavy"), frameGlyphs("light"), "every frame is thin and rounded; weight marks attention, not line thickness");
  const painted = paintFramePerimeter(heavy, { theme, width: 30, color: "#334455", accent: "#aabbcc", active: true, now: 500 });
  assert.notEqual(painted[0], heavy[0], "heavy rails are perimeter cells too");
  assert.equal(plain(painted[1]), plain(heavy[1]), "side rows keep their text");
});

const rgbShade = { style: (text, { fg, bold }) => { const { r, g, b } = colorToRgb(fg);
  return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}${bold ? ";1" : ""}m${text}\x1b[39;22m`; } };

test("the light travels down the side edges beside text, touching only edge cells near it", () => {
  const body = Array.from({ length: 30 }, (_, i) => `\x1b[3mline ${i} of reply text\x1b[0m`);
  const fixed = frameRows({ theme: rgbShade, width: 40, rows: body, color: "#333333" });
  const motion = { theme: rgbShade, width: 40, color: "#333333", accent: "#ffffff", active: true };
  // 39 columns across, then 2 columns per row: at 1.5 s (90 columns) the head is 25 rows down the right side.
  const moving = paintFramePerimeter(fixed, { ...motion, now: 1500 });
  assert.deepEqual(moving.map(stripVTControlCharacters), fixed.map(stripVTControlCharacters), "text and geometry are untouched");
  assert.deepEqual(moving.map(visibleWidth), fixed.map(visibleWidth));
  const touched = moving.map((row, y) => row !== fixed[y]);
  assert.ok(touched[26], "the side edge beside a text row carries the light");
  assert.ok(!touched[0] && !touched[3], "rows the light has not reached keep their bytes");
  assert.ok(touched.filter(Boolean).length < 24, "only rows near the light change on a tick");
  for (const [y, changed] of touched.entries()) if (changed && y > 0 && y < moving.length - 1) {
    // Content between the edges is byte-identical; only the two edge cells may be repainted.
    assert.ok(moving[y].includes("line " + (y - 1) + " of reply text"));
    assert.equal(stripVTControlCharacters(moving[y]).length, 40);
  }
});

test("every frame moves at one pace, whatever its size or period", () => {
  const head = (width, rows, periodMs) => {
    const fixed = frameRows({ theme: rgbShade, width, rows: Array(rows).fill("x"), color: "#000000" });
    const painted = paintFramePerimeter(fixed, { theme: rgbShade, width, color: "#000000", accent: "#ffffff", active: true, now: 400, periodMs });
    const top = stripVTControlCharacters(painted[0]);
    let best = -1, x = 0, max = -1;
    for (const cell of painted[0].split(/(?=\x1b\[38;2;)/)) {
      const m = cell.match(/^\x1b\[38;2;(\d+);/); const glyph = stripVTControlCharacters(cell);
      if (m && Number(m[1]) > max) { max = Number(m[1]); best = x; }
      x += glyph.length;
    }
    assert.equal(top.length, width);
    return best;
  };
  const small = head(60, 2, 1200), large = head(160, 40, 8000);
  assert.equal(small, large, "the brightest cell is the same distance along the rail");
  assert.equal(small, Math.round(FRAME_SWEEP_SPEED * .4));
});

test("a truncated label keeps its ellipsis in the label's own color", () => {
  const label = "\x1b[1;38;2;200;100;50m Photos for Mom and Dad \x1b[0m";
  const cut = fitLabel(label, 10);
  assert.equal(visibleWidth(cut), 10);
  assert.match(cut, /\x1b\[1;38;2;200;100;50m…\x1b\[0m$/);
  assert.equal(fitLabel("plain session name", 8), "plain s…", "unstyled text needs no reset, so an outer style covers the ellipsis");
  assert.equal(fitLabel(label, 40), label);
  const rail = frameRail({ width: 16, left: label, color: "#333333" });
  assert.match(rail, /\x1b\[1;38;2;200;100;50m…/);
});

test("toolRows lays out marker, name, target and right-aligned detail at every width", () => {
  for (const width of [0, 4, 8, 12, 24, 40, 90]) {
    const rows = toolRows({ theme, width, marker: "✓", name: "Read", target: "extensions/pi-tasks/typography.ts", detail: "53 lines", notes: ["a note that is long enough to be clipped at narrow widths"] });
    for (const row of rows) assert.ok(visibleWidth(row) <= Math.max(width, 0) || width === 0, `width ${width}`);
  }
  const [row, note] = toolRows({ theme, width: 60, marker: "✓", name: "Read", target: "a.ts", detail: "3 lines", notes: ["warning"] });
  assert.match(plain(row), /^│ ✓ Read +a.ts +3 lines$/); assert.equal(visibleWidth(row), 60);
  assert.match(plain(note), /^│   warning/);
  const tight = plain(toolRows({ theme, width: 30, marker: "✓", name: "Bash", target: "a very long command that cannot fit beside its detail", detail: "21 lines" })[0]);
  assert.match(tight, /…\s+21 lines$/, "the target yields before the detail");
  const child = plain(toolRows({ theme, width: 40, indent: 2, marker: "×", name: "Read", nameWidth: 6, target: "file5", detail: "failed" })[0]);
  assert.match(child, /^│ {3}× Read +file5 +failed$/);
});

test("placements give each kind of surface one weight, one mounting style and a bounded height", async () => {
  const { framePlacement, FRAME_PLACEMENTS } = await jiti.import(fileURLToPath(new URL("../index.js", import.meta.url)));
  assert.deepEqual(Object.keys(FRAME_PLACEMENTS), ["input", "panel", "dock", "transcript"]);
  assert.equal(framePlacement("panel").custom.overlay, true, "panels float over the transcript");
  assert.equal(framePlacement("input").custom.overlay, undefined, "input surfaces take the composer's place");
  assert.equal(framePlacement("transcript").weight, "light");
  assert.equal(framePlacement("input").rows(40), 19); assert.equal(framePlacement("panel").rows(40), 29);
  assert.equal(framePlacement("dock").rows(8), 4, "never fewer than four rows");
  assert.equal(framePlacement("unknown").share, FRAME_PLACEMENTS.panel.share);
});

test("the right edge never inherits text attributes a full-width row leaves open", () => {
  // Pi pads thinking text in italics to the full width without closing the run.
  const row = "\x1b[3m" + "x".repeat(16);
  const [, content] = frameRows({ theme, width: 20, rows: [row], color: "#6478b4" });
  const edgeAt = content.lastIndexOf("│");
  const before = content.slice(0, edgeAt);
  const lastItalicOn = before.lastIndexOf("\x1b[3m"), italicOff = before.search(/\x1b\[[0-9;]*\b23\b[0-9;]*m(?!.*\x1b\[3m)/s);
  assert.ok(italicOff > lastItalicOn, JSON.stringify(content));
  assert.equal(visibleWidth(content), 20);
  assert.equal(plain(content), "│" + "x".repeat(16) + "  │");
});

test("with labels, the light passes through rail label text and leaves it as it was", () => {
  const label = "\x1b[1;38;2;200;100;50m Photos for Mom \x1b[22;39m";
  const fixed = frameRows({ theme: rgbShade, width: 60, rows: ["body text"], color: "#333333", corners: { topLeft: label } });
  const motion = { theme: rgbShade, width: 60, color: "#333333", accent: "#ffffff", active: true };
  // At 0.15 s the head is 9 columns along: inside the label.
  const lit = paintFramePerimeter(fixed, { ...motion, now: 150, labels: true });
  assert.deepEqual(lit.map(stripVTControlCharacters), fixed.map(stripVTControlCharacters));
  assert.deepEqual(lit.map(visibleWidth), fixed.map(visibleWidth));
  assert.ok(!lit[0].includes(label), "label cells near the light are tinted");
  assert.match(lit[0], /\x1b\[38;2;\d+;\d+;\d+;1m[a-z]/, "tinted label cells keep their bold weight");
  const brightest = Math.max(...[...lit[0].matchAll(/\x1b\[38;2;(\d+);\d+;\d+(?:;1)?m[A-Za-z]/g)].map(m => Number(m[1])));
  assert.ok(brightest > 200, "label text brightens from its own color toward the light");
  assert.ok(lit[1].includes("body text" + " ".repeat(49)), "body text is never tinted");
  assert.ok(paintFramePerimeter(fixed, { ...motion, now: 150 })[0].includes(label), "labels stay untouched unless asked");
  // Once the light has moved far on, the label is byte-identical again.
  const later = paintFramePerimeter(fixed, { ...motion, now: 1600, labels: true });
  assert.ok(later[0].includes(label));
});
