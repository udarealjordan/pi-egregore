import type { Color, OverlayOptions } from "@earendil-works/pi-tui";

export interface FrameTheme {
  style?(text: string, options: any): string;
}
export interface FrameCorners {
  topLeft?: string;
  topCenter?: string;
  topRight?: string;
  bottomLeft?: string;
  bottomCenter?: string;
  bottomRight?: string;
}
export interface FrameMotion {
  active: boolean;
  now: number;
  accent?: Color | string;
  startAt?: number;
  periodMs?: number;
  quiet?: boolean;
  intensity?: number;
  direction?: "clockwise" | "counterclockwise";
  effect?: "shimmer" | "pulse";
}
export interface FrameOptions {
  theme?: FrameTheme;
  width: number;
  rows: string[];
  corners?: FrameCorners;
  color?: Color | string;
  textColor?: Color | string;
  inset?: number;
  minWidth?: number;
  surface?: (text: string, width: number) => string;
  motion?: FrameMotion;
  /** Heavy for a surface that wants attention now; light (default) for history. */
  weight?: FrameWeight;
}
export type FrameWeight = "light" | "heavy";
export interface FrameGlyphs { topLeft: string; topRight: string; bottomLeft: string; bottomRight: string; horizontal: string; vertical: string }
export const FRAME_GLYPHS: Readonly<Record<FrameWeight, Readonly<FrameGlyphs>>>;
export function frameGlyphs(weight?: FrameWeight): Readonly<FrameGlyphs>;
export interface ToolRowOptions {
  theme?: FrameTheme;
  width: number;
  marker?: string;
  markerColor?: Color | string;
  rail?: string;
  railColor?: Color | string;
  name?: string;
  nameWidth?: number;
  target?: string;
  detail?: string;
  notes?: string[];
  indent?: number;
  bold?: boolean;
  surface?: (text: string, width: number) => string;
}
/** One collapsed tool call as a rail row plus optional indented note rows. */
export function toolRows(options: ToolRowOptions): string[];
export type FrameStatus = "preparing" | "running" | "returned" | "failed" | "cancelled" | "observed";
export interface StatusPresetOptions {
  state: FrameStatus;
  appearance?: "dark" | "light";
  attention?: boolean;
  markers?: Partial<Record<"failed" | "cancelled" | "attention" | "returned" | "running" | "quiet", string>>;
  colors?: Partial<Record<"failed" | "attention" | "returned" | "running" | "quiet", Color | string>>;
  labels?: Partial<Record<FrameStatus, string>>;
}
/** Pure visual mapping. Caller classifies its own state and requests rerenders. */
export function statusPreset(options: StatusPresetOptions): { marker: string; color: Color | string; label: string };
export function frameRail(options: Omit<FrameOptions, "rows" | "corners" | "motion"> & { left?: string; center?: string; right?: string; side?: "top" | "bottom" }): string;
export function frameRows(options: FrameOptions): string[];
export function paintFramePerimeter(rows: string[], options: Omit<FrameOptions, "rows" | "corners" | "inset" | "minWidth" | "textColor"> & FrameMotion & { bottom?: number }): string[];

export type FramePlacementKind = "input" | "panel" | "dock" | "transcript";
export interface FramePlacement {
  weight: FrameWeight;
  /** Share of the terminal height the surface may use. */
  share: number;
  /** Options for Pi's ctx.ui.custom: an overlay for panels, in place for the others. */
  custom: { overlay?: boolean; overlayOptions?: OverlayOptions };
}
export const FRAME_PLACEMENTS: Readonly<Record<FramePlacementKind, Readonly<FramePlacement>>>;
/** A placement with its content-row budget for the current terminal height. */
export function framePlacement(kind: FramePlacementKind): FramePlacement & { rows(terminalRows?: number): number };
