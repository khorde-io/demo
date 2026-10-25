/**
 * Points and a generator for end-to-end performance runs: REST agent → hub →
 * GraphQL subscription → screen. The points live on the wind farm agent (no
 * extra agent or key needed) under `perf.pNNNN::v`, and only in the perf
 * variant of the agent config (`site-config/vds-agents.perf.yaml`), so the
 * normal plant is not affected.
 *
 * The generator gives each point its own phase in the period, like field
 * devices, and stamps each value with the moment it was produced, so the
 * HMI can measure the latency to the screen.
 */

import { AGENTS, driverPath, type PointDef } from "./plant.ts";
import type { Report } from "./sim/field.ts";

export const PERF_AGENT = AGENTS.windfarm;
/** How many perf points the perf config holds. */
export const PERF_POINTS = 2000;

export const perfEquipment = (i: number) => `perf.p${String(i).padStart(4, "0")}`;

export function perfPoints(count = PERF_POINTS): PointDef[] {
  return Array.from({ length: count }, (_, i) => ({
    agent: PERF_AGENT,
    equipment: perfEquipment(i),
    name: "v",
    type: "analogical" as const,
    // Live path only: a run would otherwise write thousands of rows a second into history.
    store: false,
    tags: ["perf"],
    initial: 50,
  }));
}

export interface PerfRun {
  points: number;
  hz: number;
  startedAt: number;
  sent: number;
}

export interface PerfGenerator {
  start(points: number, hz: number): PerfRun;
  stop(): PerfRun | null;
  status(): PerfRun | null;
  /** Produces what is due by `now`; called every few ms while running. */
  tick(now: number): Report[];
}

export function createPerfGenerator(options: { max?: number; random?: () => number; now?: () => number } = {}): PerfGenerator {
  const max = options.max ?? PERF_POINTS;
  const random = options.random ?? Math.random;
  const clock = options.now ?? Date.now;
  let run: (PerfRun & { phase: number[]; level: number[]; last: number }) | null = null;

  const summary = (): PerfRun | null => (run ? { points: run.points, hz: run.hz, startedAt: run.startedAt, sent: run.sent } : null);

  return {
    start(points, hz) {
      if (!Number.isInteger(points) || points < 1 || points > max) throw new Error(`points must be an integer from 1 to ${max}`);
      if (!(hz > 0 && hz <= 10)) throw new Error("hz must be above 0 and at most 10");
      const period = 1000 / hz;
      const now = clock();
      run = {
        points,
        hz,
        startedAt: now,
        sent: 0,
        last: now,
        phase: Array.from({ length: points }, () => random() * period),
        level: Array.from({ length: points }, () => 20 + random() * 60),
      };
      return summary() as PerfRun;
    },
    stop() {
      const s = summary();
      run = null;
      return s;
    },
    status: summary,
    tick(now) {
      if (!run) return [];
      const r = run;
      const period = 1000 / r.hz;
      const out: Report[] = [];
      for (let i = 0; i < r.points; i++) {
        const p = r.phase[i] as number;
        // Due when one of this point's phase moments fell in (last, now].
        const k = Math.floor((now - r.startedAt - p) / period);
        if (k <= Math.floor((r.last - r.startedAt - p) / period)) continue;
        const at = r.startedAt + p + k * period;
        const level = Math.max(0, Math.min(100, (r.level[i] as number) + (random() - 0.5) * 4));
        r.level[i] = level;
        out.push({ addr: driverPath(perfEquipment(i), "v"), value: Number(level.toFixed(1)), quality: true, at: Math.round(at) });
      }
      r.last = now;
      r.sent += out.length;
      return out;
    },
  };
}
