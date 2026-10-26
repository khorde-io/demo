import { commandId, createInterlockStatesWatcher, type CommandInterlockState, type CommandKey } from "@khorde/hmi-core";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useHmi } from "../context.tsx";

const EMPTY = new Map<string, CommandInterlockState>();
const NOOP_STORE = { get: () => EMPTY, subscribe: () => () => {} };

/**
 * Live interlock state of a set of commands (`none`, `permit`, `block` or
 * `unknown`), for marking command buttons. One watcher, and one hub query,
 * covers the whole set.
 */
export function useInterlockStates(keys: readonly CommandKey[]): (key: CommandKey) => CommandInterlockState {
  const { backend, points } = useHmi();
  const id = keys.map(commandId).join(",");

  // Creating a watcher has no side effects; the effect below starts and stops it.
  const watcher = useMemo(() => {
    if (!backend || !points || !id) return null;
    const list = id.split(",").map((s) => {
      const [agent, equipment, name] = s.split("|") as [string, string, string];
      return { agent, equipment, name };
    });
    return createInterlockStatesWatcher(backend, points, list);
  }, [backend, points, id]);

  useEffect(() => {
    if (!watcher) return;
    void watcher.start();
    return () => watcher.stop();
  }, [watcher]);

  const store = watcher ?? NOOP_STORE;
  const states = useSyncExternalStore(store.subscribe, store.get, store.get);
  return (key) => states.get(commandId(key)) ?? "unknown";
}
