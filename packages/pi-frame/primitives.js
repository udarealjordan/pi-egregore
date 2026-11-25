import { mixColors, parseColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const toColor = value => typeof value === "string" && value.startsWith("#") ? parseColor(value) : value;
const fit = (value, width) => truncateToWidth(value, Math.max(0, width), "…");
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

/** Recolor only the two horizontal rails of an existing frame. Does not move or edit
 * content: every body row keeps its bytes, so a host's changed-line diff rewrites two
 * lines per tick instead of every row that carries a side rail. */
export function paintFramePerimeter(rows, { theme, width, bottom = rows.length - 1, color, accent, active = false, now = 0, startAt = 0, periodMs = 3000, quiet = false, intensity = 1, direction = "clockwise", effect = "shimmer", surface } = {}) {
  if (!active || width < 4 || bottom < 1 || !accent) return rows;
  periodMs = Number.isFinite(periodMs) && periodMs > 0 ? periodMs : 3000;
  intensity = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 1;
  if (!Number.isFinite(now) || !Number.isFinite(startAt)) return rows;
  const perimeter = 2 * (width - 1 + bottom);
  const phase = ((now - startAt) % periodMs + periodMs) % periodMs / periodMs;
  const head = (direction === "counterclockwise" ? 1 - phase : phase) * perimeter;
  const paint = (glyph, x, y) => {
    const position = y === 0 ? x : x === width - 1 ? width - 1 + y : y === bottom ? 2 * (width - 1) + bottom - x : perimeter - y;
    const sign = direction === "counterclockwise" ? -1 : 1;
    const behind = (sign * (head - position) + perimeter) % perimeter;
    const ahead = (sign * (position - head) + perimeter) % perimeter;
    const strength = (effect === "pulse" ? .5 - .5 * Math.cos(phase * 2 * Math.PI)
      : Math.max(Math.exp(-behind / 12), Math.exp(-ahead * ahead / 5))) * (quiet ? .4 : 1) * intensity;
    // Theme style accepts concrete color values. The caller controls color and refresh scheduling.
    const glow = color ? mixColors(toColor(color), toColor(accent), strength) : accent;
    return ink(theme, glyph, glow, !quiet && strength > .7);
  };
  return rows.map((row, y) => {
    if (y > bottom) return row;
    if (y === 0 || y === bottom) {
      const mask = railMasks.get(row);
      return cover(row.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))|[╭╮╰╯─┏┓┗┛━]/g, (glyph, offset) => {
        if (glyph.startsWith("\x1b")) return glyph;
        const prefix = row.slice(0, offset), x = visibleWidth(prefix);
        const owned = mask?.width === width ? mask.columns.has(x) : x === 0 || x === width - 1;
        if (!owned) return glyph;
        // Restore foreground, weight and background after each painted cell.
        return paint(glyph, x, y) + "\x1b[0m" + (prefix.match(/\x1b\[[0-9;:]*m/g) ?? []).join("");
      }), width, surface);
    }
    // Side rails keep the base colour. Repainting one rewrites the row that carries
    // it, so the host would erase and resend every content row on each tick.
    return row;
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
