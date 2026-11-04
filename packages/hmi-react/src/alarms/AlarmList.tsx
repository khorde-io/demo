/**
 * The live active-alarm list (ISA-18.2): newest or most urgent first, as the
 * operator chooses, filter by area, priority and text, acknowledge one or all
 * visible. Unacknowledged rows are
 * bold and their indicator flashes. The list comes from the alarm store, which
 * applies the active-alarm rule to the subscription.
 *
 * It's read by a person, so even in a flood it draws one page, and "all
 * visible" means the rows on that page: an acknowledgement says someone saw it.
 */

import "./alarms.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { filterAlarms, sortAlarms, type Alarm, type AlarmOrder, type AlarmPriority } from "@khorde/hmi-core";
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
  /** Rows on a page. */
  pageSize?: number;
  /** The order it opens in; the operator can change it. */
  defaultOrder?: AlarmOrder;
}

const PRIORITIES: AlarmPriority[] = [1, 2, 3];
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };

/** How long a parked pointer holds the rows, so a list left under it doesn't stay frozen. */
const HOLD_IDLE_MS = 20_000;
const ORDERS: { id: AlarmOrder; label: string }[] = [
  { id: "newest", label: "alarmList.sortNewest" },
  { id: "urgent", label: "alarmList.sortUrgent" },
];

/** The rows being held still: what was on the page when the operator came to it. */
interface Hold {
  /** The page and filters they belong to; changing either takes a new hold. */
  key: string;
  rows: readonly Alarm[];
  newestAt: number;
}

