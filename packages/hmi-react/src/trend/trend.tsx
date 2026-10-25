/**
 * Trends. ISA-101: series are grey and told apart by dash pattern and label,
 * not colour; limits are dashed lines; a gap in the data (bad quality, no
 * samples) is a gap in the line. `useTrend` fills a chart from history and
 * keeps it moving with live values.
 */

import "./trend.css";
import { useEffect, useRef, useState } from "react";
import { pointPath, type MeasurementType, type PointId } from "@khorde/hmi-core";
import { useHmi, useI18n } from "../context.tsx";

export interface TrendSeries {
  id: string;
  label: string;
  /** Epoch ms, ascending. */
  t: readonly number[];
  /** null is a gap. */
  v: readonly (number | null)[];
}

/** Rounds a range out to "nice" ticks (1, 2, 5 × 10ⁿ). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Polyline point lists, split at gaps and at samples outside [from, to]. */
export function segments(s: TrendSeries, x: (t: number) => number, y: (v: number) => number, from: number, to: number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  s.t.forEach((t, i) => {
    const v = s.v[i];
    if (v === null || v === undefined || t < from || t > to) {
      if (cur.length) out.push(cur.join(" "));
      cur = [];
      return;
    }
    cur.push(`${x(t).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) out.push(cur.join(" "));
  return out;
}

export interface SparklineProps {
  values: readonly (number | null)[];
  width?: number;
  height?: number;
  label: string;
}

export function Sparkline({ values, width = 120, height = 28, label }: SparklineProps) {
  const nums = values.filter((v): v is number => v !== null);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2);
  const y = (v: number) => (hi === lo ? height / 2 : height - 3 - ((v - lo) / (hi - lo)) * (height - 6));
  const series: TrendSeries = { id: "s", label, t: values.map((_, i) => i), v: values };
  const last = [...values].reverse().findIndex((v) => v !== null);
  const lastIdx = last < 0 ? -1 : n - 1 - last;
  return (
    <svg className="kh-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {nums.length > 0 &&
        segments(series, x, y, 0, n).map((pts, i) => <polyline key={i} className="kh-spark-line" points={pts} />)}
      {lastIdx >= 0 && <circle className="kh-spark-dot" cx={x(lastIdx)} cy={y(values[lastIdx] as number)} r={2.5} />}
    </svg>
  );
}

export interface TrendChartProps {
  series: readonly TrendSeries[];
  from: number;
  to: number;
  /** Fixed y range; otherwise fitted to the data and the limits. */
  min?: number;
  max?: number;
  unit?: string;
  limits?: readonly { value: number; label: string }[];
  width?: number;
  height?: number;
  label: string;
  /** Shown instead of the lines (loading, no data, failed). */
  message?: string | null;
}

const PAD = { left: 52, right: 16, top: 12, bottom: 28 };
const DASH = ["", "8 5", "2 4", "12 4 2 4"];

export function TrendChart({ series, from, to, min, max, unit, limits = [], width = 720, height = 260, label, message }: TrendChartProps) {
  const i18n = useI18n();
  const all = series.flatMap((s) => s.v.filter((v, i): v is number => v !== null && (s.t[i] ?? 0) >= from && (s.t[i] ?? 0) <= to));
  const lims = limits.map((l) => l.value);
  let lo = min ?? Math.min(...all, ...lims);
  let hi = max ?? Math.max(...all, ...lims);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1];
  if (hi === lo) [lo, hi] = [lo - 1, hi + 1];
  const yTicks = niceTicks(lo, hi);
  lo = Math.min(lo, yTicks[0] ?? lo);
  hi = Math.max(hi, yTicks.at(-1) ?? hi);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - from) / (to - from || 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  const span = to - from;
  const stepMs = [60e3, 5 * 60e3, 15 * 60e3, 30 * 60e3, 3600e3, 3 * 3600e3, 6 * 3600e3, 24 * 3600e3].find((s) => span / s <= 7) ?? 24 * 3600e3;
  const xTicks: number[] = [];
  for (let t = Math.ceil(from / stepMs) * stepMs; t <= to; t += stepMs) xTicks.push(t);
  const timeFmt: Intl.DateTimeFormatOptions = stepMs >= 24 * 3600e3 ? { day: "2-digit", month: "short" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

  return (
    <figure className="kh-trend">
      <svg className="kh-trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
        {yTicks.map((v) => (
          <g key={v}>
            <line className="kh-trend-grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="kh-trend-tick" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
              {i18n.formatNumber(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} className="kh-trend-tick" x={x(t)} y={height - 8} textAnchor="middle">
            {i18n.formatDateTime(new Date(t), timeFmt)}
          </text>
        ))}
        {unit && (
          <text className="kh-trend-tick" x={8} y={PAD.top + 4}>
            {unit}
          </text>
        )}
        {limits.map((l) => (
          <g key={`${l.label}-${l.value}`}>
            <line className="kh-trend-limit" x1={PAD.left} x2={width - PAD.right} y1={y(l.value)} y2={y(l.value)} />
            <text className="kh-trend-limit-t" x={width - PAD.right - 4} y={y(l.value) - 4} textAnchor="end">
              {l.label}
            </text>
          </g>
        ))}
        {!message &&
          series.map((s, i) =>
            segments(s, x, y, from, to).map((pts, j) => <polyline key={`${s.id}-${j}`} className="kh-trend-line" points={pts} strokeDasharray={DASH[i % DASH.length] || undefined} />),
          )}
        {message && (
          <text className="kh-trend-msg" x={PAD.left + plotW / 2} y={PAD.top + plotH / 2} textAnchor="middle">
            {message}
          </text>
        )}
      </svg>
      {series.length > 1 && (
        <figcaption className="kh-trend-legend">
          {series.map((s, i) => (
            <span key={s.id}>
              <svg width={28} height={10} aria-hidden="true">
                <line className="kh-trend-line" x1={0} x2={28} y1={5} y2={5} strokeDasharray={DASH[i % DASH.length] || undefined} />
              </svg>
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

export interface TrendState {
  series: TrendSeries[];
  from: number;
  to: number;
  status: "loading" | "ready" | "error";
}

/**
 * History for the last `windowMs`, then extended with live values while
 * mounted. Labels come from `label(id)`.
 */
export function useTrend(ids: readonly PointId[], type: MeasurementType, windowMs: number, label: (id: PointId) => string): TrendState {
  const { history, points } = useHmi();
  const key = [...ids].sort().join("|");
  const [state, setState] = useState<TrendState>(() => ({ series: [], from: Date.now() - windowMs, to: Date.now(), status: "loading" }));
  // The label function is read when history arrives; a new function must not restart the query.
  const labelOf = useRef(label);
  useEffect(() => {
    labelOf.current = label;
  });

  useEffect(() => {
    if (!history || key === "") return;
    let alive = true;
    const list = key.split("|") as PointId[];
    const to = Date.now();
    const from = to - windowMs;
    Promise.all(list.map((id) => history.series({ type, path: pointPath(id), from: new Date(from), to: new Date(to), maxPoints: 600 }))).then(
      (maps) => {
        if (!alive) return;
        const series = list.map((id, i) => {
          const s = maps[i]?.get(id);
          return { id, label: labelOf.current(id), t: s?.t ?? [], v: s?.v ?? [] };
        });
        setState({ series, from, to, status: "ready" });
      },
      () => alive && setState((s) => ({ ...s, status: "error" })),
    );
    return () => {
      alive = false;
    };
  }, [history, key, type, windowMs]);

  useEffect(() => {
    if (!points || key === "") return;
    const list = key.split("|") as PointId[];
    const stop = points.watch(list);
    const offs = list.map((id) =>
      points.subscribe(id, () => {
        const p = points.get(id);
        if (p.timestamp === null) return;
        const t = p.timestamp.getTime();
        const v = p.quality === "good" && typeof p.value === "number" ? p.value : null;
        setState((s) => {
          if (s.status !== "ready") return s;
          const to = Math.max(s.to, t);
          const from = to - windowMs;
          const series = s.series.map((ser) => {
            if (ser.id !== id || (ser.t.at(-1) ?? -Infinity) >= t) return ser;
            const keep = ser.t.findIndex((x) => x >= from);
            const start = keep < 0 ? ser.t.length : keep;
            return { ...ser, t: [...ser.t.slice(start), t], v: [...ser.v.slice(start), v] };
          });
          return { ...s, series, from, to };
        });
      }),
    );
    return () => {
      stop();
      for (const off of offs) off();
    };
  }, [points, key, windowMs]);

  return state;
}
