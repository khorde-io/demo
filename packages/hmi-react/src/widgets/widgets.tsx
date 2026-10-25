/**
 * Generic ISA-101 widgets: alarm indicator, analog value, analog bar,
 * connection dot. Pure: they take values and states, not point ids.
 */

import "./widgets.css";
import type { Alarm, AlarmPriority, Quality } from "@khorde/hmi-core";
import { useI18n } from "../context.tsx";
import { AlarmShape, INDICATION_KEY } from "../symbols/parts.tsx";
import type { AlarmIndication } from "../symbols/types.ts";

/** How an alarm from the list is indicated. */
export function alarmIndication(alarm: Pick<Alarm, "state" | "acked">): AlarmIndication {
  if (alarm.state === "Reset") return "returned-unacked";
  return alarm.acked ? "active-acked" : "active-unacked";
}


export function AlarmIndicator({ priority, indication, size = 20 }: { priority: AlarmPriority; indication: AlarmIndication; size?: number }) {
  const i18n = useI18n();
  return (
    <svg className="kh-alarm-indicator" width={size} height={size} viewBox="-2 -2 24 24" role="img" aria-label={i18n.t(INDICATION_KEY[indication], { priority })}>
      <AlarmShape priority={priority} indication={indication} />
    </svg>
  );
}

export interface AnalogValueProps {
  value: number | null;
  unit?: string;
  /** Fraction digits; default 1. */
  decimals?: number;
  quality?: Quality;
  stale?: boolean;
  alarm?: { priority: AlarmPriority; indication: AlarmIndication } | null;
  size?: "sm" | "md" | "lg";
  label?: string;
}

/** A number with its unit, decorated (not recoloured) when it cannot be trusted. */
export function AnalogValue({ value, unit, decimals = 1, quality = "good", stale = false, alarm, size = "md", label }: AnalogValueProps) {
  const i18n = useI18n();
  const text = value === null ? "—" : i18n.formatNumber(value, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const notes = [value === null ? i18n.t("value.noValue") : null, quality !== "good" ? i18n.t("value.bad") : null, stale ? i18n.t("value.stale") : null].filter(Boolean);
  const name = [label, `${text}${unit ? ` ${unit}` : ""}`, ...notes].filter(Boolean).join(", ");
  return (
    <span
      className={`kh-value kh-value--${size}${quality !== "good" ? " kh-value--bad" : ""}${stale ? " kh-value--stale" : ""}`}
      role="group"
      aria-label={name}
    >
      <span className="kh-value-num" aria-hidden="true">
        {text}
      </span>
      {unit && (
        <span className="kh-value-unit" aria-hidden="true">
          {unit}
        </span>
      )}
      {quality !== "good" && value !== null && (
        <span className="kh-value-mark" aria-hidden="true">
          ?
        </span>
      )}
      {stale && quality === "good" && (
        <svg className="kh-value-stale" width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">
          <circle cx={7} cy={7} r={6} />
          <path d="M7 3.5 V7 L9.5 8.5" />
        </svg>
      )}
      {alarm && <AlarmIndicator priority={alarm.priority} indication={alarm.indication} size={18} />}
    </span>
  );
}

export interface AnalogBarProps {
  value: number | null;
  min: number;
  max: number;
  /** The normal operating band, drawn as a darker stretch of the track. */
  normal?: [number, number];
  /** Alarm limits, drawn as ticks. */
  limits?: readonly number[];
  /** A setpoint marker (curtailment, for example). */
  setpoint?: number | null;
  quality?: Quality;
  label: string;
}

const pct = (v: number, min: number, max: number) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;

/** The high-performance "moving analog indicator": where the value sits, not just its number. */
export function AnalogBar({ value, min, max, normal, limits = [], setpoint, quality = "good", label }: AnalogBarProps) {
  const i18n = useI18n();
  const usable = value !== null && quality === "good";
  // A meter needs a current value; without one the bar is an image saying so.
  const a11y = usable
    ? { role: "meter", "aria-label": label, "aria-valuemin": min, "aria-valuemax": max, "aria-valuenow": value }
    : { role: "img", "aria-label": `${label}, ${i18n.t("value.noValue")}` };
  return (
    <div className={`kh-abar${usable ? "" : " kh-abar--bad"}`} {...a11y}>
      {usable && normal && <span className="kh-abar-band" style={{ left: pct(normal[0], min, max), width: `calc(${pct(normal[1], min, max)} - ${pct(normal[0], min, max)})` }} />}
      {usable && limits.map((l) => <span key={l} className="kh-abar-lim" style={{ left: pct(l, min, max) }} />)}
      {usable && setpoint !== undefined && setpoint !== null && <span className="kh-abar-sp" style={{ left: pct(setpoint, min, max) }} />}
      {usable && <span className="kh-abar-ptr" style={{ left: pct(value, min, max) }} />}
    </div>
  );
}

export type Connectivity = "online" | "offline" | "unknown";

/** Connection state by shape: filled online, hollow offline, dashed unknown. */
export function StatusDot({ status }: { status: Connectivity }) {
  return <span className={`kh-dot kh-dot--${status}`} aria-hidden="true" />;
}
