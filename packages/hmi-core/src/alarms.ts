/**
 * The active alarm list: seeded with `activeAlm`, kept live with
 * `almSubscribe`.
 *
 * `almSubscribe` streams every alarm change (new, returned, event, ack), not
 * the list itself, so this store applies the active-alarm rule: by default an
 * alarm stays listed until it has returned to normal (or was a one-off event)
 * AND has been acknowledged (ISA-18.2). Returned or acknowledged history is
 * read separately with `loadAlarmHistory`.
 */

import type { ScadaBackend } from "./backend.ts";
import type { Permissions } from "./commands.ts";
import type { Alarm, AlarmPriority } from "./model.ts";
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
  start(): Promise<void>;
  stop(): void;
  ack(instanceId: string): Promise<boolean>;
  /** Acknowledges several alarms; resolves to the ids that were acknowledged. */
  ackMany(instanceIds: readonly string[]): Promise<string[]>;
}

/** Decides whether an alarm belongs in the active list. */
export type ActiveRule = (alarm: Alarm) => boolean;

export interface AlarmStoreOptions {
  /** Alarm areas to follow (wildcards allowed); empty means every area. */
  areas?: readonly string[];
  /** Defaults to `untilClearedAndAcked`. */
  isActive?: ActiveRule;
  /** When given, `ack` refuses without asking the backend if the user may not acknowledge. */
  permissions?: Permissions;
  now?: () => Date;
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

/** ISA-18.2: listed while active, and after return to normal until acknowledged. */
export const untilClearedAndAcked: ActiveRule = (alarm) => alarm.state === "Set" || !alarm.acked;

/** Listed only while the condition is present, whatever the ack state. */
export const whileSet: ActiveRule = (alarm) => alarm.state === "Set";

/** Applies one alarm update to a list, keyed by `instanceId`. */
export function mergeAlarm(list: readonly Alarm[], incoming: Alarm, isActive: ActiveRule = untilClearedAndAcked): Alarm[] {
  const existing = list.find((a) => a.instanceId === incoming.instanceId);
  // An update that only carries the ack must not lose an earlier ack either.
  const merged: Alarm = existing && existing.acked && !incoming.acked
    ? { ...incoming, acked: true, ackTimestamp: existing.ackTimestamp, actorId: existing.actorId, actorDisplay: existing.actorDisplay }
    : incoming;
  const rest = list.filter((a) => a.instanceId !== incoming.instanceId);
  if (!isActive(merged)) return rest;
  return sortNewestFirst([...rest, merged]);
}

/** Newest first; alarms raised together put the most urgent first. */
function sortNewestFirst(list: Alarm[]): Alarm[] {
  return list.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || a.priority - b.priority);
}

export interface AlarmFilter {
  /** Area patterns (`vds.wf.>`); empty or omitted means all. */
  areas?: readonly string[];
  priorities?: readonly AlarmPriority[];
  unackedOnly?: boolean;
  /** Matched against area, name and condition, and any extra text (e.g. translated). */
  text?: string;
  textOf?(alarm: Alarm): string;
}

export function filterAlarms(alarms: readonly Alarm[], f: AlarmFilter): Alarm[] {
  const needle = f.text?.trim().toLowerCase();
  return alarms.filter((a) => {
    if (f.areas?.length && !matchAny(f.areas, a.area)) return false;
    if (f.priorities?.length && !f.priorities.includes(a.priority)) return false;
    if (f.unackedOnly && a.acked) return false;
    if (needle) {
      const hay = `${a.area} ${a.name} ${a.condition} ${f.textOf?.(a) ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

const EMPTY: AlarmSnapshot = { alarms: [], counts: countAlarms([]), loaded: false, error: null };

export function createAlarmStore(backend: ScadaBackend, options: AlarmStoreOptions = {}): AlarmStore {
  const areas = options.areas ?? [];
  const isActive = options.isActive ?? untilClearedAndAcked;
  const now = options.now ?? (() => new Date());
  const state = writable<AlarmSnapshot>(EMPTY);
  let stopSubscription: Unsubscribe | null = null;
  let generation = 0;

  const setAlarms = (alarms: readonly Alarm[], patch: Partial<AlarmSnapshot> = {}) =>
    state.set({ ...state.get(), ...patch, alarms, counts: countAlarms(alarms) });

  const apply = (incoming: Alarm) => setAlarms(mergeAlarm(state.get().alarms, incoming, isActive));

  const applyAck = (instanceId: string) => {
    const a = state.get().alarms.find((x) => x.instanceId === instanceId);
    if (a) apply({ ...a, acked: true, ackTimestamp: now() });
  };

  return {
    get: state.get,
    subscribe: state.subscribe,

    async start() {
      if (stopSubscription) return;
      const gen = ++generation;
      // Subscribe first and buffer, so nothing that happens during the initial
      // query is lost; then apply the buffer on top of the snapshot.
      let buffer: Alarm[] | null = [];
      stopSubscription = backend.subscribeAlarms(areas, {
        next: (a) => (buffer ? buffer.push(a) : apply(a)),
        error: (error) => state.set({ ...state.get(), error }),
      });
      try {
        const initial = await backend.activeAlarms(areas);
        if (gen !== generation) return;
        let list = sortNewestFirst(initial.filter(isActive));
        for (const a of buffer) list = mergeAlarm(list, a, isActive);
        buffer = null;
        setAlarms(list, { loaded: true, error: null });
      } catch (error) {
        if (gen !== generation) return;
        buffer = null;
        state.set({ ...state.get(), error });
      }
    },

    stop() {
      generation++;
      stopSubscription?.();
      stopSubscription = null;
    },

    async ack(instanceId) {
      if (options.permissions && !options.permissions.can("ackAlarm")) return false;
      const ok = await backend.ackAlarm(instanceId);
      if (ok) applyAck(instanceId);
      return ok;
    },

    async ackMany(ids) {
      if (options.permissions && !options.permissions.can("ackAlarm")) return [];
      const results = await Promise.allSettled(ids.map((id) => backend.ackAlarm(id)));
      const done = ids.filter((_, i) => {
        const r = results[i];
        return r?.status === "fulfilled" && r.value;
      });
      for (const id of done) applyAck(id);
      return done;
    },
  };
}

/**
 * Alarm history for the history/event view: every recorded change (raised,
 * returned, event, acknowledged) in a time range, newest first, optionally
 * filtered. One-shot query; the active list is the live view.
 */
export async function loadAlarmHistory(
  backend: ScadaBackend,
  range: { from: Date; to: Date },
  filter: AlarmFilter = {},
): Promise<Alarm[]> {
  const all = await backend.alarmHistory(range);
  // An ack is a change of its own: order it by when it happened.
  const changedAt = (a: Alarm) => Math.max(a.timestamp.getTime(), a.ackTimestamp?.getTime() ?? 0);
  return filterAlarms(
    [...all].sort((a, b) => changedAt(b) - changedAt(a)),
    filter,
  );
}
