import { mixColors, parseColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const toColor = value => typeof value === "string" && value.startsWith("#") ? parseColor(value) : value;
const SGR = /\x1b\[[0-9;:]*m/g;
const CUT = "\x1b[0m…\x1b[0m";
/** Truncate a label to terminal cells. pi-tui resets every style before its ellipsis, which
 * would draw it in the terminal's default color; the ellipsis keeps the style in effect where
 * the label was cut, so a shortened title stays in its own color. */
export function fitLabel(value, width) {
  const out = truncateToWidth(value, Math.max(0, width), "…");
  if (!out.endsWith(CUT)) return out;
  const kept = out.slice(0, -CUT.length);
  // Unstyled text needs no reset, so a caller's surrounding style also colors the ellipsis.
  if (!kept.includes("\x1b")) return kept + "…";
  const codes = kept.match(SGR) ?? [];
  const live = codes.slice(codes.findLastIndex(code => code === "\x1b[0m" || code === "\x1b[m") + 1);
  return kept + "\x1b[0m" + live.join("") + "…\x1b[0m";
}
const fit = fitLabel;
const ink = (theme, glyph, color, bold = false) => color && theme?.style ? theme.style(glyph, { fg: toColor(color), bold }) : glyph;
// Row content may leave text attributes open (Pi's thinking text pads in italics); the frame owns its
// edge, so close bold/dim, italic, underline, inverse and strikethrough before drawing it. Colors stay.
const ATTRIBUTES_OFF = "\x1b[22;23;24;27;29m";
const edge = (theme, glyph, color) => ATTRIBUTES_OFF + ink(theme, glyph, color);
const cover = (row, width, surface) => surface ? surface(row, width) : row + " ".repeat(Math.max(0, width - visibleWidth(row)));
// Bounded drawing metadata, not application state. Ambiguous identical rails keep
// only cells owned by both layouts; unknown rails fall back to physical edges.
const railMasks = new Map();
const rememberRail = (row, width, columns) => {
  const previous = railMasks.get(row);
  const mask = previous?.width === width ? new Set([...columns].filter(x => previous.columns.has(x))) : columns;
  railMasks.set(row, { width, columns: mask });
  if (railMasks.size > 256) railMasks.delete(railMasks.keys().next().value);
  return row;
};

/** Box glyphs by line weight. Heavy marks a surface that wants attention now
 * (an input, a question, live work); light marks history. */
// Every frame is thin and rounded. Unicode has rounded corners only in the thin weight,
// so bold edges always met thinner corners; many terminals also draw both weights alike.
// `weight` stays part of the contract: "heavy" marks a surface that wants attention now,
// which callers show with color and bold labels, not thicker lines.
const THIN = Object.freeze({ topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│" });
export const FRAME_GLYPHS = Object.freeze({ light: THIN, heavy: THIN });
export const frameGlyphs = weight => FRAME_GLYPHS[weight === "heavy" ? "heavy" : "light"];

/** Optional, Pi-independent presentation preset. The caller owns state detection and rerenders. */
export function statusPreset({ state = "observed", appearance = "dark", attention = false, markers = {}, colors = {}, labels = {} }) {
  const tone = state === "failed" ? "failed" : state === "cancelled" || attention ? "attention"
    : state === "returned" ? "returned" : state === "running" ? "running" : "quiet";
  const symbol = state === "failed" ? "failed" : state === "cancelled" ? "cancelled"
    : attention ? "attention" : state === "returned" ? "returned" : state === "running" ? "running" : "quiet";
  const palette = appearance === "light"
    ? { failed: "#b4233b", attention: "#895600", returned: "#187444", running: "#096caf", quiet: "#636975" }
    : { failed: "#ff879b", attention: "#efc16c", returned: "#8ed6a7", running: "#80caff", quiet: "#a2a9b5" };
  const defaults = { failed: "×", cancelled: "■", attention: "!", returned: "✓", running: "◉", quiet: "·" };
  return { marker: markers[symbol] ?? defaults[symbol], color: colors[tone] ?? palette[tone], label: labels[state] ?? state };
}

/** Draw a single rail. Labels may contain ANSI styling; every position is optional. */
export function frameRail({ theme, width, left = "", center = "", right = "", side = "top", color, textColor, surface, weight }) {
  const g = frameGlyphs(weight);
  width = Math.max(0, Math.floor(width));
  if (width < 4) return cover(fit(left, width), width, surface);
  const inner = width - 2;
  const label = text => textColor ? ink(theme, text, textColor) : text;
  const columns = new Set([0, width - 1]);
  const rule = (count, start) => {
    for (let x = start; x < start + count; x++) columns.add(x);
    return ink(theme, g.horizontal.repeat(count), color);
  };
  let content;
  if (center) {
    // Center stays centered in terminal cells, even when the two side labels differ.
    // Side labels yield first; a caller can omit low-priority hints at small widths.
    center = fit(center, inner);
    const start = Math.floor((inner - visibleWidth(center)) / 2);
    const end = start + visibleWidth(center);
    left = fit(left, Math.max(0, start - (start > 0 ? 1 : 0)));
    right = fit(right, Math.max(0, inner - end - (end < inner ? 1 : 0)));
    content = label(left) + rule(start - visibleWidth(left), 1 + visibleWidth(left)) + label(center)
      + rule(inner - end - visibleWidth(right), 1 + end) + label(right);
  } else {
    right = fit(right, Math.max(0, inner - 2));
    left = fit(left, inner - visibleWidth(right));
    content = label(left) + rule(Math.max(0, inner - visibleWidth(left) - visibleWidth(right)), 1 + visibleWidth(left)) + label(right);
  }
  return rememberRail(cover(ink(theme, side === "top" ? g.topLeft : g.bottomLeft, color) + content
    + ink(theme, side === "top" ? g.topRight : g.bottomRight, color), width, surface), width, columns);
}

/** Frame pre-rendered content without taking over its input, mouse, or focus. */
export function frameRows({ theme, width, rows, corners = {}, color, textColor, inset = 0, minWidth = 4, surface, motion, weight }) {
  const g = frameGlyphs(weight);
  width = Math.max(0, Math.floor(width));
  if (width < minWidth || width < 4) return rows.map(row => cover(fit(row, width), width, surface));
  inset = Math.max(0, Math.min(Math.floor(inset), Math.floor((width - 4) / 2)));
  const inner = width - 2 - 2 * inset;
  const content = rows.map(row => cover(
    ink(theme, g.vertical, color) + " ".repeat(inset) + cover(fit(row, inner), inner, surface)
      + " ".repeat(inset) + edge(theme, g.vertical, color), width, surface));
  const result = [frameRail({ theme, width, left: corners.topLeft, center: corners.topCenter, right: corners.topRight, color, textColor, surface, weight }),
    ...content, frameRail({ theme, width, left: corners.bottomLeft, center: corners.bottomCenter, right: corners.bottomRight, side: "bottom", color, textColor, surface, weight })];
  return motion?.active ? paintFramePerimeter(result, { theme, width, bottom: result.length - 1, color, ...motion, surface }) : result;
}

/** Travel pace of every moving frame, in columns per second. A row counts as two columns
 * because terminal cells are about twice as tall as wide, so the light keeps one visual
 * speed around corners and frames of any size move alike. `periodMs` times only pulses. */
export const FRAME_SWEEP_SPEED = 60;
const ROW_COLUMNS = 2;
// Below this the light is invisible; such cells keep their bytes, so a tick rewrites only
// the rows the light actually crosses.
const FAINT = .05;
const ESCAPE = /(\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)))/;
const BORDER = /^[╭╮╰╯─┏┓┗┛━│┃]$/;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** Foreground (when it is a 24-bit color) and weight in effect after a run of SGR codes. */
function sgrState(codes) {
  let fg, bold = false;
  for (const code of codes) {
    const params = code.slice(2, -1).split(/[;:]/);
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p === "" || p === "0") { fg = undefined; bold = false; }
      else if (p === "1") bold = true;
      else if (p === "22") bold = false;
      else if (p === "39" || /^(3[0-7]|9[0-7])$/.test(p)) fg = undefined;
      else if (p === "38" || p === "48") {
        const rgb = params[i + 1] === "2", end = i + (rgb ? 4 : 2);
        if (p === "38") fg = rgb ? "#" + params.slice(i + 2, i + 5).map(v => Number(v).toString(16).padStart(2, "0")).join("") : undefined;
        i = end;
      }
    }
  }
  return { fg, bold };
}
/** Recolor the perimeter of an existing frame: its rails and the side edge of each body row.
 * With `labels`, the light also passes through rail label text, which then returns to its own
 * color. Does not move or edit content, and leaves every cell the light does not reach byte-identical. */
