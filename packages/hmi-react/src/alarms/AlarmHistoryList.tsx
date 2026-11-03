/**
 * The alarm history (event log): the alarm journal for a time range, one row
 * per change, from `alarmJournal`. Read-only; separate from the live list.
 */

import "./alarms.css";
import { useEffect, useState } from "react";
import { loadAlarmHistory, type AlarmFilter, type AlarmJournalEntry, type I18n } from "@khorde/hmi-core";
import { useHmi, useI18n } from "../context.tsx";
import { AlarmIndicator } from "../widgets/widgets.tsx";

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function journalToCsv(i18n: I18n, entries: readonly AlarmJournalEntry[]): string {
  const head = ["time", "priority", "area", "alarm", "name", "condition", "value", "change", "by"].join(",");
  const rows = entries.map((e) =>
    [
      e.timestamp.toISOString(),
      e.priority === null ? "" : String(e.priority),
      e.area,
      e.kind === "GAP" ? "" : i18n.alarmText(e),
      e.name,
      e.condition,
      e.value === null ? "" : String(e.value),
      e.kind,
      e.kind === "ACK" ? (e.ackedBy ?? "") : "",
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
  entries?: readonly AlarmJournalEntry[];
}

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; entries: readonly AlarmJournalEntry[] };

const STAMP: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };

export function AlarmHistoryList({ from, to, filter, entries }: AlarmHistoryListProps) {
  const i18n = useI18n();
  const { backend } = useHmi();
  const [load, setLoad] = useState<Load>(entries ? { status: "ready", entries } : { status: "loading" });
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const filterKey = JSON.stringify(filter ?? {});

  useEffect(() => {
    if (entries || !backend) return;
    let alive = true;
    loadAlarmHistory(backend, { from: new Date(fromMs), to: new Date(toMs) }, JSON.parse(filterKey) as AlarmFilter).then(
      (list) => alive && setLoad({ status: "ready", entries: list }),
      () => alive && setLoad({ status: "error" }),
    );
    return () => {
      alive = false;
    };
  }, [backend, fromMs, toMs, filterKey, entries]);

  const shown = entries ? { status: "ready" as const, entries } : load;
  const rows = shown.status === "ready" ? shown.entries : [];

  const exportCsv = () => {
    const blob = new Blob([journalToCsv(i18n, rows)], { type: "text/csv" });
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
        {shown.status === "ready" && <span className="kh-alarms-count">{i18n.t("alarmHistory.count", { count: rows.length })}</span>}
        <button type="button" className="kh-btn" disabled={rows.length === 0} onClick={exportCsv}>
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
              {rows.map((e, i) => (
                <tr key={`${e.origin}:${e.instanceId}:${e.kind}:${e.timestamp.getTime()}:${i}`}>
                  <td className="kh-num">{i18n.formatDateTime(e.timestamp, STAMP)}</td>
                  <td className="kh-col-priority">{e.priority !== null && <AlarmIndicator priority={e.priority} indication="active-acked" />}</td>
                  <td>{e.kind === "GAP" ? e.origin : i18n.equipmentName(e.area)}</td>
                  <td>{e.kind === "GAP" ? i18n.t("alarmHistory.gap", { origin: e.origin }) : i18n.alarmText(e)}</td>
                  <td className="kh-num">{e.value !== null && i18n.formatNumber(e.value, { maximumFractionDigits: 2 })}</td>
                  <td>{i18n.t(`alarmHistory.change.${e.kind}`)}</td>
                  <td>{e.kind === "ACK" ? (e.ackedBy ?? "") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="kh-empty">{i18n.t("alarmHistory.empty")}</p>}
        </div>
      )}
    </section>
  );
}
