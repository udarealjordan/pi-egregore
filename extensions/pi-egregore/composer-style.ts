import type { Theme } from "@earendil-works/pi-coding-agent";
import { frameGlyphs, frameRail, type FrameWeight } from "../../lib/frame.ts";
import { foregroundAnsi, mixColors, truncateToWidth, visibleWidth, type Color } from "@earendil-works/pi-tui";
import { inheritColors } from "./composer-theme.ts";
import { makeComposerPalette } from "./composer-palette.ts";
import { identityColor } from "./theme-hues.ts";
import { colorToHex } from "@earendil-works/pi-tui";
import { formatDuration, type EgregoreState } from "./state.ts";
import { clean, homePath } from "./footer-state.ts";
import { calendarDay, sentTime, styledSentLabel } from "./sent-metadata.ts";
import { COMPOSER_ICONS } from "./composer-icons.ts";
import { appearanceBorder, appearanceRow, currentAppearanceState } from "./appearance-render.ts";
import { emberStatus, statusWithTools } from "./composer-ember.ts";
import { sessionBadge } from "./composer-title.ts";

/** Padding yields in short/narrow panes; no animation changes geometry. */
export function composerPadding(width: number, rows: number, density: "spaced" | "compact" = "spaced"): number { return density === "spaced" && width >= 44 && rows >= 34 ? 1 : 0; }
/** The Composer is where your attention is, so it draws in heavy lines; history stays light. */
export const COMPOSER_WEIGHT: FrameWeight = "heavy";
export const composerEdge = () => frameGlyphs(COMPOSER_WEIGHT).vertical;
/** Identity colors are owned by theme-hues.ts (see identityColor). */
export function composerBorder(theme: Theme): Color { return identityColor(theme, "user"); }
export function userFrameColor(theme: Theme): Color { return identityColor(theme, "user"); }
export function assistantFrameColor(theme: Theme): Color { return identityColor(theme, "assistant"); }
export function composerInset(width: number): number { return width >= 8 ? 2 : 0; }
/** Related metadata stays readable while borrowing the frame's hue. */
export function quietFrameLabel(theme: Theme, text: string, border: Color): string {
  return theme.style(text, { fg: mixColors(border, theme.colors.muted, .55) });
}

/** A traveling shape in the steady status color, not icons or a filling progress track.
 * Motion follows real run state; errors of individual tools do not latch the frame. */
export function composerMessageRail(theme: Theme, width: number, egregore: EgregoreState, now: number, title: string, hint = ""): string {
  if (egregore.layout?.appearance) return composerSurface(theme, appearanceRow(theme, width, egregore, "top", now, hint), width);
  const busy = egregore.clock.active || egregore.compacting;
  const border = appearanceBorder(theme, egregore);
  const status = egregore.railStatus?.() ?? { text: busy ? "Working" : "What’s next?", tone: busy ? "toolTitle" : "muted" };
  const runningTime = busy && egregore.promptDepth === 0 && egregore.clock.active && egregore.clock.timing
    ? ` ${formatDuration(egregore.railRunElapsed?.(now) ?? now - egregore.clock.timing.startedAt)}` : "";
  const label = statusWithTools(`${clean(status.text)}${runningTime}`, egregore);
  const left = egregore.chronomancerDay ? "" : ` ${emberStatus(theme, label, currentAppearanceState(egregore), egregore, now,
    Math.max(0, Math.min(visibleWidth(label) + 6, width < 42 ? width - 4 : Math.floor(width * .55))), theme.colors[status.tone], true, width >= 60)} `;
  const next = !busy && egregore.layout?.railHint !== "off" ? clean(egregore.nextHint?.() ?? "") : "";
  const sentAt = egregore.lastUserSentAt?.();
  const sent = sentTime(sentAt, egregore.layout, now, !!egregore.chronomancerDay && egregore.chronomancerDay !== calendarDay(now));
  // The native scroll indicator wins. A real user-send time takes priority over
  // the optional task hint; the hint can return before the first recorded send.
  const right = hint ? quietFrameLabel(theme, ` ${hint} `, border)
    : width >= 42 && sent ? styledSentLabel(theme, sent, userFrameColor(theme), "user", egregore.layout?.icons)
    : width >= 66 && next ? quietFrameLabel(theme, ` Next: ${next} `, border) : "";
  // Center stays cell-centered. Reserve the status and a modest right slot first;
  // frameRail can shorten a long time before hiding the session identity.
  const side = Math.max(visibleWidth(left), hint ? visibleWidth(right) : Math.min(visibleWidth(right), 17));
  const titleWidth = Math.max(0, width - 2 - 2 * (side + 1));
  const center = egregore.layout?.railTitle === "off" || width < 40 || titleWidth < 5 ? ""
    : sessionBadge(theme, truncateToWidth(` ${clean(title?.trim() || "Untitled session")} `, titleWidth, "…"), border);
  return composerRail(theme, width, left, right, true, border, center, COMPOSER_WEIGHT);
}

/** Motion belongs to the status marker, never the native input or the full perimeter. */
export function composerFrame(_theme: Theme, rows: string[], _width: number, _egregore: EgregoreState, _now: number, _bottom = rows.length - 1): string[] {
  return rows;
}

