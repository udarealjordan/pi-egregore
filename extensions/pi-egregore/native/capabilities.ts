import type { TUI } from "@earendil-works/pi-tui";
import { resolveReceiver, type LayoutBox } from "./shapes.ts";

export type NativeCapability =
  | "editor-decoration"
  | "message-decoration"
  | "tool-decoration"
  | "selection-cleaning"
  | "paint-synchronization"
  | "copy-flash-decoration";

export interface NativeCapabilityReport {
  capability: NativeCapability;
  status: "full" | "limited" | "native";
  reason?: string;
}

type SelectionHost = {
  currentLayout?: { root: LayoutBox; width: number };
  previousScreen?: string[];
  getActiveSelectionText?: () => string | undefined;
  getSelectionBounds?: () => unknown;
  getSelectionColumns?: (line: string, row: number, selection: unknown) => { start: number; end: number };
};

type PaintHost = { render?: (...args: unknown[]) => unknown; doRender?: (...args: unknown[]) => unknown };
type FlashHost = { flashes?: { render?: (width: number) => string[] } };

function hasMethod(value: unknown, key: string): boolean {
  try { return !!value && typeof (value as Record<string, unknown>)[key] === "function"; }
  catch { return false; }
}

export function inspectNativeCapabilities(reference: unknown): NativeCapabilityReport[] {
  const host = resolveReceiver<SelectionHost & PaintHost & FlashHost>(reference);
  let flashes: unknown;
  try { flashes = host?.flashes; } catch { /* throwing accessors are unsupported host shapes */ }
  const selection = !!host && hasMethod(host, "getActiveSelectionText") && hasMethod(host, "getSelectionBounds") && hasMethod(host, "getSelectionColumns");
  const paint = !!host && hasMethod(host, "render"), synchronized = !!host && hasMethod(host, "doRender");
  const flash = hasMethod(flashes, "render");
  return [
    { capability: "selection-cleaning", status: selection ? "full" : "native", ...(!selection ? { reason: "Pi selection API unavailable" } : {}) },
    { capability: "paint-synchronization", status: paint ? synchronized ? "full" : "limited" : "native",
      ...(!paint ? { reason: "Native renderer unavailable" } : !synchronized ? { reason: "Synchronized paint hook unavailable; render preparation remains available" } : {}) },
    { capability: "copy-flash-decoration", status: flash ? "full" : "native", ...(!flash ? { reason: "Native copy notice unavailable" } : {}) },
  ];
}

export function isTuiReference(reference: unknown): reference is TUI {
  return !!resolveReceiver<object>(reference);
}
