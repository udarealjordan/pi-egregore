import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { askText } from "../../lib/dialogs.ts";

type PromptContext = Pick<ExtensionContext, "mode" | "sessionManager" | "ui">;

/** Preserve the original personal extension's definition of a fresh terminal session. */
export function shouldPromptForSessionName(pi: Pick<ExtensionAPI, "getSessionName">, event: SessionStartEvent, ctx: PromptContext): boolean {
  if (ctx.mode !== "tui" || event.reason !== "startup" || pi.getSessionName()) return false;

  // Startup also covers `pi --continue` and `pi --resume`. Fresh sessions have a
  // path, but Pi does not create that file until it persists the session.
  const file = ctx.sessionManager.getSessionFile();
  if (file && existsSync(file)) return false;
  if (ctx.sessionManager.getHeader()?.parentSession) return false;

  // Initial model/thinking metadata is normal for a new session.
  return !ctx.sessionManager.getEntries().some(entry =>
    entry.type !== "model_change" && entry.type !== "thinking_level_change"
  );
}

/** Ask for a friendly name on a fresh startup using Egregore's framed text prompt. */
export default function sessionNamePrompt(pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    if (!shouldPromptForSessionName(pi, event, ctx)) return;

    const name = (await askText(ctx, "Name this session", "", {
      placeholder: "e.g. Fix login bug",
      placement: "panel",
    }))?.trim();

    if (!name) return;
    pi.setSessionName(name);
    ctx.ui.notify(`Session named: ${name}`, "info");
  });
}
