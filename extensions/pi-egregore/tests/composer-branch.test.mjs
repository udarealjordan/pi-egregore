import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { jiti, source, theme, initTheme, plain, visibleWidth } from "./host.mjs";
import { egregore } from "./egregore-harness.mjs";

const { appearanceRow, appearanceColor } = await jiti.import(join(source, "appearance-render.ts"));
const { COMPOSER_ICONS } = await jiti.import(join(source, "composer-icons.ts"));
const { FOOTER_DEFAULTS, footerPrefs, parseGit } = await jiti.import(join(source, "footer-state.ts"));

test("Composer shows a white branch icon and name beside Vim, not Git status counts", async () => {
  const h = egregore();
  const s = h.egregore;
  const style = s.layout.appearance.elements.branch;
  assert.equal(style.visible, false);
  assert.equal(style.position, "bottomCenter");
  Object.assign(style, { visible: true, color: "#ffffff" });
  s.appearanceMode = "NORMAL";
  h.data.git = parseGit("# branch.head feature/界面\0# branch.ab +2 -1\0? new.txt\0");
  const branch = `${COMPOSER_ICONS.git} feature/界面`;
  try {
    for (const mode of ["dark", "light"]) {
      initTheme(mode, false);
      const row = appearanceRow(theme, 110, s, "bottom", 3000);
      assert.ok(row.includes(theme.style(branch, { fg: appearanceColor(theme, "#ffffff"), bold: false })));
      const center = `NORMAL · ${branch}`;
      const prefix = plain(row).split(center)[0];
      assert.ok(Math.abs(2 * visibleWidth(prefix) + visibleWidth(center) - 110) <= 1);
      const narrow = appearanceRow(theme, 52, s, "bottom", 3000);
      assert.match(plain(narrow), /NORMAL/);
      assert.ok(!plain(narrow).includes(branch));
      assert.equal(visibleWidth(narrow), 52);
    }
    s.layout.icons = "plain";
    assert.ok(plain(appearanceRow(theme, 110, s, "bottom", 3000)).includes("⑂ feature/界面"));
    h.data.git = parseGit("# branch.head (detached)\0# branch.oid 0123456789\0");
    appearanceRow(theme, 110, s, "bottom", 3000);
    assert.ok(!s.appearanceHits.some(hit => hit.id === "branch"));
    h.data.git = undefined;
    appearanceRow(theme, 110, s, "bottom", 3000);
    assert.ok(!s.appearanceHits.some(hit => hit.id === "branch"));
  } finally {
    initTheme("dark", false);
    await h.discard();
  }
});

test("enabling the Git branch in appearance settings persists independently of Git status", async () => {
  const h = egregore({ ...FOOTER_DEFAULTS, git: "off" });
  h.data.git = parseGit("# branch.head main\0");
  h.click("Git branch"); h.click("Show this element");
  h.click("Text color"); h.pick("More color options"); h.text("#ffffff");
  h.click("[Save]");
  const saved = footerPrefs(JSON.parse(JSON.stringify(await h.pending)));
  assert.equal(saved.git, "off");
  assert.equal(saved.appearance.elements.git.visible, false);
  assert.deepEqual(saved.appearance.elements.branch, {
    visible: true, position: "bottomCenter", order: h.latest.appearance.elements.branch.order,
    text: "{value}", color: "#ffffff", bold: false, priority: "low",
  });
});
