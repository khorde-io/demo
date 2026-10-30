/**
 * History for trends. The API serves history in pages; this follows them, newest
 * first, and reduces each series to a size a chart can draw without losing
 * peaks (there is no server-side downsampling).
 */

import type { ScadaBackend } from "./backend.ts";
import { collectPages } from "./pages.ts";
import type { Measurement, MeasurementType, PointId } from "./model.ts";

export interface Series {
  id: PointId;
  /** Epoch milliseconds, ascending. */
  t: number[];
  /** null marks a gap (bad quality or a non-numeric value). */
  v: (number | null)[];
}

export interface HistoryOptions {
  /** Rows per request, up to the API's 10,000. */
  pageSize?: number;
  /** Stop after this many rows. Pages come newest first, so the oldest are dropped. */
  maxRows?: number;
}

export interface SeriesQuery {
  type: MeasurementType;
  /** `equipment.name` paths, wildcards allowed. One request covers them all. */
  paths: readonly string[];
  from: Date;
  to: Date;
  /** Reduce each series to about this many points. */
  maxPoints?: number;
}

export interface HistoryService {
  /** Every row in the range for the paths, newest first, up to `maxRows`. */
  fetch(type: MeasurementType, paths: readonly string[], from: Date, to: Date): Promise<Measurement[]>;
  series(query: SeriesQuery): Promise<Map<PointId, Series>>;
}

function numeric(m: Measurement): number | null {
  if (m.quality !== "good") return null;
  if (typeof m.value === "number") return Number.isFinite(m.value) ? m.value : null;
  if (typeof m.value === "boolean") return m.value ? 1 : 0;
  return null;
}

export function toSeries(measurements: readonly Measurement[]): Map<PointId, Series> {
  const out = new Map<PointId, Series>();
  const sorted = [...measurements].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  for (const m of sorted) {
    let s = out.get(m.id);
    if (!s) out.set(m.id, (s = { id: m.id, t: [], v: [] }));
    s.t.push(m.timestamp.getTime());
    s.v.push(numeric(m));
  }
  return out;
}

/**
 * Min/max downsampling: keeps the lowest and highest sample of each bucket, in
 * time order, so spikes survive. Gaps (null) are kept so charts break the line.
 */
export function downsample(series: Series, maxPoints: number): Series {
  const n = series.t.length;
  if (n <= maxPoints || maxPoints < 4) return series;
  const buckets = Math.floor(maxPoints / 2);
  const size = n / buckets;
  const t: number[] = [];
  const v: (number | null)[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size);
    const end = Math.min(n, Math.floor((b + 1) * size));
    let lo = -1;
    let hi = -1;
    let gap = -1;
    for (let i = start; i < end; i++) {
      const x = series.v[i];
      if (x === null || x === undefined) {
        if (gap < 0) gap = i;
        continue;
      }
      if (lo < 0 || x < (series.v[lo] as number)) lo = i;
      if (hi < 0 || x > (series.v[hi] as number)) hi = i;
    }
    const keep = [...new Set([lo, hi, gap].filter((i) => i >= 0))].sort((a, z) => a - z);
    for (const i of keep) {
      t.push(series.t[i] as number);
      v.push(series.v[i] ?? null);
    }
  }
  return { id: series.id, t, v };
}

export function createHistoryService(backend: ScadaBackend, options: HistoryOptions = {}): HistoryService {
  const pageSize = options.pageSize ?? 5_000;
  const maxRows = options.maxRows ?? 200_000;

  const fetch = (type: MeasurementType, paths: readonly string[], from: Date, to: Date) =>
    collectPages((page) => backend.history(type, { paths, from, to, order: "desc", ...page }), { pageSize, maxRows });

  return {
    fetch,
    async series(q) {
      const all = toSeries(await fetch(q.type, q.paths, q.from, q.to));
      if (!q.maxPoints) return all;
      return new Map([...all].map(([id, s]) => [id, downsample(s, q.maxPoints as number)] as const));
    },
  };
}
