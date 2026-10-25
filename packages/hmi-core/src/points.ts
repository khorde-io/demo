/**
 * The point store: the single place live values come from.
 *
 * Screens `watch` the points (or path patterns) they show. The store keeps ONE
 * `measByPaths` subscription covering everything watched, re-opening it when the
 * set changes. A new subscription first delivers the cached value of every
 * matching point, so a screen fills as soon as it opens. Values are cached per
 * point and listeners are notified in batches (one per animation frame by
 * default), so a busy plant does not re-render on every message.
 */

import type { ConnectionState, ScadaBackend } from "./backend.ts";
import { pointPath, type Measurement, type PointId, type PointValue } from "./model.ts";
import { isPattern, reducePatterns } from "./paths.ts";
import { frameScheduler, type Listener, type Scheduler, type Unsubscribe } from "./store.ts";

export interface PointStoreOptions {
  /** Wait this long after the watched set changes before re-subscribing. */
  debounceMs?: number;
  scheduler?: Scheduler;
  onError?(err: unknown): void;
}

export interface PointStore {
  /**
   * Starts receiving the given point ids (`equipment::name`) or path patterns
   * (`vds.sub.>`). Returns a function that stops watching them.
   */
  watch(targets: readonly string[]): Unsubscribe;
  /** Current value; the same object until the point changes. */
  get(id: PointId): PointValue;
  subscribe(id: PointId, listener: Listener): Unsubscribe;
  /** Marks the matching points stale (or not), e.g. when their agent goes offline. */
  setStale(match: (id: PointId) => boolean, stale: boolean): void;
  /** Path patterns the store is subscribed to now. */
  subscribedPaths(): readonly string[];
  dispose(): void;
}

function emptyValue(id: PointId): PointValue {
  return Object.freeze({ id, value: null, type: null, quality: "bad", timestamp: null, stale: false });
}

export function createPointStore(backend: ScadaBackend, options: PointStoreOptions = {}): PointStore {
  const debounceMs = options.debounceMs ?? 30;
  const schedule = options.scheduler ?? frameScheduler;

  const values = new Map<PointId, PointValue>();
  const listeners = new Map<PointId, Set<Listener>>();
  const interest = new Map<string, number>();
  const dirty = new Set<PointId>();

  let current: string[] = [];
  let closeSubscription: Unsubscribe | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let flushQueued = false;
  let disposed = false;

  const flush = () => {
    flushQueued = false;
    const ids = [...dirty];
    dirty.clear();
    for (const id of ids) for (const l of [...(listeners.get(id) ?? [])]) l();
  };

  const markDirty = (id: PointId) => {
    dirty.add(id);
    if (!flushQueued) {
      flushQueued = true;
      schedule(flush);
    }
  };

  const put = (id: PointId, next: PointValue) => {
    values.set(id, Object.freeze(next));
    markDirty(id);
  };

  const onMeasurement = (m: Measurement) => {
    put(m.id, { id: m.id, value: m.value, type: m.type, quality: m.quality, timestamp: m.timestamp, stale: false });
  };

  const refresh = () => {
    refreshTimer = null;
    if (disposed) return;
    const next = reducePatterns(interest.keys()).sort();
    if (next.length === current.length && next.every((p, i) => p === current[i])) return;
    const previous = closeSubscription;
    current = next;
    closeSubscription =
      next.length > 0
        ? backend.subscribeMeasurements(next, { next: onMeasurement, error: (e) => options.onError?.(e) })
        : null;
    // The new subscription re-delivers cached values, so closing the old one
    // after opening the new one leaves no gap.
    previous?.();
  };

  const scheduleRefresh = () => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, debounceMs);
  };

  const setStale = (match: (id: PointId) => boolean, stale: boolean) => {
    for (const [id, v] of values) if (v.stale !== stale && match(id)) put(id, { ...v, stale });
  };

  const stopConnection = backend.connection.subscribe(() => {
    const state: ConnectionState = backend.connection.get();
    if (state === "offline") setStale(() => true, true);
  });

  return {
    watch(targets) {
      const paths = targets.map((t) => (isPattern(t) || !t.includes("::") ? t : pointPath(t as PointId)));
      for (const p of paths) interest.set(p, (interest.get(p) ?? 0) + 1);
      scheduleRefresh();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const p of paths) {
          const n = (interest.get(p) ?? 1) - 1;
          if (n <= 0) interest.delete(p);
          else interest.set(p, n);
        }
        scheduleRefresh();
      };
    },

    get(id) {
      let v = values.get(id);
      if (!v) {
        v = emptyValue(id);
        values.set(id, v);
      }
      return v;
    },

    subscribe(id, listener) {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
      };
    },

    setStale,
    subscribedPaths: () => current,

    dispose() {
      disposed = true;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      stopConnection();
      closeSubscription?.();
      closeSubscription = null;
      current = [];
    },
  };
}
