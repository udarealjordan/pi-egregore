import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text, parseColor, type Component } from "@earendil-works/pi-tui";
import { frameRows, statusPreset, type FrameStatus } from "../../lib/frame.ts";
import { composerSurface, quietFrameLabel } from "./composer-style.ts";
import { forgetCopyProjection, projectFrameCopy, rememberCopyProjection } from "./native/copy-projection.ts";
import { matchedToolStatus, toolIdentity, transcriptDefaults, type TranscriptAppearance } from "./transcript-presentation.ts";

export const WEB_CONTENT_READY = "web-search-content-ready";
type Availability = "full" | "partial" | "none";
export type WebContentReadyFacts = {
  fetchId: string;
  successfulUrls: number;
  totalUrls: number;
  availability: Availability;
};
type Message = { customType: string; content: unknown; details?: unknown };
const LEGACY = /^Content fetched for (\d+)\/(\d+) URLs \[([^\]\r\n]+)\]\. (Full page content now available\.|Partial page content now available\.|No page content was fetched\. Stored fetch diagnostics are available\.)$/;
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const count = (value: unknown): number | undefined => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
const expectedAvailability = (successfulUrls: number, totalUrls: number): Availability => successfulUrls === totalUrls ? "full" : successfulUrls > 0 ? "partial" : "none";

export function webMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap(part => {
    const value = record(part);
    return value?.type === "text" && typeof value.text === "string" ? [value.text] : [];
  }).join("\n");
}

function validFacts(fetchId: unknown, successful: unknown, total: unknown, availability: unknown): WebContentReadyFacts | undefined {
  const successfulUrls = count(successful), totalUrls = count(total);
  if (typeof fetchId !== "string" || !fetchId.trim() || successfulUrls === undefined || totalUrls === undefined ||
    totalUrls < 1 || successfulUrls > totalUrls || !["full", "partial", "none"].includes(String(availability)) ||
    availability !== expectedAvailability(successfulUrls, totalUrls)) return undefined;
  return { fetchId, successfulUrls, totalUrls, availability: availability as Availability };
}

/** Prefer the new structured contract; read historical persisted messages through
 * their exact established text. Unknown or contradictory shapes stay native. */
export function webContentReadyFacts(message: Message): WebContentReadyFacts | undefined {
  const details = record(message.details);
  const structured = details && validFacts(details.fetchId, details.successfulUrls, details.totalUrls, details.availability);
  if (structured) return structured;
  const match = LEGACY.exec(webMessageText(message.content).trim());
  if (!match) return undefined;
  const availability: Availability = match[4].startsWith("Full") ? "full" : match[4].startsWith("Partial") ? "partial" : "none";
  return validFacts(match[3], Number(match[1]), Number(match[2]), availability);
}

function nativeRows(message: Message, outputPad: number, theme: Theme, width: number): string[] {
  const box = new Box(outputPad, 1, text => theme.bg("customMessageBg", text));
  box.addChild(new Text(theme.fg("customMessageLabel", theme.bold(`[${message.customType}]`)), 0, 0));
  box.addChild(new Spacer(1));
  box.addChild(new Text(theme.fg("customMessageText", webMessageText(message.content)), 0, 0));
  return box.render(width);
}

function contentSummary(facts: WebContentReadyFacts): string {
  return facts.availability === "full" ? "Full page content available"
    : facts.availability === "partial" ? "Partial page content available"
    : "No page content available · diagnostics stored";
}
function statusState(availability: Availability): FrameStatus {
  return availability === "full" ? "returned" : availability === "partial" ? "observed" : "failed";
}
function statusLabel(availability: Availability): string {
  return availability === "full" ? "ready" : availability === "partial" ? "partial" : "unavailable";
}

function readyFrame(message: Message, facts: WebContentReadyFacts, outputPad: number, theme: Theme,
  enabled: () => boolean, presentation: () => TranscriptAppearance | undefined): Component {
  let revision = 0;
  const component: Component = {
    invalidate() { revision++; },
    render(width: number) {
      forgetCopyProjection(component);
      if (!enabled() || width < 24) return nativeRows(message, outputPad, theme, width);
      const state = statusState(facts.availability), status = statusPreset({ state, appearance: theme.appearance,
        attention: facts.availability === "partial" });
      const semantic = typeof status.color === "string" ? parseColor(status.color) : status.color;
      const quiet = parseColor(theme.appearance === "light" ? "#a6acb8" : "#46505a");
      const attention = facts.availability !== "full", rail = facts.availability === "none" ? semantic : quiet;
      const style = presentation() ?? transcriptDefaults();
      const statusText = ` ${status.marker} ${statusLabel(facts.availability)} `;
      const body = new Text([
        theme.fg(facts.availability === "none" ? "error" : "toolOutput", `${facts.successfulUrls}/${facts.totalUrls} URLs fetched`),
        theme.fg("muted", `${contentSummary(facts)} · responseId ${facts.fetchId}`),
      ].join("\n"), 0, 0).render(width - 4);
      const rows = frameRows({ theme, width, rows: body, inset: 1, color: rail,
        corners: {
          topLeft: toolIdentity(theme, " Web · Content fetch ", rail, style),
          bottomRight: matchedToolStatus(style, attention) ? quietFrameLabel(theme, statusText, rail)
            : theme.style(statusText, { fg: semantic, bold: true }),
        },
        surface: (text, cells) => composerSurface(theme, text, cells) });
      return rememberCopyProjection(component, width, rows,
        projectFrameCopy("pi-egregore:web-content-ready", width, rows, ++revision, { inset: 1 }));
    },
  };
  return component;
}

/** Public custom-message adapter: no tool interception, message rewriting or
 * background work. The stored message and model context remain authoritative. */
export function registerWebMessageFrames(pi: ExtensionAPI, enabled: () => boolean,
  presentation: () => TranscriptAppearance | undefined = () => undefined): void {
  pi.registerMessageRenderer(WEB_CONTENT_READY, (message, { outputPad }, theme) => {
    const value = message as unknown as Message, facts = webContentReadyFacts(value);
    return facts ? readyFrame(value, facts, outputPad, theme, enabled, presentation) : undefined;
  });
}
