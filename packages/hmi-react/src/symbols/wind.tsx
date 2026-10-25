/**
 * Wind symbols. A turbine is a rotor disc on a short mast, in the same
 * language as a breaker: a filled disc produces, an outline is idle, a grey
 * outline is stopped, dashed with "?" has no communication, a half-filled disc
 * is curtailed. A fault carries an alarm badge. It stays readable at 20 px.
 */

import { useI18n } from "../context.tsx";
import { AlarmShape, SymbolGroup, UnknownMark } from "./parts.tsx";
import type { SymbolBase } from "./types.ts";

export type TurbineState = "producing" | "waiting" | "stopped" | "fault" | "curtailed" | "unknown";

/** The demo plant's coding (0 stopped, 1 producing, 2 waiting, 3 fault, 4 curtailed); pass your own if it differs. */
export const TURBINE_CODES: Readonly<Record<number, TurbineState>> = { 0: "stopped", 1: "producing", 2: "waiting", 3: "fault", 4: "curtailed" };

const HUB_Y = -12;
const R = 14;

/** Wind turbine, 48 × 64: rotor disc at the top, mast down to the connection point. */
export function WindTurbine(props: SymbolBase & { state: TurbineState }) {
  const i18n = useI18n();
  const { state } = props;
  const name = `${props.label ?? i18n.t("symbol.windTurbine")}, ${i18n.t(`symbol.turbine.${state}`)}`;
  return (
    <SymbolGroup base={props} name={name} className={`kh-turbine kh-turbine--${state}`}>
      <rect className="kh-sym-hit" x={-24} y={-32} width={48} height={64} />
      <path className="kh-turbine-mast" d={`M0 ${HUB_Y + R} V28 M-8 28 H8`} />
      <circle className="kh-turbine-disc" cx={0} cy={HUB_Y} r={R} />
      {state === "curtailed" && <path className="kh-turbine-half" d={`M${-R} ${HUB_Y} A${R} ${R} 0 0 0 ${R} ${HUB_Y} Z`} />}
      <g className="kh-turbine-rotor" transform={`translate(0 ${HUB_Y})`}>
        {[0, 120, 240].map((a) => (
          <line key={a} x1={0} y1={0} x2={0} y2={-(R - 4)} transform={`rotate(${a})`} />
        ))}
      </g>
      {state === "unknown" && <UnknownMark x={16} y={14} size={14} />}
      {props.alarm && <AlarmShape priority={props.alarm.priority} indication={props.alarm.indication} x={10} y={-32} size={18} />}
    </SymbolGroup>
  );
}

export interface WindIndicatorProps {
  /** m/s; null when unknown. */
  speed: number | null;
  /** Degrees the wind comes FROM (meteorological). */
  direction: number | null;
  size?: number;
  label?: string;
}

/** Wind speed and direction: an arrow pointing where the wind blows to. */
export function WindIndicator({ speed, direction, size = 64, label }: WindIndicatorProps) {
  const i18n = useI18n();
  const known = speed !== null && direction !== null;
  const text = known ? `${i18n.formatNumber(speed, { maximumFractionDigits: 1 })} m/s` : "—";
  const name = `${label ?? i18n.t("symbol.wind")}: ${known ? `${text}, ${i18n.formatNumber(direction)}°` : i18n.t("value.noValue")}`;
  return (
    <svg className="kh-wind" width={size} height={size} viewBox="-32 -32 64 64" role="img" aria-label={name}>
      <circle className="kh-wind-dial" r={28} />
      {["N", "E", "S", "W"].map((c, i) => (
        <text key={c} className="kh-wind-cardinal" x={[0, 22, 0, -22][i]} y={[-19, 4, 26, 4][i]} textAnchor="middle">
          {c}
        </text>
      ))}
      {known ? (
        <path className="kh-wind-arrow" d="M0 -16 L6 6 L0 2 L-6 6 Z" transform={`rotate(${(direction + 180) % 360})`} />
      ) : (
        <UnknownMark size={16} />
      )}
    </svg>
  );
}