export function paintFramePerimeter(rows, { theme, width, bottom = rows.length - 1, color, accent, active = false, now = 0, startAt = 0, periodMs = 3000, speed = FRAME_SWEEP_SPEED, quiet = false, intensity = 1, direction = "clockwise", effect = "shimmer", labels = false, surface } = {}) {
  if (!active || width < 4 || bottom < 1 || !accent) return rows;
  periodMs = Number.isFinite(periodMs) && periodMs > 0 ? periodMs : 3000;
  speed = Number.isFinite(speed) && speed > 0 ? speed : FRAME_SWEEP_SPEED;
  intensity = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 1;
  if (!Number.isFinite(now) || !Number.isFinite(startAt)) return rows;
  const across = width - 1, down = bottom * ROW_COLUMNS, perimeter = 2 * (across + down);
  const elapsed = now - startAt, scale = (quiet ? .4 : 1) * intensity;
  const pulse = (.5 - .5 * Math.cos(((elapsed % periodMs) + periodMs) % periodMs / periodMs * 2 * Math.PI)) * scale;
  const travelled = ((elapsed / 1000 * speed) % perimeter + perimeter) % perimeter;
  const sign = direction === "counterclockwise" ? -1 : 1;
  const head = sign < 0 ? perimeter - travelled : travelled;
  const strength = (x, y) => {
    if (effect === "pulse") return pulse;
    const position = y === 0 ? x : x === width - 1 ? across + y * ROW_COLUMNS : y === bottom ? 2 * across + down - x : perimeter - y * ROW_COLUMNS;
    const behind = (sign * (head - position) + perimeter) % perimeter;
    const ahead = (sign * (position - head) + perimeter) % perimeter;
    return Math.max(Math.exp(-behind / 12), Math.exp(-ahead * ahead / 5)) * scale;
  };
  // Theme style accepts concrete color values. The caller controls color and refresh scheduling.
  const glow = (base, value) => base ? mixColors(toColor(base), toColor(accent), value) : accent;
  const paint = (glyph, value) => ink(theme, glyph, glow(color, value), !quiet && value > .7);
  // Label text the light crosses brightens from its own color and keeps its weight.
  const tint = (glyph, value, codes) => { const { fg, bold } = sgrState(codes); return ink(theme, glyph, glow(fg ?? color, value), bold); };
  const repaint = (row, y, owns, throughLabels) => {
    let out = "", prefix = "", x = 0, changed = false;
    for (const part of row.split(ESCAPE)) {
      if (!part) continue;
      if (part.startsWith("\x1b")) { out += part; prefix += part; continue; }
      for (const { segment } of graphemes.segment(part)) {
        const border = BORDER.test(segment) && owns(x), label = !border && throughLabels && segment.trim() !== "";
        const value = border || label ? strength(x, y) : 0;
        if (value >= FAINT) {
          const codes = prefix.match(SGR) ?? [];
          // Restore foreground, weight and background after each painted cell.
          out += (border ? paint(segment, value) : tint(segment, value, codes)) + "\x1b[0m" + codes.join("");
          changed = true;
        } else out += segment;
        prefix += segment; x += visibleWidth(segment);
      }
    }
    return changed ? cover(out, width, surface) : row;
  };
  return rows.map((row, y) => {
    if (y > bottom) return row;
    if (y === 0 || y === bottom) {
      const mask = railMasks.get(row);
      return repaint(row, y, x => mask?.width === width ? mask.columns.has(x) : x === 0 || x === width - 1, labels);
    }
    // A body row changes only while the light is on one of its edges; its text never does.
    if (strength(0, y) < FAINT && strength(width - 1, y) < FAINT) return row;
    return repaint(row, y, x => x === 0 || x === width - 1, false);
  });
}

