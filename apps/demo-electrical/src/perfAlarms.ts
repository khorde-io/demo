/**
 * The alarm side of the performance bench: feeds the generator's alarm reports
 * into a mock backend (UI only), counts the changes that reach the active list
 * and how old they are, and clears the bench's alarms after a run.
 */

import type { Alarm, AlarmStore } from "@khorde/hmi-core";
import type { MockBackend } from "@khorde/hmi-core/mock";
import { perfAlarmSeverity, type Report } from "@khorde/demo-plant/perf";

export const isPerfAlarmAddr = (addr: string) => addr.startsWith("perfalarm.");
export const isPerfAlarm = (alarm: Pick<Alarm, "area">) => alarm.area.startsWith("perfalarm.");

/** Turns reports into alarms on a mock backend, as the agent's digital alarms do on the hub. */
export function createAlarmFeed(backend: Pick<MockBackend, "raiseAlarm" | "resetAlarm">) {
  const raised = new Map<string, string>();
  return (report: Report) => {
    const area = report.addr.slice(0, report.addr.lastIndexOf("."));
    if (report.value === 1) {
      const n = Number(area.slice(-4));
      raised.set(area, backend.raiseAlarm({ name: `perf_a${area.slice(-4)}`, area, severity: perfAlarmSeverity(n), value: 1 }).instanceId);
    } else {
      const id = raised.get(area);
      if (id) backend.resetAlarm(id);
      raised.delete(area);
    }
  };
}

export interface AlarmTally {
  /** Looks at the list as it stands in a frame; changes count only when `counting`. */
  observe(alarms: readonly Alarm[], counting: boolean): void;
  readonly shown: number;
  readonly latencies: readonly number[];
  /** The most bench alarms listed at once. */
  readonly peak: number;
}

/** Counts each state change of a bench alarm once, in the first frame it is listed in. */
export function createAlarmTally(now: () => number = Date.now): AlarmTally {
  const seen = new Map<string, number>();
  const latencies: number[] = [];
  let shown = 0;
  let peak = 0;
  return {
    observe(alarms, counting) {
      const at = now();
      let listed = 0;
      for (const a of alarms) {
        if (!isPerfAlarm(a)) continue;
        listed++;
        const changed = a.stateAt.getTime();
        if (seen.get(a.instanceId) === changed) continue;
        seen.set(a.instanceId, changed);
        if (!counting) continue;
        shown++;
        if (latencies.length < 200_000) latencies.push(at - changed);
      }
      if (counting && listed > peak) peak = listed;
    },
    get shown() {
      return shown;
    },
    latencies,
    get peak() {
      return peak;
    },
  };
}

/** Acknowledges what a run left in the active list; resolves to how many the hub didn't take. */
export async function ackPerfAlarms(store: Pick<AlarmStore, "get" | "ackMany">): Promise<number> {
  const ids = store
    .get()
    .alarms.filter((a) => isPerfAlarm(a) && !a.acked)
    .map((a) => a.instanceId);
  return ids.length - (await store.ackMany(ids)).length;
}