/** Public theme roles are also the contract used by pi-ask's standalone shell. */
export function composerThemeColors(light: boolean): Record<string, string> {
  const p = makeComposerPalette(light), hex = (key: string) => colorToHex(p[key]);
  return {
    accent: hex("accent"), border: hex("line"), borderAccent: hex("secondary"), borderMuted: hex("line"),
    text: hex("text"), muted: hex("muted"), dim: hex("muted"), success: hex("success"), warning: hex("warning"), error: hex("error"),
    selectedBg: "", scrollbarTrack: hex("panel"), scrollbarThumb: hex("muted"),
    searchMatchBg: hex("input"), searchMatchText: hex("text"), thinkingText: hex("muted"),
    userMessageBg: "", userMessageText: hex("text"), customMessageBg: "", customMessageText: hex("text"), customMessageLabel: hex("accent"),
    toolPendingBg: "", toolSuccessBg: "", toolErrorBg: "", toolTitle: hex("secondary"), toolOutput: hex("muted"),
    mdHeading: hex("accent"), mdLink: hex("secondary"), mdLinkUrl: hex("muted"), mdCode: hex("warning"), mdCodeBlock: hex("text"),
    mdCodeBlockBorder: hex("line"), mdQuote: hex("muted"), mdQuoteBorder: hex("line"), mdHr: hex("line"), mdListBullet: hex("secondary"),
    toolDiffAdded: hex("success"), toolDiffRemoved: hex("error"), toolDiffContext: hex("muted"),
    syntaxComment: hex("muted"), syntaxKeyword: hex("accent"), syntaxFunction: hex("warning"), syntaxVariable: hex("text"),
    syntaxString: hex("secondary"), syntaxNumber: hex("accent"), syntaxType: hex("secondary"), syntaxOperator: hex("muted"), syntaxPunctuation: hex("muted"),
    thinkingOff: hex("muted"), thinkingMinimal: colorToHex(mixColors(p.muted, p.secondary, 0.25)),
    thinkingLow: hex("secondary"), thinkingMedium: colorToHex(mixColors(p.secondary, p.accent, 0.55)),
    thinkingHigh: hex("accent"), thinkingXhigh: colorToHex(mixColors(p.accent, p.warning, 0.45)),
    thinkingMax: hex("warning"), bashMode: hex("secondary"),
  };
}

export function composerSurface(theme: Theme, text: string, width: number, _input = false): string {
  const fg = foregroundAnsi(theme.colors.text, theme.getColorMode());
  // SGR 49 uses the actual terminal background, not a guessed RGB equivalent.
  // Explicit native selection/cursor styling inside text remains intact.
  const bg = "\x1b[49m";
  const safe = visibleWidth(text) <= width ? text : truncateToWidth(text, Math.max(0, width), "");
  return fg + bg + inheritColors(safe, fg, bg) + " ".repeat(Math.max(0, width - visibleWidth(safe))) + "\x1b[49m\x1b[39m";
}

export function composerBottomRail(theme: Theme, width: number, egregore: EgregoreState,
  context: { cwd?: string; model?: { name?: string; id?: string } }, mode = "", nativeHint = ""): string {
  egregore.appearanceMode = mode;
  if (egregore.layout?.appearance) return composerSurface(theme, appearanceRow(theme, width, egregore, "bottom", Date.now(), nativeHint), width);
  const border = appearanceBorder(theme, egregore);
  // Only a viewport TUI dispatches pointer clicks, and the widest state must
  // survive a centered Vim label; narrower or clickless terminals use /dictate.
  const dictation = (egregore.mouseReporting?.() ?? true) && width >= 40 ? egregore.dictation : undefined;
  const icons = egregore.layout?.icons === "plain" ? "plain" : "nerd";
  const mic = dictation?.label(icons) ?? "";
  const phase = dictation?.phase();
  const micText = mic ? theme.style(mic, {
    fg: phase === "recording" ? theme.colors.warning : phase === "unavailable" ? theme.colors.error : border,
    bold: phase === "recording",
  }) : "";
  const meta = egregore.layout?.railDetails !== "off";
  const left = meta && egregore.layout?.directory !== "off"
    ? quietFrameLabel(theme, ` ${icons === "plain" ? "" : `${COMPOSER_ICONS.directory} `}${homePath(context.cwd || "")} `, border) : "";
  const model = meta && egregore.layout?.model !== "off" ? clean(context.model?.name || context.model?.id || "no model") : "";
  const thinking = egregore.layout?.thinking !== "off" ? clean(egregore.thinkingLevel?.() ?? "") : "";
  // Reserve the right half around a centered Vim label. Shorten the model first
  // so the level is not silently clipped when a provider has a long model name.
  const level = thinking;
  const available = Math.max(0, Math.floor(width / 2) - Math.ceil(visibleWidth(mode ? ` ${clean(mode)} ` : "") / 2) - 2 - visibleWidth(micText));
  const modelName = model ? truncateToWidth(model, Math.max(0, available - visibleWidth(level) - (level ? 5 : 2)), "…") : "";
  const detail = [modelName, level].filter(Boolean).join(" · ");
  // The mic leads the right slot, so tail truncation can never hide the control.
  const right = micText + (nativeHint || (detail ? modelName
    ? theme.style(` ${modelName} `, { fg: border }) + (level ? quietFrameLabel(theme, `· ${level} `, border) : "")
    : quietFrameLabel(theme, ` ${level} `, border) : ""));
  const center = mode ? theme.style(` ${clean(mode)} `, { fg: border, bold: true }) : "";
  return composerRail(theme, width, left, right, false, border, center, COMPOSER_WEIGHT);
}

export function composerRail(theme: Theme, width: number, left = "", right = "", top = true, color: Color = composerBorder(theme), center = "", weight: FrameWeight = "light"): string {
  return frameRail({ theme, width, left, center, right, side: top ? "top" : "bottom", color, weight,
    surface: (text, cells) => composerSurface(theme, text, cells) });
}
