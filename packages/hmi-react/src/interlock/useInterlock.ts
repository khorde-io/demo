import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createInterlockWatcher, type CommandKey, type InterlockView } from "@khorde/hmi-core";
import { useHmi } from "../context.tsx";

const IDLE: InterlockView = { detail: null, tree: null, loading: false, error: null };
const NOOP_STORE = { get: () => IDLE, subscribe: () => () => {} };

/**
 * Follows a command's interlock while the component is mounted: queries the
 * detail and re-queries when one of its input points changes.
 */
export function useInterlock(key: CommandKey | null): InterlockView {
  const { backend, points } = useHmi();
  const id = key ? `${key.agent}|${key.equipment}|${key.name}` : "";

  // Creating a watcher has no side effects; the effect below starts and stops it.
  const watcher = useMemo(() => {
    if (!backend || !points || !id) return null;
    const [agent, equipment, name] = id.split("|") as [string, string, string];
    return createInterlockWatcher(backend, points, { agent, equipment, name });
  }, [backend, points, id]);

  useEffect(() => {
    if (!watcher) return;
    void watcher.start();
    return () => watcher.stop();
  }, [watcher]);

  const store = watcher ?? NOOP_STORE;
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