/** One collapsed tool call: rail, status marker, name, target and a quiet detail
 * at the right edge, plus optional indented note rows (an error, a child call).
 * Labels may carry ANSI styling; the caller owns colors and state. Consecutive
 * rows share the rail, so a turn's calls read as one block without boxes. */
export function toolRows({ theme, width, marker = "", markerColor, rail = THIN.vertical, railColor, name = "", nameWidth = 8, target = "", detail = "", notes = [], indent = 0, bold = true, surface }) {
  width = Math.max(0, Math.floor(width));
  const lead = ink(theme, rail, railColor) + " " + " ".repeat(Math.max(0, indent));
  const leadWidth = 2 + Math.max(0, indent);
  if (width < leadWidth + 6) return [cover(fit(lead + name, width), width, surface)];
  const head = (marker ? ink(theme, marker, markerColor, true) + " " : "")
    + (bold && theme?.style ? theme.style(name, { bold: true }) : name);
  const headWidth = visibleWidth(head);
  const pad = Math.max(1, (marker ? 2 : 0) + nameWidth - headWidth + 1);
  const room = width - leadWidth - headWidth - pad;
  detail = visibleWidth(detail) > Math.floor(room / 2) ? "" : detail;
  const targetRoom = Math.max(0, room - (detail ? visibleWidth(detail) + 2 : 0));
  const shown = fit(target, targetRoom);
  const gap = Math.max(detail ? 2 : 0, room - visibleWidth(shown) - visibleWidth(detail));
  const rows = [cover(fit(lead + head + " ".repeat(pad) + shown + (detail ? " ".repeat(gap) + detail : ""), width), width, surface)];
  const noteLead = lead + " ".repeat(marker ? 2 : 0);
  const noteRoom = width - leadWidth - (marker ? 2 : 0);
  for (const note of notes) rows.push(cover(noteLead + fit(note, noteRoom), width, surface));
  return rows;
}

