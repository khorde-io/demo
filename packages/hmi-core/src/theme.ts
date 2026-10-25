/**
 * The active theme: which `data-theme` the document carries, remembered per
 * user in the browser. Framework-agnostic; `hmi-react` adds `useTheme()`.
 */

import type { ThemeInfo } from "@khorde/hmi-theme";
import { writable, type Readable } from "./store.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeServiceOptions {
  themes: readonly ThemeInfo[];
  defaultTheme: string;
  /** Limits the picker to these ids (from the config); defaults to all. */
  allowed?: readonly string[];
  /** Where the choice is remembered; null disables it. */
  storage?: StorageLike | null;
  /** Element that receives `data-theme`; null to manage it yourself. */
  target?: { dataset: Record<string, string | undefined> } | null;
  storageKey?: string;
}

export interface ThemeService extends Readable<string> {
  list(): ThemeInfo[];
  set(id: string): void;
  /** Switches to the theme remembered for this user (or the default). */
  setUser(sub: string | null): void;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function createThemeService(options: ThemeServiceOptions): ThemeService {
  const offered = options.themes.filter((t) => !options.allowed || options.allowed.includes(t.id));
  const valid = (id: string | null | undefined): id is string => !!id && offered.some((t) => t.id === id);
  const fallback = valid(options.defaultTheme) ? options.defaultTheme : (offered[0]?.id ?? options.defaultTheme);
  const storage = options.storage === undefined ? safe(() => globalThis.localStorage ?? null, null) : options.storage;
  const target =
    options.target === undefined ? (typeof document === "undefined" ? null : document.documentElement) : options.target;
  const baseKey = options.storageKey ?? "khorde.hmi.theme";
  let user: string | null = null;

  const key = () => (user ? `${baseKey}.${user}` : baseKey);
  const remembered = () => safe(() => storage?.getItem(key()) ?? null, null);

  const state = writable(valid(remembered()) ? (remembered() as string) : fallback);
  const apply = () => {
    if (target) target.dataset.theme = state.get();
  };
  apply();
  state.subscribe(apply);

  return {
    get: state.get,
    subscribe: state.subscribe,
    list: () => [...offered],
    set(id) {
      if (!valid(id)) return;
      state.set(id);
      safe(() => storage?.setItem(key(), id), undefined);
    },
    setUser(sub) {
      user = sub;
      const r = remembered();
      state.set(valid(r) ? r : fallback);
    },
  };
}