export function AlarmList({ areas = [], selectedId = null, onSelect, alarms, onAck, canAck, pageSize = 20, defaultOrder = "newest" }: AlarmListProps) {
  const i18n = useI18n();
  const hmi = useHmi();
  const snapshot = useAlarms();
  const list = alarms ?? snapshot.alarms;
  const [area, setArea] = useState<number | null>(null);
  const [priorities, setPriorities] = useState<ReadonlySet<AlarmPriority>>(new Set(PRIORITIES));
  const [text, setText] = useState("");
  const [order, setOrder] = useState<AlarmOrder>(defaultOrder);
  const [wantedPage, setPage] = useState(0);
  const [hold, setHold] = useState<Hold | null>(null);
  const using = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mayAck = canAck ?? hmi.auth?.can("ackAlarm") ?? Boolean(onAck);
  const ack = (ids: string[]) => {
    if (ids.length === 0) return;
    if (onAck) onAck(ids);
    else void hmi.alarms?.ackMany(ids);
  };

  const visible = useMemo(() => {
    const matching = filterAlarms(list, {
      areas: area === null ? [] : (areas[area]?.patterns ?? []),
      priorities: [...priorities],
      text,
      textOf: (a) => `${i18n.alarmText(a)} ${i18n.equipmentName(a.area)}`,
    });
    return order === "newest" ? matching : sortAlarms(matching, order);
  }, [list, area, areas, priorities, text, i18n, order]);

  const lastPage = Math.max(0, Math.ceil(visible.length / pageSize) - 1);
  const page = Math.min(wantedPage, lastPage);
  const from = page * pageSize;
  const key = `${page}|${area}|${[...priorities].join()}|${text}|${order}`;
  const live = useMemo(() => visible.slice(from, from + pageSize), [visible, from, pageSize]);

  // While the operator uses the list, new alarms don't move the rows under the
  // pointer, so an Ack lands on the alarm they were looking at. The rows still
  // show their latest state. The banner and the counts stay live meanwhile.
  const held = hold?.key === key ? hold : null;
  const current = useMemo(() => (held ? new Map(visible.map((a) => [a.instanceId, a])) : null), [held, visible]);
  const rows = held && current ? held.rows.map((a) => ({ alarm: current.get(a.instanceId) ?? a, gone: !current.has(a.instanceId) })) : live.map((alarm) => ({ alarm, gone: false }));
  const unackedRows = rows.filter((r) => !r.gone && !r.alarm.acked).map((r) => r.alarm.instanceId);
  const newWhileHeld = held ? visible.filter((a) => a.stateAt.getTime() > held.newestAt).length : 0;

  const release = () => {
    using.current = false;
    if (idle.current) clearTimeout(idle.current);
    setHold(null);
  };
  const use = () => {
    using.current = true;
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(release, HOLD_IDLE_MS);
    setHold((h) => (h?.key === key ? h : { key, rows: live, newestAt: visible.reduce((t, a) => Math.max(t, a.stateAt.getTime()), 0) }));
  };
  // Another page or filter while in use: hold what it shows now.
  useEffect(() => {
    if (using.current) use();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the page or filters change
  }, [key]);
  useEffect(
    () => () => {
      if (idle.current) clearTimeout(idle.current);
    },
    [],
  );

  /** A new filter or order starts from the first page. */
  const pick = (change: () => void) => {
    setPage(0);
    change();
  };
  const togglePriority = (p: AlarmPriority) =>
    setPriorities((cur) => {
      const next = new Set(cur);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  return (
    <section
      className="kh-alarms"
      aria-label={i18n.t("alarmList.label")}
      onPointerEnter={use}
      onPointerMove={use}
      onPointerDown={use}
      onKeyDown={use}
      onFocus={(e) => {
        if (e.target.matches(":focus-visible")) use();
      }}
      onPointerLeave={(e) => {
        if (!e.currentTarget.querySelector(":focus-visible")) release();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && !e.currentTarget.matches(":hover")) release();
      }}
    >
      <div className="kh-alarms-bar">
        {areas.length > 0 && (
          <div className="kh-seg" role="group" aria-label={i18n.t("alarmList.area")}>
            <button type="button" aria-pressed={area === null} onClick={() => pick(() => setArea(null))}>
              {i18n.t("alarmList.allAreas")}
            </button>
            {areas.map((a, i) => (
              <button key={a.label} type="button" aria-pressed={area === i} onClick={() => pick(() => setArea(i))}>
                {a.label}
              </button>
            ))}
          </div>
        )}
        <div className="kh-seg" role="group" aria-label={i18n.t("alarmList.priority")}>
          {PRIORITIES.map((p) => (
            <button key={p} type="button" aria-pressed={priorities.has(p)} onClick={() => pick(() => togglePriority(p))}>
              <svg width={16} height={16} viewBox="0 0 20 20" aria-hidden="true">
                <AlarmShape priority={p} />
              </svg>
              P{p}
            </button>
          ))}
        </div>
        <div className="kh-seg" role="group" aria-label={i18n.t("alarmList.sort")}>
          {ORDERS.map((o) => (
            <button key={o.id} type="button" aria-pressed={order === o.id} onClick={() => pick(() => setOrder(o.id))}>
              {i18n.t(o.label)}
            </button>
          ))}
        </div>
        <label className="kh-alarms-filter">
          <span>{i18n.t("alarmList.filter")}</span>
          <input type="search" value={text} placeholder={i18n.t("alarmList.filterPlaceholder")} onChange={(e) => pick(() => setText(e.target.value))} />
        </label>
        {mayAck && (
          <button type="button" className="kh-btn" disabled={unackedRows.length === 0} onClick={() => ack(unackedRows)}>
            {i18n.t("alarmList.ackVisible", { count: unackedRows.length })}
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
            {rows.map(({ alarm: a, gone }) => (
              <tr
                key={a.instanceId}
                className={[gone ? "kh-row--gone" : !a.acked ? "kh-row--unacked" : "", a.instanceId === selectedId ? "kh-row--selected" : ""].join(" ")}
                {...(a.instanceId === selectedId ? { "aria-selected": true } : {})}
              >
                <td className="kh-col-priority">
                  {!gone && <AlarmIndicator priority={a.priority} indication={alarmIndication(a)} />}
                </td>
                <td className="kh-num">{i18n.formatDateTime(a.stateAt, TIME)}</td>
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
                <td>
                  {gone ? i18n.t("alarmList.gone") : i18n.t(`alarm.state.${a.state}`)}
                  {!gone && !a.originOnline && ` · ${i18n.t("alarm.lastKnown")}`}
                </td>
                <td>
                  {gone
                    ? ""
                    : a.ackPending
                    ? i18n.t("alarmList.ackPending", { actor: a.ackedBy ?? "" })
                    : a.acked
                      ? a.ackedBy
                        ? i18n.t("alarmList.ackedBy", { actor: a.ackedBy, time: a.ackedAt ? i18n.formatDateTime(a.ackedAt, TIME) : "" })
                        : i18n.t("alarmList.ackedNoActor", { time: a.ackedAt ? i18n.formatDateTime(a.ackedAt, TIME) : "" })
                      : i18n.t("alarmList.notAcked")}
                </td>
                <td className="kh-col-action">
                  {mayAck && !gone && !a.acked && (
                    <button type="button" className="kh-btn kh-btn--sm" onClick={() => ack([a.instanceId])}>
                      {i18n.t("alarmList.ack")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <p className="kh-empty">{i18n.t(list.length > 0 ? "alarmList.empty" : alarms || snapshot.loaded ? "alarmList.none" : snapshot.error ? "alarmList.failed" : "alarmList.loading")}</p>}
      </div>
      <div className="kh-alarms-foot">
        <span>
          {i18n.t("alarmList.summary", { total: list.length, unacked: alarms ? list.filter((a) => !a.acked).length : snapshot.counts.unacked })}
          {newWhileHeld > 0 && ` · ${i18n.t("alarmList.held", { count: newWhileHeld })}`}
        </span>
        {visible.length > pageSize && (
          <nav className="kh-alarms-pager" aria-label={i18n.t("alarmList.pages")}>
            <span className="kh-num">{i18n.t("alarmList.range", { from: from + 1, to: Math.min(from + pageSize, visible.length), total: visible.length })}</span>
            <button type="button" className="kh-btn kh-btn--sm" disabled={page === 0} onClick={() => setPage(0)}>
              {i18n.t("alarmList.first")}
            </button>
            <button type="button" className="kh-btn kh-btn--sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              {i18n.t("alarmList.previous")}
            </button>
            <button type="button" className="kh-btn kh-btn--sm" disabled={page === lastPage} onClick={() => setPage(page + 1)}>
              {i18n.t("alarmList.next")}
            </button>
          </nav>
        )}
      </div>
    </section>
  );
}
