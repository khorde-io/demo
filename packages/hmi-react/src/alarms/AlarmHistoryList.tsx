/**
 * The alarm history (event log): the alarm journal for a time range, one row
 * per change, from `alarmJournal`. Read-only; separate from the live list. It
 * shows one page and reads the journal only as far as it needs: a flood can
 * leave tens of thousands of rows in a range. An export reads the whole range.
 */

import "./alarms.css";
import { useEffect, useRef, useState } from "react";
import { createAlarmJournalReader, loadAlarmHistory, type AlarmFilter, type AlarmJournalEntry, type AlarmJournalReader, type I18n } from "@khorde/hmi-core";
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
  /** Rows on a page. */
  pageSize?: number;
}

/** What has been read for one query. `page` is what shows, `turning` a page on its way. */
type Load =
  | { key: string; status: "loading" | "error" }
  | { key: string; status: "ready"; rows: readonly AlarmJournalEntry[]; done: boolean; page: number; turning: boolean; failed: boolean };

const STAMP: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };

export function AlarmHistoryList({ from, to, filter, entries, pageSize = 50 }: AlarmHistoryListProps) {
  const i18n = useI18n();
  const { backend } = useHmi();
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const filterKey = JSON.stringify(filter ?? {});
  const key = `${fromMs}|${toMs}|${filterKey}`;
  const [load, setLoad] = useState<Load>({ key, status: "loading" });
  const [localPage, setLocalPage] = useState(0);
  const [exporting, setExporting] = useState<"idle" | "busy" | "failed">("idle");
  const reader = useRef<AlarmJournalReader | null>(null);
  const section = useRef<HTMLElement>(null);

  // One row past the page, so "Next" knows whether there is anything to go to.
  useEffect(() => {
    if (entries || !backend) return;
    const current = createAlarmJournalReader(backend, { from: new Date(fromMs), to: new Date(toMs) }, JSON.parse(filterKey) as AlarmFilter);
    reader.current = current;
    current.readUntil(pageSize + 1).then(
      ({ rows, done }) => reader.current === current && setLoad({ key, status: "ready", rows, done, page: 0, turning: false, failed: false }),
      () => reader.current === current && setLoad({ key, status: "error" }),
    );
    return () => {
      reader.current = null;
      current.cancel();
    };
  }, [backend, fromMs, toMs, filterKey, key, entries, pageSize]);

  // Given rows are all there is; otherwise whatever belongs to an older query counts as not read yet.
  const shown: Load = entries
    ? { key, status: "ready", rows: entries, done: true, page: Math.min(localPage, Math.max(0, Math.ceil(entries.length / pageSize) - 1)), turning: false, failed: false }
    : load.key === key
      ? load
      : { key, status: "loading" };
  const rows = shown.status === "ready" ? shown.rows : [];
  const page = shown.status === "ready" ? shown.page : 0;
  const start = page * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const hasNext = rows.length > start + pageSize;
  const turning = shown.status === "ready" && shown.turning;

  const goTo = (target: number) => {
    const current = reader.current;
    section.current?.scrollIntoView?.({ block: "nearest" });
    if (entries) return setLocalPage(target);
    if (!current) return undefined;
    setLoad((l) => (l.status === "ready" ? { ...l, turning: true, failed: false } : l));
    current.readUntil((target + 1) * pageSize + 1).then(
      ({ rows: read, done }) => reader.current === current && setLoad({ key, status: "ready", rows: read, done, page: target, turning: false, failed: false }),
      () => reader.current === current && setLoad((l) => (l.status === "ready" ? { ...l, turning: false, failed: true } : l)),
    );
    return undefined;
  };

  // The whole range, read fresh: only part of it may have been read to show it.
  const exportCsv = async () => {
    setExporting("busy");
    try {
      const all = entries ?? (backend ? await loadAlarmHistory(backend, { from: new Date(fromMs), to: new Date(toMs) }, JSON.parse(filterKey) as AlarmFilter) : []);
      const blob = new Blob([journalToCsv(i18n, all)], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `alarm-history-${from.toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setExporting("idle");
    } catch {
      setExporting("failed");
    }
  };

  return (
    <section ref={section} className="kh-alarms" aria-label={i18n.t("alarmHistory.label")} aria-busy={shown.status === "loading" || turning}>
      <div className="kh-alarms-bar">
        <span className="kh-alarms-range">
          {i18n.formatDateTime(from, STAMP)} – {i18n.formatDateTime(to, STAMP)}
        </span>
        {shown.status === "ready" && <span className="kh-alarms-count">{i18n.t(shown.done ? "alarmHistory.count" : "alarmHistory.countSoFar", { count: rows.length })}</span>}
        <button type="button" className="kh-btn" disabled={rows.length === 0 || exporting === "busy"} onClick={() => void exportCsv()}>
          {i18n.t(exporting === "busy" ? "alarmHistory.exporting" : "alarmHistory.export")}
        </button>
      </div>
      {shown.status === "loading" && <p className="kh-empty">{i18n.t("alarmHistory.loading")}</p>}
      {shown.status === "error" && <p className="kh-empty">{i18n.t("alarmHistory.failed")}</p>}
      {exporting === "failed" && <p className="kh-empty">{i18n.t("alarmHistory.exportFailed")}</p>}
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
              {pageRows.map((e, i) => (
                <tr key={`${e.origin}:${e.instanceId}:${e.kind}:${e.timestamp.getTime()}:${start + i}`}>
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
      {shown.status === "ready" && shown.failed && <p className="kh-empty">{i18n.t("alarmHistory.failed")}</p>}
      {(page > 0 || hasNext) && (
        <nav className="kh-alarms-foot" aria-label={i18n.t("alarmHistory.pages")}>
          <span className="kh-num">{i18n.t("alarmHistory.range", { from: start + 1, to: start + pageRows.length })}</span>
          <span className="kh-alarms-pager">
            <button type="button" className="kh-btn kh-btn--sm" disabled={page === 0 || turning} onClick={() => goTo(0)}>
              {i18n.t("alarmHistory.first")}
            </button>
            <button type="button" className="kh-btn kh-btn--sm" disabled={page === 0 || turning} onClick={() => goTo(page - 1)}>
              {i18n.t("alarmHistory.previous")}
            </button>
            <button type="button" className="kh-btn kh-btn--sm" disabled={!hasNext || turning} onClick={() => goTo(page + 1)}>
              {i18n.t("alarmHistory.next")}
            </button>
          </span>
        </nav>
      )}
    </section>
  );
}
