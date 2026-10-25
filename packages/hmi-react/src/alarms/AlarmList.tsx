/**
 * The live active-alarm list (ISA-18.2): newest first, filter by area,
 * priority and text, acknowledge one or all visible. Unacknowledged rows are
 * bold and their indicator flashes. The list comes from the alarm store, which
 * applies the active-alarm rule to the subscription.
 */

import "./alarms.css";
import { useState } from "react";
import { filterAlarms, type Alarm, type AlarmPriority } from "@khorde/hmi-core";
import { useAlarms, useHmi, useI18n } from "../context.tsx";
import { AlarmShape } from "../symbols/parts.tsx";
import { alarmIndication, AlarmIndicator } from "../widgets/widgets.tsx";

export interface AreaFilter {
  label: string;
  /** Alarm area patterns (`vds.wf.>`). */
  patterns: readonly string[];
}

export interface AlarmListProps {
  /** Area buttons; an "All" button is added in front. */
  areas?: readonly AreaFilter[];
  selectedId?: string | null;
  onSelect?: (alarm: Alarm) => void;
  /** Defaults to the alarm store's list. */
  alarms?: readonly Alarm[];
  /** Defaults to the alarm store's `ackMany`. */
  onAck?: (instanceIds: string[]) => void;
  /** Defaults to the signed-in user's `ackAlarm` permission. */
  canAck?: boolean;
}

const PRIORITIES: AlarmPriority[] = [1, 2, 3];
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };

export function AlarmList({ areas = [], selectedId = null, onSelect, alarms, onAck, canAck }: AlarmListProps) {
  const i18n = useI18n();
  const hmi = useHmi();
  const snapshot = useAlarms();
  const list = alarms ?? snapshot.alarms;
  const [area, setArea] = useState<number | null>(null);
  const [priorities, setPriorities] = useState<ReadonlySet<AlarmPriority>>(new Set(PRIORITIES));
  const [text, setText] = useState("");

  const mayAck = canAck ?? hmi.auth?.can("ackAlarm") ?? Boolean(onAck);
  const ack = (ids: string[]) => {
    if (ids.length === 0) return;
    if (onAck) onAck(ids);
    else void hmi.alarms?.ackMany(ids);
  };

  const areaPatterns = area === null ? [] : (areas[area]?.patterns ?? []);
  const visible = filterAlarms(list, {
    areas: areaPatterns,
    priorities: [...priorities],
    text,
    textOf: (a) => `${i18n.alarmText(a)} ${i18n.equipmentName(a.area)}`,
  });
  const unackedVisible = visible.filter((a) => !a.acked).map((a) => a.instanceId);
  const togglePriority = (p: AlarmPriority) =>
    setPriorities((cur) => {
      const next = new Set(cur);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <section className="kh-alarms" aria-label={i18n.t("alarmList.label")}>
      <div className="kh-alarms-bar">
        {areas.length > 0 && (
          <div className="kh-seg" role="group" aria-label={i18n.t("alarmList.area")}>
            <button type="button" aria-pressed={area === null} onClick={() => setArea(null)}>
              {i18n.t("alarmList.allAreas")}
            </button>
            {areas.map((a, i) => (
              <button key={a.label} type="button" aria-pressed={area === i} onClick={() => setArea(i)}>
                {a.label}
              </button>
            ))}
          </div>
        )}
        <div className="kh-seg" role="group" aria-label={i18n.t("alarmList.priority")}>
          {PRIORITIES.map((p) => (
            <button key={p} type="button" aria-pressed={priorities.has(p)} onClick={() => togglePriority(p)}>
              <svg width={16} height={16} viewBox="0 0 20 20" aria-hidden="true">
                <AlarmShape priority={p} />
              </svg>
              P{p}
            </button>
          ))}
        </div>
        <label className="kh-alarms-filter">
          <span>{i18n.t("alarmList.filter")}</span>
          <input type="search" value={text} placeholder={i18n.t("alarmList.filterPlaceholder")} onChange={(e) => setText(e.target.value)} />
        </label>
        {mayAck && (
          <button type="button" className="kh-btn" disabled={unackedVisible.length === 0} onClick={() => ack(unackedVisible)}>
            {i18n.t("alarmList.ackVisible", { count: unackedVisible.length })}
          </button>
        )}
      </div>

      <div className="kh-table-wrap">
        <table className="kh-table">
          <thead>
            <tr>
              {(["priority", "time", "area", "alarm", "value", "state", "acked", "action"] as const).map((c) => (
                <th key={c} scope="col" className={`kh-col-${c}`}>
                  {i18n.t(`alarmList.columns.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr
                key={a.instanceId}
                className={[!a.acked ? "kh-row--unacked" : "", a.instanceId === selectedId ? "kh-row--selected" : ""].join(" ")}
                {...(a.instanceId === selectedId ? { "aria-selected": true } : {})}
              >
                <td className="kh-col-priority">
                  <AlarmIndicator priority={a.priority} indication={alarmIndication(a)} />
                </td>
                <td className="kh-num">{i18n.formatDateTime(a.timestamp, TIME)}</td>
                <td>{i18n.equipmentName(a.area)}</td>
                <td>
                  {onSelect ? (
                    <button type="button" className="kh-link" onClick={() => onSelect(a)}>
                      {i18n.alarmText(a)}
                    </button>
                  ) : (
                    i18n.alarmText(a)
                  )}
                </td>
                <td className="kh-num">{i18n.formatNumber(a.value, { maximumFractionDigits: 2 })}</td>
                <td>{i18n.t(`alarm.state.${a.state}`)}</td>
                <td>
                  {a.acked
                    ? a.actorDisplay
                      ? i18n.t("alarmList.ackedBy", { actor: a.actorDisplay, time: a.ackTimestamp ? i18n.formatDateTime(a.ackTimestamp, TIME) : "" })
                      : i18n.t("alarmList.ackedNoActor", { time: a.ackTimestamp ? i18n.formatDateTime(a.ackTimestamp, TIME) : "" })
                    : i18n.t("alarmList.notAcked")}
                </td>
                <td className="kh-col-action">
                  {mayAck && !a.acked && (
                    <button type="button" className="kh-btn kh-btn--sm" onClick={() => ack([a.instanceId])}>
                      {i18n.t("alarmList.ack")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <p className="kh-empty">{i18n.t(list.length === 0 ? "alarmList.none" : "alarmList.empty")}</p>}
      </div>
      <p className="kh-alarms-foot">{i18n.t("alarmList.summary", { total: list.length, unacked: list.filter((a) => !a.acked).length })}</p>
    </section>
  );
}
