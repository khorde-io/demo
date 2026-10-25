/**
 * History for trends. The API has no pagination or server-side downsampling,
 * so long ranges are split into chunks, merged, and reduced to a size a chart
 * can draw without losing peaks.
 */

import type { ScadaBackend } from "./backend.ts";
import type { Measurement, MeasurementType, PointId } from "./model.ts";

export interface Series {
  id: PointId;
  /** Epoch milliseconds, ascending. */
  t: number[];
  /** null marks a gap (bad quality or a non-numeric value). */
  v: (number | null)[];
}

export interface HistoryOptions {
  /** Longest time range per request. */
  chunkMs?: number;
  /** Requests in flight at once. */
  concurrency?: number;
}

export interface SeriesQuery {
  type: MeasurementType;
  /** `equipment.name`, wildcards allowed. */
  path: string;
  from: Date;
  to: Date;
  /** Reduce each series to about this many points. */
  maxPoints?: number;
}

export interface HistoryService {
  fetch(type: MeasurementType, path: string, from: Date, to: Date): Promise<Measurement[]>;
  series(query: SeriesQuery): Promise<Map<PointId, Series>>;
}

/** Splits [from, to) into consecutive windows of at most `chunkMs`. */
export function chunkRange(from: Date, to: Date, chunkMs: number): [Date, Date][] {
  const out: [Date, Date][] = [];
  for (let t = from.getTime(); t < to.getTime(); t += chunkMs) {
    out.push([new Date(t), new Date(Math.min(t + chunkMs, to.getTime()))]);
  }
  return out;
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

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

export function createHistoryService(backend: ScadaBackend, options: HistoryOptions = {}): HistoryService {
  const chunkMs = options.chunkMs ?? 6 * 60 * 60 * 1000;
  const concurrency = options.concurrency ?? 2;

  const fetch = async (type: MeasurementType, path: string, from: Date, to: Date) => {
    const chunks = chunkRange(from, to, chunkMs);
    const parts = await mapLimit(chunks, concurrency, ([f, t]) => backend.history(type, { path, from: f, to: t }));
    // Windows share their edges; drop duplicates at the seams.
    const seen = new Set<string>();
    return parts.flat().filter((m) => {
      const k = `${m.id}@${m.timestamp.getTime()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  return {
    fetch,
    async series(q) {
      const all = toSeries(await fetch(q.type, q.path, q.from, q.to));
      if (!q.maxPoints) return all;
      return new Map([...all].map(([id, s]) => [id, downsample(s, q.maxPoints as number)] as const));
    },
  };
}
