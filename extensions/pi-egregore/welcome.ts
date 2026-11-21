import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { clean } from "./footer-state.ts";

const WIDGET = "pi-egregore:welcome";
/** Resuming after this long gets a one-line reminder of where you left off. */
export const AWAY_MS = 2 * 60 * 60_000;

const textOf = (content: unknown): string => typeof content === "string" ? content
  : Array.isArray(content) ? content.filter((c: any) => c?.type === "text").map((c: any) => c.text ?? "").join(" ") : "";

/** "Back after 3 days · you last asked: …", or nothing for a fresh or recent session. */
export function welcomeLine(branch: SessionEntry[], now: number): string | undefined {
  const last = [...branch].reverse().find(e => Date.parse((e as { timestamp?: string }).timestamp ?? "") > 0);
  const lastAt = last ? Date.parse((last as { timestamp: string }).timestamp) : 0;
  if (!lastAt || now - lastAt < AWAY_MS) return undefined;
  const asked = [...branch].reverse().find(e => e.type === "message" && (e as any).message?.role === "user");
  if (!asked) return undefined;
  const hours = Math.round((now - lastAt) / 3_600_000), days = Math.round(hours / 24);
  const away = hours < 24 ? `${hours} h` : days === 1 ? "a day" : `${days} days`;
  return `Back after ${away} · you last asked: “${clean(textOf((asked as any).message.content)).replace(/\s+/g, " ").trim()}”`;
}

/** Display only: no model call, no session write. It clears once you start the next run. */
export function registerWelcome(pi: ExtensionAPI) {
  const clear = (ctx: ExtensionContext) => { if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET, undefined); };
  pi.on("session_start", (_e, ctx) => {
    if (ctx.mode !== "tui") return;
    const line = welcomeLine(ctx.sessionManager.getBranch(), Date.now());
    if (!line) return clear(ctx);
    ctx.ui.setWidget(WIDGET, (_tui, theme) => ({ invalidate() {}, render: (width: number) => [truncateToWidth(theme.fg("dim", `  ${line}`), width, "…”")] }), { placement: "aboveEditor" });
  });
  pi.on("agent_start", (_e, ctx) => clear(ctx));
  pi.on("session_tree", (_e, ctx) => clear(ctx));
}
