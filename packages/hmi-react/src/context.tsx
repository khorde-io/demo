/**
 * React access to the HMI services. Wrap the app in `<HmiProvider hmi={...}>`;
 * components read what they need with the hooks below. Only `i18n` is
 * required, so a widget can be rendered on its own (tests, docs) with just a
 * dictionary.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { AlarmSnapshot, ConnectionState, Hmi, I18n, PointId, PointValue, Readable } from "@khorde/hmi-core";

export type HmiServices = Pick<Hmi, "i18n"> & Partial<Pick<Hmi, "backend" | "points" | "auth" | "commands" | "alarms" | "history" | "theme">>;

const HmiContext = createContext<HmiServices | null>(null);

export function HmiProvider({ hmi, children }: { hmi: HmiServices; children: ReactNode }) {
  return <HmiContext.Provider value={hmi}>{children}</HmiContext.Provider>;
}

export function useHmi(): HmiServices {
  const hmi = useContext(HmiContext);
  if (!hmi) throw new Error("useHmi needs an <HmiProvider> above it");
  return hmi;
}

export function useI18n(): I18n {
  const i18n = useHmi().i18n;
  // Re-render when the language changes.
  useReadable(i18n.locale);
  return i18n;
}

/** Subscribes to a core store (`get` + `subscribe`). */
export function useReadable<T>(store: Readable<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Live values of some points. Starts watching them while the component is
 * mounted; the returned map only changes when one of the values does.
 */
export function usePointValues(ids: readonly PointId[]): ReadonlyMap<PointId, PointValue> {
  const points = useHmi().points;
  const key = [...ids].sort().join("|");
  const cache = useRef<{ key: string; values: PointValue[]; map: ReadonlyMap<PointId, PointValue> }>({ key: "", values: [], map: new Map() });

  useEffect(() => {
    if (!points || key === "") return;
    return points.watch(key.split("|") as PointId[]);
  }, [points, key]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!points || key === "") return () => {};
      const offs = (key.split("|") as PointId[]).map((id) => points.subscribe(id, onChange));
      return () => {
        for (const off of offs) off();
      };
    },
    [points, key],
  );
  const snapshot = () => {
    const c = cache.current;
    if (!points || key === "") return c.key === key ? c.map : (cache.current = { key, values: [], map: new Map() }).map;
    const list = key.split("|") as PointId[];
    const values = list.map((id) => points.get(id));
    if (c.key === key && values.every((v, i) => v === c.values[i])) return c.map;
    cache.current = { key, values, map: new Map(list.map((id, i) => [id, values[i] as PointValue])) };
    return cache.current.map;
  };
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Live value of one point. */
export function usePoint(id: PointId): PointValue | undefined {
  return usePointValues([id]).get(id);
}

const EMPTY_ALARMS: AlarmSnapshot = {
  alarms: [],
  counts: { total: 0, unacked: 0, byPriority: { 1: { total: 0, unacked: 0 }, 2: { total: 0, unacked: 0 }, 3: { total: 0, unacked: 0 } } },
  loaded: false,
  error: null,
};
const constant = <T,>(value: T): Readable<T> => ({ get: () => value, subscribe: () => () => {} });
const NO_ALARMS = constant(EMPTY_ALARMS);
const IDLE_CONNECTION = constant<ConnectionState>("idle");

/** The active alarm list from `<HmiProvider>` (empty without an alarm store). */
export function useAlarms(): AlarmSnapshot {
  return useReadable(useHmi().alarms ?? NO_ALARMS);
}

/** State of the link to the backend. */
export function useConnection(): ConnectionState {
  return useReadable(useHmi().backend?.connection ?? IDLE_CONNECTION);
}
