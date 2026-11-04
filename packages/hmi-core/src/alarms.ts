/**
 * The active alarm list, kept by following `activeAlarmChanges`: every alarm
 * active now, `SYNCED`, then every change. The hub decides what is active
 * (`Set`, or returned to normal and not acknowledged yet), so an alarm is listed
 * exactly as long as the hub says. Past changes are read separately with
 * `loadAlarmHistory`.
 *
 * Built for a flood: changes are applied as they arrive but published at most
 * a few times a second, which is already faster than anyone can read, and each
 * publish merges what changed into the sorted list instead of sorting it again.
 * The first change after a quiet moment is published at once.
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
  /** Least time between published lists, ms; 0 publishes every change. Default 250. */
  publishEveryMs?: number;
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
const newestFirst = (a: Alarm, b: Alarm) => b.stateAt.getTime() - a.stateAt.getTime() || a.priority - b.priority;

/** Merges two lists that are each sorted newest first. */
function mergeNewestFirst(a: readonly Alarm[], b: readonly Alarm[]): Alarm[] {
  const out: Alarm[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) out.push(newestFirst(a[i] as Alarm, b[j] as Alarm) <= 0 ? (a[i++] as Alarm) : (b[j++] as Alarm));
  while (i < a.length) out.push(a[i++] as Alarm);
  while (j < b.length) out.push(b[j++] as Alarm);
  return out;
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

export type AlarmOrder = "newest" | "urgent";

/**
 * A copy of the list in another order. `newest` is the store's. `urgent` is what
 * to deal with first in a flood: by priority, then not acknowledged, then newest.
 */
export function sortAlarms(alarms: readonly Alarm[], order: AlarmOrder): Alarm[] {
  if (order === "newest") return [...alarms].sort(newestFirst);
  return [...alarms].sort((a, b) => a.priority - b.priority || Number(a.acked) - Number(b.acked) || newestFirst(a, b));
}

export function filterAlarms(alarms: readonly Alarm[], f: AlarmFilter): Alarm[] {
  return alarms.filter((a) => matchesFilter(a, f));
}

const EMPTY: AlarmSnapshot = { alarms: [], counts: countAlarms([]), loaded: false, error: null };

export function createAlarmStore(backend: ScadaBackend, options: AlarmStoreOptions = {}): AlarmStore {
  const areas = options.areas ?? [];
  const publishEveryMs = options.publishEveryMs ?? 250;
  const state = writable<AlarmSnapshot>(EMPTY);
  let stopSubscription: Unsubscribe | null = null;
  let settleStart: (() => void) | null = null;

  const alarms = new Map<string, Alarm>();
  /** The list last published, and the alarms that changed since. */
  let sorted: Alarm[] = [];
  const dirty = new Set<string>();
  // While syncing, this holds what the hub has listed. A new subscription
  // only lists what is active, so whatever left during an outage goes at
  // `synced`. The list on screen doesn't change until then.
  let seen: Set<string> | null = null;
  let lastPublish = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const publish = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (dirty.size > 0) {
      const changed: Alarm[] = [];
      for (const id of dirty) {
        const alarm = alarms.get(id);
        if (alarm) changed.push(alarm);
      }
      sorted = mergeNewestFirst(
        sorted.filter((a) => !dirty.has(a.instanceId)),
        changed.sort(newestFirst),
      );
      dirty.clear();
    }
    lastPublish = Date.now();
    state.set({ alarms: sorted, counts: countAlarms(sorted), loaded: true, error: null });
  };

  /** Publishes now if the last list is old enough, else once it is. */
  const changed = () => {
    if (seen || timer) return;
    const wait = lastPublish + publishEveryMs - Date.now();
    if (wait <= 0) publish();
    else
      timer = setTimeout(() => {
        timer = null;
        if (!seen) publish();
      }, wait);
  };

  const send = async (instanceId: string) => {
    const alarm = alarms.get(instanceId);
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
        alarms.clear();
        dirty.clear();
        sorted = [];
        seen = new Set();
        const stopConnection = backend.connection.subscribe(() => {
          if (backend.connection.get() !== "online") seen ??= new Set();
        });
        const stopChanges = backend.subscribeActiveAlarms(areas, {
          next(change) {
            if (change.kind === "upsert") {
              alarms.set(change.alarm.instanceId, change.alarm);
              dirty.add(change.alarm.instanceId);
              seen?.add(change.alarm.instanceId);
              changed();
            } else if (change.kind === "remove") {
              alarms.delete(change.instanceId);
              dirty.add(change.instanceId);
              seen?.delete(change.instanceId);
              changed();
            } else if (seen) {
              // The hub may also repeat `synced` on its own; only a sync in progress prunes.
              for (const id of alarms.keys()) {
                if (seen.has(id)) continue;
                alarms.delete(id);
                dirty.add(id);
              }
              seen = null;
              // Straight away: whoever awaits `start` reads the list next.
              publish();
              resolve();
            }
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
      if (timer) clearTimeout(timer);
      timer = null;
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

/** A `GAP` row always stays, whatever the filter: it belongs to no alarm and says the record is incomplete. */
const keepJournalEntry = (e: AlarmJournalEntry, filter: AlarmFilter) => e.kind === "GAP" || matchesFilter(e, filter);

export interface AlarmJournalReader {
  /**
   * Reads on until at least `count` rows match or the journal ends, and resolves
   * to what is read so far. The hub filters by time only, so a narrow filter may
   * read several pages to fill one screen. A failed read can be asked for again.
   */
  readUntil(count: number): Promise<{ rows: readonly AlarmJournalEntry[]; done: boolean }>;
  /** Stops reading, for when nobody wants the rows any more. */
  cancel(): void;
}

/**
 * Reads the alarm journal for a time range on demand, newest first: the event
 * log asks for what it is about to show, not for the whole range, which a flood
 * can fill with tens of thousands of rows.
 */
export function createAlarmJournalReader(
  backend: ScadaBackend,
  range: { from: Date; to: Date },
  filter: AlarmFilter = {},
  { pageSize = 500 }: { pageSize?: number } = {},
): AlarmJournalReader {
  const rows: AlarmJournalEntry[] = [];
  let after: string | undefined;
  let done = false;
  let cancelled = false;
  return {
    async readUntil(count) {
      const wanted = () => !done && !cancelled && rows.length < count;
      while (wanted()) {
        const page = await backend.alarmJournal({ ...range, order: "desc", first: pageSize, ...(after ? { after } : {}) });
        rows.push(...page.items.filter((e) => keepJournalEntry(e, filter)));
        after = page.next ?? undefined;
        done = !after;
      }
      return { rows: [...rows], done };
    },
    cancel() {
      cancelled = true;
    },
  };
}

/**
 * The whole alarm journal for a time range at once, newest first, for an export:
 * page by page up to `maxRows` (the oldest are dropped). To show it, use
 * `createAlarmJournalReader`.
 */
export async function loadAlarmHistory(
  backend: ScadaBackend,
  range: { from: Date; to: Date },
  filter: AlarmFilter = {},
  { pageSize = 5_000, maxRows = 50_000 }: { pageSize?: number; maxRows?: number } = {},
): Promise<AlarmJournalEntry[]> {
  const all = await collectPages((page) => backend.alarmJournal({ ...range, order: "desc", ...page }), { pageSize, maxRows });
  return all.filter((e) => keepJournalEntry(e, filter));
}
