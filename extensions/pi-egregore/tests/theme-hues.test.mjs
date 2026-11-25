import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { jiti, source } from "./host.mjs";

const { Theme } = await jiti.import("@earendil-works/pi-coding-agent");
const { colorToHex, parseColor } = await jiti.import("@earendil-works/pi-tui");
const { hue, HUES, footerHue } = await jiti.import(join(source, "theme-hues.ts"));
const { COMPOSER_HUES, COMPOSER_THEME_NAME } = await jiti.import(join(source, "composer-palette.ts"));
const { composerThemeColors, userFrameColor } = await jiti.import(join(source, "composer-style.ts"));
const { appearanceColor } = await jiti.import(join(source, "appearance-render.ts"));
const { asideColor } = await jiti.import(join(source, "aside.ts"));
const { pathsColor } = await jiti.import(join(source, "paths.ts"));

const BACKGROUNDS = new Set(["selectedBg", "searchMatchBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"]);
function themeFrom(values, name, appearance) {
  const split = keep => Object.fromEntries(Object.entries(values).filter(([key]) => BACKGROUNDS.has(key) === keep));
  return new Theme(split(false), split(true), "truecolor", { name, appearance });
}
const hex = color => colorToHex(color).toLowerCase();

test("identity hues keep their curated values under the Composer lease", () => {
  for (const appearance of ["dark", "light"]) {
    const theme = themeFrom(composerThemeColors(appearance === "light"), COMPOSER_THEME_NAME, appearance);
    for (const name of HUES) assert.equal(hex(hue(theme, name)), COMPOSER_HUES[appearance][name], `${appearance} ${name}`);
    assert.equal(hex(userFrameColor(theme)), COMPOSER_HUES[appearance].red);
    assert.equal(hex(asideColor(theme)), COMPOSER_HUES[appearance].teal);
    assert.equal(hex(pathsColor(theme)), COMPOSER_HUES[appearance].amber);
    assert.equal(hex(appearanceColor(theme, "blue")), COMPOSER_HUES[appearance].blue);
  }
});

test("identity hues follow the active theme's roles otherwise (e.g. a terminal-derived system theme)", () => {
  // A terminal palette with unmistakable hues stands in for Rex's colors.
  const values = { ...composerThemeColors(false), accent: "#aa00ff", mdLink: "#0044ff", syntaxVariable: "#00ccdd",
    success: "#00aa22", warning: "#ddaa00", error: "#ff0000", text: "#ffffff" };
  const theme = themeFrom(values, "system", "dark");
  assert.equal(hex(hue(theme, "purple")), "#aa00ff");
  assert.equal(hex(footerHue(theme, "violet")), "#aa00ff");
  assert.equal(hex(appearanceColor(theme, "blue")), "#0044ff");
  assert.equal(hex(footerHue(theme, "cyan")), "#00ccdd");
  assert.equal(hex(asideColor(theme)), "#00ccdd");
  assert.equal(hex(footerHue(theme, "green")), "#00aa22");
  assert.equal(hex(pathsColor(theme)), "#ddaa00");
  // The user identity stays red but is softened so it is not the semantic error color.
  const user = userFrameColor(theme);
  assert.notEqual(hex(user), "#ff0000");
  const { r, g, b } = parseColor(hex(user));
  assert.ok(r > g && r > b, `user red keeps a red hue: ${hex(user)}`);
});

test("identity hex literals live only in composer-palette.ts", () => {
  const curated = Object.values(COMPOSER_HUES).flatMap(Object.values);
  const offenders = readdirSync(source).filter(file => file.endsWith(".ts") && file !== "composer-palette.ts")
    .flatMap(file => curated.filter(value => readFileSync(join(source, file), "utf8").toLowerCase().includes(value)).map(value => `${file}: ${value}`));
  assert.deepEqual(offenders, []);
});
