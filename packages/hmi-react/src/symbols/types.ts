/**
 * Shared vocabulary of the symbol library. Symbols are pure: props in, SVG out.
 * Each draws a `<g>` centred on (x, y), so a single-line diagram places them
 * in its own `<svg>`; `SymbolSvg` wraps one for use on its own.
 */

import type { AlarmPriority, PointValue } from "@khorde/hmi-core";

/** Position of a switching device. `unknown` is bad quality or no value. */
export type SwitchState = "open" | "closed" | "intermediate" | "invalid" | "unknown";

/** The usual double-point coding: 0 open, 1 closed, 2 intermediate, 3 invalid. */
export const SWITCH_CODES: Readonly<Record<number, SwitchState>> = { 0: "open", 1: "closed", 2: "intermediate", 3: "invalid" };

export function switchStateOf(v: PointValue | undefined, codes: Readonly<Record<number, SwitchState>> = SWITCH_CODES): SwitchState {
  if (!v || v.quality !== "good" || typeof v.value !== "number") return "unknown";
  return codes[v.value] ?? "invalid";
}

/** Whether a conductor carries voltage; null when it cannot be known. */
export type Energized = boolean | null;

/** What an alarm indicator shows. */
export type AlarmIndication = "active-unacked" | "active-acked" | "returned-unacked";

export interface SymbolAlarm {
  priority: AlarmPriority;
  indication: AlarmIndication;
}

/** Props every symbol takes. */
export interface SymbolBase {
  /** Centre of the symbol in the parent drawing. */
  x?: number;
  y?: number;
  /** Degrees, clockwise. 90 lays a vertical symbol horizontally. */
  rotate?: number;
  scale?: number;
  /** Accessible name; the symbol adds its state to it. */
  label?: string;
  /** Makes the symbol a button (opens the faceplate, usually). */
  onActivate?: () => void;
  selected?: boolean;
  /** Alarm badge at the top right. */
  alarm?: SymbolAlarm | null;
}
