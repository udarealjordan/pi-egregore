import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { jiti, source, theme, initTheme, plain, visibleWidth } from "./host.mjs";

const { registerWebMessageFrames, webContentReadyFacts, WEB_CONTENT_READY } = await jiti.import(join(source, "web-message-frames.ts"));
const { copyProjectionOf } = await jiti.import(join(source, "native/copy-projection.ts"));

const text = rows => rows.map(plain).join("\n");
const legacy = (successful, total, fetchId, availability) => `Content fetched for ${successful}/${total} URLs [${fetchId}]. ${availability}`;
const messages = {
  full: {
    customType: WEB_CONTENT_READY,
    content: legacy(2, 2, "full-id", "Full page content now available."),
    details: { fetchId: "full-id", successfulUrls: 2, totalUrls: 2, availability: "full" },
  },
  partial: {
    customType: WEB_CONTENT_READY,
    content: legacy(1, 2, "partial-id", "Partial page content now available."),
    details: { fetchId: "partial-id", successfulUrls: 1, totalUrls: 2, availability: "partial" },
  },
  none: {
    customType: WEB_CONTENT_READY,
    content: legacy(0, 2, "none-id", "No page content was fetched. Stored fetch diagnostics are available."),
    details: { fetchId: "none-id", successfulUrls: 0, totalUrls: 2, availability: "none" },
  },
};

function adapter(enabled = () => true) {
  let renderer;
  registerWebMessageFrames({ registerMessageRenderer(type, value) { assert.equal(type, WEB_CONTENT_READY); renderer = value; } }, enabled);
  return message => renderer(message, { expanded: false, outputPad: 1, keyText: value => value, keyHint: value => value }, theme);
}

test("structured readiness facts exclude contradictory states and historical text remains readable", () => {
  assert.deepEqual(webContentReadyFacts(messages.partial), {
    fetchId: "partial-id", successfulUrls: 1, totalUrls: 2, availability: "partial",
  });
  assert.deepEqual(webContentReadyFacts({ customType: WEB_CONTENT_READY,
    content: legacy(1, 2, "old-id", "Partial page content now available.") }), {
    fetchId: "old-id", successfulUrls: 1, totalUrls: 2, availability: "partial",
  });
  assert.equal(webContentReadyFacts({ customType: WEB_CONTENT_READY, content: "changed format",
    details: { fetchId: "bad", successfulUrls: 2, totalUrls: 1, availability: "full" } }), undefined);
  assert.equal(webContentReadyFacts({ customType: WEB_CONTENT_READY,
    content: legacy(0, 2, "wrong", "Full page content now available.") }), undefined);
});

test("content readiness uses truthful semantic states and a semantic copy projection", () => {
  const render = adapter();
  const cases = [
    [messages.full, /✓ ready/],
    [messages.partial, /! partial/],
    [messages.none, /× unavailable/],
  ];
  for (const [message, status] of cases) {
    const component = render(message), rows = component.render(90), output = text(rows);
    assert.match(output, /Web · Content fetch/);
    assert.match(output, status);
    assert.match(output, new RegExp(`${message.details.successfulUrls}/${message.details.totalUrls} URLs fetched`));
    assert.match(output, new RegExp(`responseId ${message.details.fetchId}`));
    assert.ok(rows.every(row => visibleWidth(row) === 90));
    const projection = copyProjectionOf(component);
    assert.ok(projection);
    const copied = projection.rows.flatMap(row => row.segments.map(segment => segment.text)).join("\n");
    assert.match(copied, /URLs fetched/);
    assert.match(copied, /responseId/);
    assert.doesNotMatch(copied, /Web · Content fetch|✓ ready|! partial|× unavailable/);
  }
});

test("historical messages frame across themes and widths while narrow or disabled views retain native presentation", () => {
  let enabled = true;
  const render = adapter(() => enabled);
  const historical = { customType: WEB_CONTENT_READY, content: legacy(3, 4, "historic-id", "Partial page content now available.") };
  const component = render(historical);
  for (const appearance of ["light", "dark"]) {
    initTheme(appearance, false);
    for (const width of [24, 40, 90]) {
      const rows = component.render(width), output = text(rows);
      assert.match(output, /Web · Content fetch/);
      assert.match(output, /3\/4 URLs fetched/);
      assert.ok(rows.every(row => visibleWidth(row) === width));
    }
  }
  const narrow = text(component.render(20)), compactNarrow = narrow.replace(/\s+/g, "");
  assert.match(compactNarrow, /\[web-search-content-ready\]/);
  assert.match(compactNarrow, /Contentfetchedfor/);
  assert.doesNotMatch(narrow, /Web · Content fetch/);
  enabled = false;
  const native = text(component.render(90));
  assert.match(native, /\[web-search-content-ready\]/);
  assert.match(native, /Partial page content now available/);
  assert.doesNotMatch(native, /Web · Content fetch/);
});

test("unknown custom-message shapes stay with Pi's native renderer", () => {
  const render = adapter();
  assert.equal(render({ customType: WEB_CONTENT_READY, content: "future wording", details: { version: 2 } }), undefined);
});
