/**
 * The field side between the plant model and the agents: what RTUs and IEDs
 * do with the values. Without it, every point would change at the same instant
 * with the same timestamp, which no real plant does.
 *
 * - Analog points are scanned, each on its own period with a random phase,
 *   and reported when they move beyond a deadband.
 * - Discrete points report a change as an event, after a short random
 *   detection delay.
 * - Every point is sent again on its own integrity period, also phased.
 * - Each report carries the time it was acquired, not the time of the batch.
 *
 * `poll(now)` is called often (every 100 ms or so) with the model's current
 * values and returns what is due by then.
 */

import type { Sample } from "./model.ts";

export interface Report {
  addr: string;
  value: number;
  quality: boolean;
  /** Epoch milliseconds the value was acquired. */
  at: number;
}

export interface FieldOptions {
  /** Random source in [0, 1). */
  random?: () => number;
  /** Relative deadband for analog values (absolute minimum 0.01). */
  deadband?: number;
  /** Integrity period range, ms. */
  integrityMs?: [number, number];
  /** Delay from a discrete change to its report, ms. */
  eventDelayMs?: [number, number];
}

export interface Field {
  /** Reports due at `now`, oldest first. */
  poll(samples: readonly Sample[], now: number): Report[];
}

/** Scan period range by point name, ms. Electrical values are scanned fastest, temperatures slowest. */
export function scanRange(addr: string): [number, number] {
  const name = addr.slice(addr.lastIndexOf(".") + 1);
  if (/temp$/.test(name)) return [5_000, 10_000];
  if (/^(p_mw|q_mvar|i_a|v_kv|f_hz)$/.test(name)) return [800, 1_600];
  return [2_000, 4_000];
}

interface PointState {
  scanMs: number;
  integrityMs: number;
  nextScan: number;
  nextIntegrity: number;
  /** Last reported. */
  sent: { value: number; quality: boolean } | null;
  /** A discrete change waiting for its report time. */
  pending: { value: number; quality: boolean; at: number } | null;
}

export function createField(options: FieldOptions = {}): Field {
  const random = options.random ?? Math.random;
  const deadband = options.deadband ?? 0.002;
  const [intMin, intMax] = options.integrityMs ?? [30_000, 60_000];
  const [evMin, evMax] = options.eventDelayMs ?? [20, 400];
  const between = (lo: number, hi: number) => lo + random() * (hi - lo);
  const points = new Map<string, PointState>();

  const moved = (prev: { value: number; quality: boolean }, s: Sample) =>
    prev.quality !== s.quality || Math.abs(s.value - prev.value) > Math.max(Math.abs(prev.value) * deadband, 0.01);

  return {
    poll(samples, now) {
      const out: Report[] = [];
      for (const s of samples) {
        let p = points.get(s.addr);
        if (!p) {
          // First sight: report at a random moment within the first scan, so a start-up is spread too.
          const scanMs = between(...scanRange(s.addr));
          const integrityMs = between(intMin, intMax);
          p = { scanMs, integrityMs, nextScan: now + random() * scanMs, nextIntegrity: now + random() * integrityMs, sent: null, pending: null };
          points.set(s.addr, p);
        }
        const report = (at: number) => {
          out.push({ addr: s.addr, value: s.value, quality: s.quality, at: Math.round(at) });
          p.sent = { value: s.value, quality: s.quality };
          p.nextIntegrity = Math.max(p.nextIntegrity, at + p.integrityMs);
        };

        if (s.type === "discrete") {
          const changed = !p.sent || p.sent.value !== s.value || p.sent.quality !== s.quality;
          if (changed && (!p.pending || p.pending.value !== s.value || p.pending.quality !== s.quality)) {
            p.pending = { value: s.value, quality: s.quality, at: now + between(evMin, evMax) };
          }
          if (!changed) p.pending = null;
          if (p.pending && p.pending.at <= now) {
            report(p.pending.at);
            p.pending = null;
          } else if (!p.pending && now >= p.nextIntegrity) {
            report(now);
          }
          continue;
        }

        // Analog: act on scan times only; catch up at most one scan per poll.
        if (now < p.nextScan) continue;
        const at = p.nextScan;
        p.nextScan = at + p.scanMs;
        if (p.nextScan <= now) p.nextScan = now + p.scanMs * random();
        if (!p.sent || moved(p.sent, s) || at >= p.nextIntegrity) report(at);
      }
      return out.sort((a, b) => a.at - b.at);
    },
  };
}
