import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { installCopyFlashFrame } from "../copy-flash.ts";
import { installPaintGuard } from "../paint-guard.ts";
import { inspectNativeCapabilities, type NativeCapability, type NativeCapabilityReport } from "./capabilities.ts";
import { resolveReceiver } from "./shapes.ts";
import { installSemanticSelection } from "./selection.ts";

export interface NativeHostMount {
  beforePaint: () => void;
  enabled: () => boolean;
  theme: () => Theme;
}

type Cleanup = () => void;
type Registration = { capability: NativeCapability; cleanup: Cleanup };

const CAPABILITIES: readonly NativeCapability[] = [
  "editor-decoration", "message-decoration", "tool-decoration",
  "selection-cleaning", "paint-synchronization", "copy-flash-decoration",
];
const HOST_CAPABILITIES: readonly NativeCapability[] = ["selection-cleaning", "paint-synchronization", "copy-flash-decoration"];

/** Private owner for every Pi-native adapter installed by Egregore. Surface
 * modules still decide what to render; this class decides mount order,
 * capability truth and reversible teardown. */
export class NativeHost {
  private host: Registration[] = [];
  private owned: Registration[] = [];
  private reports = new Map<NativeCapability, NativeCapabilityReport>();
  private mounted = false;

  mount(reference: unknown, options: NativeHostMount): void {
    this.unmountHost();
    const renderer = resolveReceiver<Component>(reference);
    if (!renderer) {
      for (const capability of HOST_CAPABILITIES) this.reports.set(capability, { capability, status: "native", reason: "Native renderer unavailable" });
      return;
    }
    let reports: NativeCapabilityReport[];
    try { reports = inspectNativeCapabilities(reference); }
    catch {
      for (const capability of HOST_CAPABILITIES) this.reports.set(capability, { capability, status: "native", reason: "Native capability inspection unavailable" });
      return;
    }
    for (const report of reports) this.reports.set(report.capability, report);
    this.install("selection-cleaning", () => installSemanticSelection(reference));
    this.install("paint-synchronization", () => installPaintGuard(renderer, options.beforePaint, options.enabled));
    this.install("copy-flash-decoration", () => installCopyFlashFrame(reference, options.theme));
    this.mounted = true;
  }

  /** Install one host adapter without letting an unsupported method shape
   * prevent later capabilities from mounting or session startup from continuing. */
  private install(capability: NativeCapability, factory: () => Cleanup): void {
    if (this.reports.get(capability)?.status === "native") return;
    try {
      const cleanup = factory();
      this.host.push({ capability, cleanup });
    } catch {
      this.reports.set(capability, { capability, status: "native", reason: "Native adapter could not be installed; Pi behavior retained" });
    }
  }

  /** Register a dynamic adapter owned by this mount (editor/messages/tools).
   * Replacing a capability disposes only the previous adapter for that slot. */
  own(capability: NativeCapability, cleanup: Cleanup): void {
    this.release(capability);
    this.owned.push({ capability, cleanup });
    this.reports.set(capability, { capability, status: "full" });
  }

  release(capability: NativeCapability): void {
    const index = this.owned.findIndex(entry => entry.capability === capability);
    if (index < 0) return;
    const [entry] = this.owned.splice(index, 1);
    try { entry.cleanup(); } catch { /* cleanup remains best-effort and idempotent */ }
    this.reports.set(capability, { capability, status: "native" });
  }

  report(): NativeCapabilityReport[] {
    return CAPABILITIES.map(capability => ({ ...(this.reports.get(capability) ?? { capability, status: "native" }) }));
  }

  private unmountHost(): void {
    for (const entry of this.host.splice(0).reverse()) {
      try { entry.cleanup(); } catch { /* a later adapter must still detach */ }
    }
    this.mounted = false;
  }

  dispose(): void {
    // Dynamic surface wrappers detach before the host selection/paint hooks.
    for (const entry of this.owned.splice(0).reverse()) {
      try { entry.cleanup(); } catch { /* continue reverse-order teardown */ }
    }
    this.unmountHost();
    for (const capability of CAPABILITIES) this.reports.set(capability, { capability, status: "native" });
  }

  get active(): boolean { return this.mounted; }
}
