/**
 * The active alarm list, kept by following `activeAlarmChanges`: every alarm
 * active now, `SYNCED`, then every change. The hub decides what is active
 * (`Set`, or returned to normal and not acknowledged yet), so an alarm is listed
 * exactly as long as the hub says. Past changes are read separately with
 * `loadAlarmHistory`.
 */

import type { ScadaBackend } from "./backend.ts";
import { collectPages } from "./pages.ts";
import type { Permissions } from "./commands.ts";
import type { Alarm, AlarmJournalEntry, AlarmPriority } from "./model.ts";
import { matchAny } from "./paths.ts";
import { writable, type Readable, type Unsubscribe } from "./store.ts";

export interface PriorityCount {
  total: number;
  unacked: number;
}

export interface AlarmCounts {
  total: number;
  unacked: number;
  byPriority: Record<AlarmPriority, PriorityCount>;
}

export interface AlarmSnapshot {
  /** Newest first. */
  alarms: readonly Alarm[];
  counts: AlarmCounts;
  loaded: boolean;
  error: unknown;
}

export interface AlarmStore extends Readable<AlarmSnapshot> {
  /** Resolves once the list is complete (or the subscription failed). */
  start(): Promise<void>;
  stop(): void;
  /** Resolves to whether the hub took the ack; the list changes when the hub reports it. */
  ack(instanceId: string): Promise<boolean>;
  /** Acknowledges several alarms; resolves to the ids the hub took. */
  ackMany(instanceIds: readonly string[]): Promise<string[]>;
}

export interface AlarmStoreOptions {
  /** Alarm areas to follow (wildcards allowed); empty means every area. */
  areas?: readonly string[];
  /** When given, `ack` refuses without asking the backend if the user may not acknowledge. */
  permissions?: Permissions;
}

export function countAlarms(alarms: readonly Alarm[]): AlarmCounts {
  const byPriority: Record<AlarmPriority, PriorityCount> = {
    1: { total: 0, unacked: 0 },
    2: { total: 0, unacked: 0 },
    3: { total: 0, unacked: 0 },
  };
  let unacked = 0;
  for (const a of alarms) {
    byPriority[a.priority].total++;
    if (!a.acked) {
      byPriority[a.priority].unacked++;
      unacked++;
    }
  }
  return { total: alarms.length, unacked, byPriority };
}

/** Newest change first; alarms raised together put the most urgent first. */
function sortNewestFirst(list: Alarm[]): Alarm[] {
  return list.sort((a, b) => b.stateAt.getTime() - a.stateAt.getTime() || a.priority - b.priority);
}

export interface AlarmFilter {
  /** Area patterns (`vds.wf.>`); empty or omitted means all. */
  areas?: readonly string[];
  priorities?: readonly AlarmPriority[];
  unackedOnly?: boolean;
  /** Matched against area, name and condition, and any extra text (e.g. translated). */
  text?: string;
  textOf?(alarm: Pick<Alarm, "area" | "name" | "condition">): string;
}

/** What a filter looks at, which active alarms and journal rows both have. */
type Filterable = Pick<Alarm, "area" | "name" | "condition" | "acked"> & { priority: AlarmPriority | null };

function matchesFilter(a: Filterable, f: AlarmFilter): boolean {
  if (f.areas?.length && !matchAny(f.areas, a.area)) return false;
  if (f.priorities?.length && (a.priority === null || !f.priorities.includes(a.priority))) return false;
  if (f.unackedOnly && a.acked) return false;
  const needle = f.text?.trim().toLowerCase();
  if (!needle) return true;
  return `${a.area} ${a.name} ${a.condition} ${f.textOf?.(a) ?? ""}`.toLowerCase().includes(needle);
}

export function filterAlarms(alarms: readonly Alarm[], f: AlarmFilter): Alarm[] {
  return alarms.filter((a) => matchesFilter(a, f));
}

const EMPTY: AlarmSnapshot = { alarms: [], counts: countAlarms([]), loaded: false, error: null };

export function createAlarmStore(backend: ScadaBackend, options: AlarmStoreOptions = {}): AlarmStore {
  const areas = options.areas ?? [];
  const state = writable<AlarmSnapshot>(EMPTY);
  let stopSubscription: Unsubscribe | null = null;
  let settleStart: (() => void) | null = null;

  const publish = (alarms: Map<string, Alarm>) => {
    const list = sortNewestFirst([...alarms.values()]);
    state.set({ alarms: list, counts: countAlarms(list), loaded: true, error: null });
  };

  const send = async (instanceId: string) => {
    const alarm = state.get().alarms.find((a) => a.instanceId === instanceId);
    if (!alarm) return false;
    return (await backend.ackAlarm(alarm.key, alarm.instanceId)) !== "NOT_FOUND";
  };

  return {
    get: state.get,
    subscribe: state.subscribe,

    start() {
      if (stopSubscription) return Promise.resolve();
      return new Promise<void>((resolve) => {
        settleStart = resolve;
        const alarms = new Map<string, Alarm>();
        // While syncing, this holds what the hub has listed. A new subscription
        // only lists what is active, so whatever left during an outage goes at
        // `synced`. The list on screen doesn't change until then.
        let seen: Set<string> | null = new Set();
        const stopConnection = backend.connection.subscribe(() => {
          if (backend.connection.get() !== "online") seen ??= new Set();
        });
        const stopChanges = backend.subscribeActiveAlarms(areas, {
          next(change) {
            if (change.kind === "upsert") {
              alarms.set(change.alarm.instanceId, change.alarm);
              seen?.add(change.alarm.instanceId);
            } else if (change.kind === "remove") {
              alarms.delete(change.instanceId);
              seen?.delete(change.instanceId);
            } else {
              // The hub may also repeat `synced` on its own; only a sync in progress prunes.
              if (seen) for (const id of alarms.keys()) if (!seen.has(id)) alarms.delete(id);
              seen = null;
              resolve();
            }
            if (!seen) publish(alarms);
          },
          error(error) {
            state.set({ ...state.get(), error });
            resolve();
          },
        });
        stopSubscription = () => {
          stopConnection();
          stopChanges();
        };
      });
    },

    stop() {
      stopSubscription?.();
      stopSubscription = null;
      settleStart?.();
    },

    async ack(instanceId) {
      if (options.permissions && !options.permissions.can("ackAlarm")) return false;
      return send(instanceId);
    },

    async ackMany(ids) {
      if (options.permissions && !options.permissions.can("ackAlarm")) return [];
      const results = await Promise.allSettled(ids.map(send));
      return ids.filter((_, i) => {
        const r = results[i];
        return r?.status === "fulfilled" && r.value;
      });
    },
  };
}

/**
 * The alarm journal for the history/event view: one row per change (raised,
 * returned, event, acknowledged) in a time range, newest first, optionally
 * filtered. One-shot query, page by page up to `maxRows` (the oldest are
 * dropped); the active list is the live view. A `GAP` row always stays, whatever
 * the filter: it belongs to no alarm and says the record is incomplete.
 */
export async function loadAlarmHistory(
  backend: ScadaBackend,
  range: { from: Date; to: Date },
  filter: AlarmFilter = {},
  { pageSize = 5_000, maxRows = 50_000 }: { pageSize?: number; maxRows?: number } = {},
): Promise<AlarmJournalEntry[]> {
  const all = await collectPages((page) => backend.alarmJournal({ ...range, order: "desc", ...page }), { pageSize, maxRows });
  return all.filter((e) => e.kind === "GAP" || matchesFilter(e, filter));
}
