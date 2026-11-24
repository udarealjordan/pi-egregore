import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, truncateToWidth, wrapTextWithAnsi, type Color, type Component, type TUI } from "@earendil-works/pi-tui";
import { framePlacement, frameRows } from "./frame.ts";

/**
 * Egregore's own prompts: a line of text, a choice and a yes/no question.
 *
 * They replace Pi's built-in dialogs (`ctx.ui.input`, `select`, `confirm`), which draw
 * without Frame. By default each one takes the composer's place (the `input`
 * placement), like a question in consult or a note on it. A text prompt may opt into
 * the centered `panel` placement for a standalone startup decision. Outside the
 * terminal UI they fall back to Pi's dialogs, which know how to ask in RPC and print
 * modes.
 *
 * Use these instead of `ctx.ui.input/select/confirm/editor`; a test enforces it.
 */
type Ui = Pick<ExtensionContext, "mode" | "ui">;
export type DialogOptions = { color?: Color; detail?: string };
export type TextDialogOptions = DialogOptions & { placeholder?: string; placement?: "input" | "panel" };
const INPUT_PLACEMENT = framePlacement("input");

/** The frame every prompt shares: detail lines, then the body, keys in the footer. */
function dialogFrame(theme: Theme, width: number, title: string, body: string[], hint: string, options: DialogOptions,
  placement = INPUT_PLACEMENT): string[] {
  const color = options.color ?? theme.colors.accent, inner = Math.max(10, width - 4);
  const detail = options.detail ? wrapTextWithAnsi(theme.fg("muted", options.detail), inner) : [];
  return frameRows({ theme, width, rows: [...detail, ...(detail.length ? [""] : []), ...body], inset: 1, color, weight: placement.weight,
    corners: { topLeft: theme.style(` ${truncateToWidth(title, Math.max(8, inner - 4), "…")} `, { fg: color, bold: true }), bottomLeft: theme.fg("muted", ` ${hint} `) } });
}

/** One line of text. Enter saves (an empty line is a valid answer); Esc cancels. */
export class TextDialog implements Component {
  private input: Input;
  focused = false;
  constructor(private tui: TUI, private theme: Theme, private title: string, value: string, placeholder: string,
    private options: TextDialogOptions, private done: (value: string | undefined) => void) {
    this.input = new Input({ prompt: "", placeholder });
    this.input.setValue(value);
    this.input.handleInput("\x1b[F"); // End: you add to the current value, not in front of it
    this.input.onSubmit = text => this.done(text);
  }
  invalidate(): void {}
  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) return this.done(undefined);
    this.input.handleInput(data); this.tui.requestRender();
  }
  render(width: number): string[] {
    this.input.focused = this.focused;
    const color = this.options.color ?? this.theme.colors.accent;
    const line = this.theme.style("❯ ", { fg: color, bold: true }) + (this.input.render(Math.max(4, width - 6))[0] ?? "");
    return dialogFrame(this.theme, width, this.title, [line], "↵ save · esc cancel", this.options,
      framePlacement(this.options.placement ?? "input"));
  }
}

/** A short list. ↑↓ or a number picks; Enter chooses; Esc cancels. */
export class ChoiceDialog implements Component {
  private selected = 0;
  focused = false;
  constructor(private tui: TUI, private theme: Theme, private title: string, private choices: string[],
    private options: DialogOptions, private done: (value: string | undefined) => void) {}
  invalidate(): void {}
  handleInput(data: string): void {
    const count = this.choices.length;
    if (matchesKey(data, Key.escape)) return this.done(undefined);
    if (matchesKey(data, Key.enter)) return this.done(this.choices[this.selected]);
    if (matchesKey(data, Key.up)) this.selected = (this.selected - 1 + count) % count;
    else if (matchesKey(data, Key.down)) this.selected = (this.selected + 1) % count;
    else if (/^[1-9]$/.test(data) && Number(data) <= count) return this.done(this.choices[Number(data) - 1]);
    this.tui.requestRender();
  }
  render(width: number): string[] {
    const color = this.options.color ?? this.theme.colors.accent, inner = Math.max(10, width - 4);
    const room = Math.max(3, INPUT_PLACEMENT.rows(this.tui.terminal.rows) - 2);
    const start = Math.max(0, Math.min(this.selected - Math.floor(room / 2), this.choices.length - room));
    const rows = this.choices.slice(start, start + room).map((choice, k) => {
      const i = start + k, on = i === this.selected;
      const number = this.choices.length <= 9 ? this.theme.fg("muted", `${i + 1} `) : "";
      const text = truncateToWidth(choice, Math.max(4, inner - 6), "…");
      return (on ? this.theme.style("› ", { fg: color, bold: true }) : "  ") + number + (on ? this.theme.style(text, { fg: "text", bold: true }) : this.theme.fg("text", text));
    });
    const more = this.choices.length > room ? ` · ${this.selected + 1} of ${this.choices.length}` : "";
    return dialogFrame(this.theme, width, this.title, rows, `↑↓ move · ↵ choose${this.choices.length <= 9 ? " · 1–9 pick" : ""} · esc cancel${more}`, this.options);
  }
}

/** A yes/no question. Enter or y says yes; Esc or n says no. */
export class ConfirmDialog implements Component {
  focused = false;
  constructor(private theme: Theme, private title: string, private message: string,
    private options: DialogOptions, private done: (value: boolean) => void) {}
  invalidate(): void {}
  handleInput(data: string): void {
    if (matchesKey(data, Key.enter) || data === "y" || data === "Y") return this.done(true);
    if (matchesKey(data, Key.escape) || data === "n" || data === "N") return this.done(false);
  }
  render(width: number): string[] {
    const rows = this.message ? wrapTextWithAnsi(this.theme.fg("text", this.message), Math.max(10, width - 4)) : [];
    return dialogFrame(this.theme, width, this.title, rows, "↵ or y yes · esc or n no", { ...this.options, detail: undefined });
  }
}

/** Ask for one line of text. Resolves undefined when cancelled. */
export async function askText(ctx: Ui, title: string, value = "", options: TextDialogOptions = {}): Promise<string | undefined> {
  if (ctx.mode !== "tui") return ctx.ui.input(title, value);
  const placement = framePlacement(options.placement ?? "input");
  return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) =>
    new TextDialog(tui, theme, title, value, options.placeholder ?? "", options, done), placement.custom);
}

/** Ask for one of `choices`. Resolves undefined when cancelled. */
export async function askChoice(ctx: Ui, title: string, choices: string[], options: DialogOptions = {}): Promise<string | undefined> {
  if (!choices.length) return undefined;
  if (ctx.mode !== "tui") return ctx.ui.select(title, choices);
  return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) =>
    new ChoiceDialog(tui, theme, title, choices, options, done), INPUT_PLACEMENT.custom);
}

/** Ask yes or no. Cancelling is no. */
export async function askConfirm(ctx: Ui, title: string, message = "", options: DialogOptions = {}): Promise<boolean> {
  if (ctx.mode !== "tui") return ctx.ui.confirm(title, message);
  return (await ctx.ui.custom<boolean>((_tui, theme, _kb, done) =>
    new ConfirmDialog(theme, title, message, options, done), INPUT_PLACEMENT.custom)) === true;
}
