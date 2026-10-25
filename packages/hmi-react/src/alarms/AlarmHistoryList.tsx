/**
 * The alarm history (event log): every alarm change in a time range, from
 * `alm(filter)`. Read-only; separate from the live list. An acknowledgement is
 * a change of its own, so an alarm that was acknowledged appears twice.
 */

import "./alarms.css";
import { useEffect, useState } from "react";
import { loadAlarmHistory, type Alarm, type AlarmFilter, type I18n } from "@khorde/hmi-core";
import { useHmi, useI18n } from "../context.tsx";
import { AlarmIndicator } from "../widgets/widgets.tsx";

export interface AlarmChange {
  key: string;
  at: Date;
  kind: Alarm["state"] | "ack";
  alarm: Alarm;
}

/** Splits alarms into their changes (raise/return/event, then ack), newest first. */
export function alarmChanges(alarms: readonly Alarm[]): AlarmChange[] {
  const out: AlarmChange[] = [];
  // An ack is logged as a copy of the alarm with `acked` set: its state change is already listed.
  const seen = new Set<string>();
  const add = (c: AlarmChange) => {
    if (seen.has(c.key)) return;
    seen.add(c.key);
    out.push(c);
  };
  for (const a of alarms) {
    add({ key: `${a.instanceId}:${a.state}:${a.timestamp.getTime()}`, at: a.timestamp, kind: a.state, alarm: a });
    if (a.acked && a.ackTimestamp) add({ key: `${a.instanceId}:ack:${a.ackTimestamp.getTime()}`, at: a.ackTimestamp, kind: "ack", alarm: a });
  }
  return out.sort((x, y) => y.at.getTime() - x.at.getTime());
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function changesToCsv(i18n: I18n, changes: readonly AlarmChange[]): string {
  const head = ["time", "priority", "area", "alarm", "name", "condition", "value", "change", "by"].join(",");
  const rows = changes.map((c) =>
    [
      c.at.toISOString(),
      String(c.alarm.priority),
      c.alarm.area,
      i18n.alarmText(c.alarm),
      c.alarm.name,
      c.alarm.condition,
      String(c.alarm.value),
      c.kind,
      c.kind === "ack" ? (c.alarm.actorDisplay ?? "") : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [head, ...rows].join("\n");
}

export interface AlarmHistoryListProps {
  from: Date;
  to: Date;
  /** Plain data only (no `textOf`): it is compared by value. */
  filter?: Omit<AlarmFilter, "textOf">;
  /** Rows to show instead of querying (tests, previews). */
  alarms?: readonly Alarm[];
}

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; alarms: readonly Alarm[] };

const STAMP: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };

export function AlarmHistoryList({ from, to, filter, alarms }: AlarmHistoryListProps) {
  const i18n = useI18n();
  const { backend } = useHmi();
  const [load, setLoad] = useState<Load>(alarms ? { status: "ready", alarms } : { status: "loading" });
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const filterKey = JSON.stringify(filter ?? {});

  useEffect(() => {
    if (alarms || !backend) return;
    let alive = true;
    loadAlarmHistory(backend, { from: new Date(fromMs), to: new Date(toMs) }, JSON.parse(filterKey) as AlarmFilter).then(
      (list) => alive && setLoad({ status: "ready", alarms: list }),
      () => alive && setLoad({ status: "error" }),
    );
    return () => {
      alive = false;
    };
  }, [backend, fromMs, toMs, filterKey, alarms]);

  const shown = alarms ? { status: "ready" as const, alarms } : load;
  const changes = shown.status === "ready" ? alarmChanges(shown.alarms) : [];

  const exportCsv = () => {
    const blob = new Blob([changesToCsv(i18n, changes)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `alarm-history-${from.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="kh-alarms" aria-label={i18n.t("alarmHistory.label")} aria-busy={shown.status === "loading"}>
      <div className="kh-alarms-bar">
        <span className="kh-alarms-range">
          {i18n.formatDateTime(from, STAMP)} – {i18n.formatDateTime(to, STAMP)}
        </span>
        {shown.status === "ready" && <span className="kh-alarms-count">{i18n.t("alarmHistory.count", { count: changes.length })}</span>}
        <button type="button" className="kh-btn" disabled={changes.length === 0} onClick={exportCsv}>
          {i18n.t("alarmHistory.export")}
        </button>
      </div>
      {shown.status === "loading" && <p className="kh-empty">{i18n.t("alarmHistory.loading")}</p>}
      {shown.status === "error" && <p className="kh-empty">{i18n.t("alarmHistory.failed")}</p>}
      {shown.status === "ready" && (
        <div className="kh-table-wrap">
          <table className="kh-table">
            <thead>
              <tr>
                {(["time", "priority", "area", "alarm", "value", "change", "by"] as const).map((c) => (
                  <th key={c} scope="col" className={`kh-col-${c}`}>
                    {i18n.t(`alarmHistory.columns.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.key}>
                  <td className="kh-num">{i18n.formatDateTime(c.at, STAMP)}</td>
                  <td className="kh-col-priority">
                    <AlarmIndicator priority={c.alarm.priority} indication="active-acked" />
                  </td>
                  <td>{i18n.equipmentName(c.alarm.area)}</td>
                  <td>{i18n.alarmText(c.alarm)}</td>
                  <td className="kh-num">{i18n.formatNumber(c.alarm.value, { maximumFractionDigits: 2 })}</td>
                  <td>{i18n.t(`alarmHistory.change.${c.kind}`)}</td>
                  <td>{c.kind === "ack" ? (c.alarm.actorDisplay ?? "") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {changes.length === 0 && <p className="kh-empty">{i18n.t("alarmHistory.empty")}</p>}
        </div>
      )}
    </section>
  );
}
