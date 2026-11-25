import type { Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, parseColor, type Color } from "@earendil-works/pi-tui";
import { COMPOSER_HUES, COMPOSER_THEME_NAME } from "./composer-palette.ts";

/** Egregore's named identity hues: user red, aside teal, paths amber, footer and layout accents. */
export type Hue = keyof typeof COMPOSER_HUES.dark;
export const HUES = Object.keys(COMPOSER_HUES.dark) as Hue[];
export const isHue = (value: string): value is Hue => Object.hasOwn(COMPOSER_HUES.dark, value);

/**
 * The single owner of identity hues. Under the Composer lease they keep their curated values;
 * under any other theme they come from Pi's theme roles, so a `system` theme carries the
 * terminal's palette (e.g. Rex) into every Egregore surface. Roles follow Pi's own hue families:
 * accent is violet, error red, success green, mdLink blue, syntaxVariable cyan, warning yellow.
 */
export function hue(theme: Theme, name: Hue): Color {
  if (theme.name === COMPOSER_THEME_NAME) return parseColor(COMPOSER_HUES[theme.appearance === "light" ? "light" : "dark"][name]);
  const c = theme.colors;
  switch (name) {
    // Softened toward text so the user identity stays distinguishable from semantic errors.
    case "red": return mixColors(c.error, c.text, .25);
    case "purple": return c.accent;
    case "blue": return c.mdLink;
    case "cyan": case "teal": return c.syntaxVariable;
    case "green": return c.success;
    case "amber": return c.warning;
  }
}

/** The footer's stored color names; its "violet" is the same identity as layout "purple". */
export function footerHue(theme: Theme, color: "cyan" | "violet" | "green"): Color {
  return hue(theme, color === "violet" ? "purple" : color);
}

/** Who a surface speaks for. The accent is the user's, since it is the theme they chose: Composer frame,
 *  their messages, name and send times, Tasks. The assistant speaks in the plain text color: its
 *  messages, model name and thinking level. These are wired by role and are not per-element settings. */
export type Identity = "user" | "assistant";
export function identityColor(theme: Theme, who: Identity): Color {
  return who === "user" ? theme.colors.accent : theme.colors.text;
}