/** Where a surface goes, so every component lands in a place users already know.
 * - input: takes the composer's place while you answer or type (questions, side questions)
 * - panel: a centered panel over the transcript for browsing (plans, paths, settings)
 * - dock: live status just above the composer (the current plan)
 * - transcript: history in the scrollback (messages, tool rows)
 * `custom` is the option object for Pi's ctx.ui.custom; `rows(terminalRows)` is the height
 * budget for the surface's own content. Frame only describes placement; the caller owns
 * mounting, focus and input. */
export const FRAME_PLACEMENTS = Object.freeze({
  input: Object.freeze({ weight: "heavy", share: .55, custom: Object.freeze({}) }),
  panel: Object.freeze({ weight: "heavy", share: .8, custom: Object.freeze({ overlay: true, overlayOptions: Object.freeze({ anchor: "center", width: "100%", maxHeight: "80%" }) }) }),
  dock: Object.freeze({ weight: "heavy", share: .25, custom: Object.freeze({}) }),
  transcript: Object.freeze({ weight: "light", share: 1, custom: Object.freeze({}) }),
});
export function framePlacement(kind) {
  const placement = FRAME_PLACEMENTS[kind] ?? FRAME_PLACEMENTS.panel;
  // Two rows of frame plus one of breathing room; never fewer than four content rows.
  return { ...placement, rows: terminalRows => Math.max(4, Math.floor((Number.isFinite(terminalRows) ? terminalRows : 30) * placement.share) - 3) };
}
