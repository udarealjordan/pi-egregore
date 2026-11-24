import type { Component } from "@earendil-works/pi-tui";

/** The only place allowed to resolve Pi's forwarding TUI proxy or read the
 * guarded layout shapes used by native adapters. No private fields are read. */
export function resolveReceiver<T extends object>(reference: unknown): T | undefined {
  if (!reference || typeof reference !== "object") return;
  const key = Symbol("pi-egregore:native-receiver");
  const proxy = reference as T & { [key]?: () => T };
  let host: T | undefined;
  try {
    proxy[key] = function () { return this; };
    host = proxy[key]!();
    return host;
  } catch { return; }
  finally {
    const actual = proxy[key]?.();
    if (actual) delete (actual as typeof proxy)[key];
  }
}

export interface ChildLayout {
  width: number;
  children: { component: Component; height: number }[];
}

export interface LayoutBox {
  component: Component;
  children: LayoutBox[];
  scrollView?: unknown;
  scrollContentLines?: string[];
  lines?: string[];
  lineOffset?: number;
  rect: { x: number; y: number; width: number; height: number };
  clip: { x: number; y: number; width: number; height: number };
}

/** Pi 1.5 `mouseLayout` or Pi 1.6 `childLines`; anything else is untrusted. */
export function childLayout(component: object): ChildLayout | undefined {
  const c = component as { mouseLayout?: ChildLayout; childLines?: { width: number; children: Component[]; parts: string[][] } };
  if (c.mouseLayout) return c.mouseLayout;
  const lines = c.childLines;
  if (!lines || !Array.isArray(lines.children) || !Array.isArray(lines.parts) || lines.parts.length !== lines.children.length) return;
  return { width: lines.width, children: lines.children.map((child, i) => ({ component: child, height: Array.isArray(lines.parts[i]) ? lines.parts[i].length : -1 })) };
}

export function findScrollBox(box: LayoutBox, scrollView: unknown, depth = 0): LayoutBox | undefined {
  if (depth > 32 || !box || !Array.isArray(box.children)) return;
  if (box.scrollView === scrollView) return box;
  for (const child of box.children) { const found = findScrollBox(child, scrollView, depth + 1); if (found) return found; }
}
