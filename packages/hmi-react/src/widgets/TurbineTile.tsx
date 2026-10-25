import "./widgets.css";
import type { AlarmPriority } from "@khorde/hmi-core";
import { useI18n } from "../context.tsx";
import type { AlarmIndication } from "../symbols/types.ts";
import type { TurbineState } from "../symbols/wind.tsx";
import { AlarmIndicator } from "./widgets.tsx";

export interface TurbineTileProps {
  name: string;
  state: TurbineState;
  /** Active power in kW; null when unknown. */
  powerKw: number | null;
  ratedKw: number;
  /** Curtailment setpoint in kW, shown while below rated. */
  setpointKw?: number | null;
  alarm?: { priority: AlarmPriority; indication: AlarmIndication } | null;
  onActivate?: () => void;
}

/**
 * One turbine in the fleet overview. The surface tells the state: solid when
 * producing, outline when stopped, dashed when silent, an alarm-coloured
 * border only for a fault with an alarm.
 */
export function TurbineTile({ name, state, powerKw, ratedKw, setpointKw, alarm, onActivate }: TurbineTileProps) {
  const i18n = useI18n();
  const mw = powerKw === null || state === "unknown" ? null : powerKw / 1000;
  const power = mw === null ? "?" : i18n.formatNumber(mw, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const stateText = i18n.t(`symbol.turbine.${state}`);
  const curtailed = setpointKw !== undefined && setpointKw !== null && setpointKw < ratedKw;
  const cls = [`kh-tile`, `kh-tile--${state}`, alarm ? `kh-tile--alarm kh-tile--p${alarm.priority}` : ""].join(" ");
  const body = (
    <>
      <span className="kh-tile-top">
        <span className="kh-tile-name">{name}</span>
        {alarm && <AlarmIndicator priority={alarm.priority} indication={alarm.indication} size={18} />}
      </span>
      <span className="kh-tile-state">
        {stateText}
        {curtailed ? " ▾" : ""}
      </span>
      <span className="kh-tile-power">
        <span className="kh-tile-num">{power}</span> <span className="kh-tile-unit">MW</span>
      </span>
      <span className="kh-tile-bar" aria-hidden="true">
        {mw !== null && <span className="kh-tile-fill" style={{ width: `${Math.max(0, Math.min(100, ((powerKw ?? 0) / ratedKw) * 100))}%` }} />}
        {curtailed && <span className="kh-tile-sp" style={{ left: `${(setpointKw / ratedKw) * 100}%` }} />}
      </span>
    </>
  );
  const label = `${name}, ${stateText}, ${mw === null ? i18n.t("value.noValue") : i18n.t("tile.power", { value: power })}${curtailed ? `, ${i18n.t("tile.setpoint", { value: i18n.formatNumber(setpointKw / 1000, { maximumFractionDigits: 2 }) })}` : ""}`;
  return onActivate ? (
    <button type="button" className={cls} onClick={onActivate} aria-label={label}>
      {body}
    </button>
  ) : (
    <div className={cls} role="group" aria-label={label}>
      {body}
    </div>
  );
}
