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
 *
 * A run can also load the alarm path: digital alarms on `perfalarm.aNNNN::v`,
 * each raised and returned in turn. They sit outside `perf.>`, so they don't
 * add to the values a value run watches. Nobody acknowledges them during a
 * run, as in a real alarm flood, so the active list keeps growing. Stopping
 * returns every raised alarm to normal (see `drain`).
 */

import { AGENTS, driverPath, type AlarmDef, type PointDef } from "./plant.ts";
import type { Report } from "./sim/field.ts";

export type { Report };

export const PERF_AGENT = AGENTS.windfarm;
/** How many perf points the perf config holds. */
export const PERF_POINTS = 2000;

export const perfEquipment = (i: number) => `perf.p${String(i).padStart(4, "0")}`;

/** How many perf alarms the perf config holds. */
export const PERF_ALARMS = 500;
/** How long a perf alarm stays in each state, so each makes one change per period. */
export const PERF_ALARM_PERIOD_MS = 2000;

export const perfAlarmEquipment = (i: number) => `perfalarm.a${String(i).padStart(4, "0")}`;
/** A mix of priorities, like a real flood: P1, P2, P3 in turn. */
export const perfAlarmSeverity = (i: number) => (["high", "medium", "low"] as const)[i % 3] as "high" | "medium" | "low";

export function perfAlarmPoints(count = PERF_ALARMS): PointDef[] {
  return Array.from({ length: count }, (_, i) => ({
    agent: PERF_AGENT,
    equipment: perfAlarmEquipment(i),
    name: "v",
    type: "discrete" as const,
    store: false,
    tags: ["perf"],
    initial: 0,
  }));
}

export function perfAlarms(count = PERF_ALARMS): AlarmDef[] {
  return Array.from({ length: count }, (_, i) => {
    const equipment = perfAlarmEquipment(i);
    return {
      agent: PERF_AGENT,
      config: { type: "digital", name: `perf_a${String(i).padStart(4, "0")}`, area: equipment, meas: `${equipment}::v`, set: 1, reset: 0, severity: perfAlarmSeverity(i) },
    };
  });
}

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
  alarms: number;
  startedAt: number;
  sent: number;
  /** Alarm raises and returns sent. */
  alarmChanges: number;
}

export interface PerfGenerator {
  start(points: number, hz: number, alarms?: number): PerfRun;
  stop(): PerfRun | null;
  status(): PerfRun | null;
  /** Produces what is due by `now`; called every few ms while running. */
  tick(now: number): Report[];
  /** After a stop, once: the reports that return raised alarms to normal. Otherwise null. */
  drain(): Report[] | null;
}

export function createPerfGenerator(options: { max?: number; maxAlarms?: number; random?: () => number; now?: () => number } = {}): PerfGenerator {
  const max = options.max ?? PERF_POINTS;
  const maxAlarms = options.maxAlarms ?? PERF_ALARMS;
  const random = options.random ?? Math.random;
  const clock = options.now ?? Date.now;
  let run: (PerfRun & { phase: number[]; level: number[]; last: number; alarmPhase: number[]; raised: boolean[] }) | null = null;
  let leftBehind: Report[] | null = null;

  const summary = (): PerfRun | null =>
    run ? { points: run.points, hz: run.hz, alarms: run.alarms, startedAt: run.startedAt, sent: run.sent, alarmChanges: run.alarmChanges } : null;

  const stop = (): PerfRun | null => {
    const s = summary();
    if (run) {
      const at = clock();
      const resets: Report[] = [];
      run.raised.forEach((up, i) => {
        if (up) resets.push({ addr: driverPath(perfAlarmEquipment(i), "v"), value: 0, quality: true, at });
      });
      leftBehind = [...(leftBehind ?? []), ...resets];
    }
    run = null;
    return s;
  };

  return {
    start(points, hz, alarms = 0) {
      if (!Number.isInteger(points) || points < 0 || points > max) throw new Error(`points must be an integer from 0 to ${max}`);
      if (!Number.isInteger(alarms) || alarms < 0 || alarms > maxAlarms) throw new Error(`alarms must be an integer from 0 to ${maxAlarms}`);
      if (points + alarms === 0) throw new Error("a run needs points or alarms");
      if (!(hz > 0 && hz <= 10)) throw new Error("hz must be above 0 and at most 10");
      stop();
      const period = 1000 / hz;
      const now = clock();
      run = {
        points,
        hz,
        alarms,
        startedAt: now,
        sent: 0,
        alarmChanges: 0,
        last: now,
        alarmPhase: Array.from({ length: alarms }, () => random() * PERF_ALARM_PERIOD_MS),
        raised: Array.from({ length: alarms }, () => false),
        phase: Array.from({ length: points }, () => random() * period),
        level: Array.from({ length: points }, () => 20 + random() * 60),
      };
      return summary() as PerfRun;
    },
    stop,
    drain() {
      const out = leftBehind;
      leftBehind = null;
      return out;
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
      r.sent += out.length;
      for (let i = 0; i < r.alarms; i++) {
        const k = Math.floor((now - r.startedAt - (r.alarmPhase[i] as number)) / PERF_ALARM_PERIOD_MS);
        // Raised in even periods, returned in odd ones; nothing before its first phase moment.
        const up = k >= 0 && k % 2 === 0;
        if (up === r.raised[i]) continue;
        r.raised[i] = up;
        r.alarmChanges++;
        out.push({
          addr: driverPath(perfAlarmEquipment(i), "v"),
          value: up ? 1 : 0,
          quality: true,
          at: Math.round(r.startedAt + (r.alarmPhase[i] as number) + k * PERF_ALARM_PERIOD_MS),
        });
      }
      r.last = now;
      return out;
    },
  };
}
