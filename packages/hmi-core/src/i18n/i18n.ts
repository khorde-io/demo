/**
 * Every text on screen comes from a dictionary in the frontend; the API sends
 * only identifiers and values. A catalog holds, per language:
 *
 * - `messages`: nested keys (`alarm.state.Set`), with `{param}` placeholders;
 *   alarm texts live under `alarms.<alarm name>.<condition>`.
 * - `equipment`: display names by equipment id (`vds.sub.tr1` → "TR1").
 * - `states`: labels for discrete values, by point pattern. `*` matches one
 *   equipment segment, `**` any number; the name may be `*`. The most specific
 *   pattern wins: `{"**.cb::pos": {"0": "Open", "1": "Closed"}}`.
 *
 * Catalogs are layered: the library's first, the project's after it, so a
 * project can override any library text.
 */

import type { Alarm, PointId, PointRawValue } from "../model.ts";
import { writable, type Readable } from "../store.ts";

export interface Dictionary {
  [key: string]: string | Dictionary;
}

/** Same shape as `T`, every leaf a string: use it to type a translation. */
export type Translation<T> = { -readonly [K in keyof T]: T[K] extends string ? string : Translation<T[K]> };

export interface Catalog {
  messages?: Dictionary;
  equipment?: Record<string, string>;
  states?: Record<string, Record<string, string>>;
}

export interface I18nOptions {
  locale: string;
  fallbackLocale?: string;
  /** Per locale, layered in order (later layers override earlier ones). */
  catalogs: Record<string, readonly Catalog[]>;
  onMissing?(key: string, locale: string): void;
}

export interface I18n {
  readonly locale: Readable<string>;
  setLocale(locale: string): void;
  locales(): string[];
  t(key: string, params?: Record<string, string | number>): string;
  has(key: string): boolean;
  equipmentName(equipment: string): string;
  /** Label for a discrete value of a point, or null when none is defined. */
  stateLabel(id: PointId, value: PointRawValue): string | null;
  alarmText(alarm: Pick<Alarm, "name" | "condition">): string;
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  formatDateTime(value: Date, options?: Intl.DateTimeFormatOptions): string;
}

function lookup(dict: Dictionary | undefined, key: string): string | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

function matchSegments(pattern: readonly string[], segs: readonly string[]): boolean {
  if (pattern.length === 0) return segs.length === 0;
  const [head, ...rest] = pattern;
  if (head === "**") {
    for (let i = 0; i <= segs.length; i++) if (matchSegments(rest, segs.slice(i))) return true;
    return false;
  }
  if (segs.length === 0) return false;
  return (head === "*" || head === segs[0]) && matchSegments(rest, segs.slice(1));
}

/** Whether a state pattern (`**.cb::pos`) matches a point id; returns its specificity or -1. */
export function statePatternScore(pattern: string, id: string): number {
  const [pe, pn] = pattern.split("::");
  const at = id.lastIndexOf("::");
  const eq = id.slice(0, at);
  const name = id.slice(at + 2);
  if (pe === undefined || pn === undefined) return -1;
  if (pn !== "*" && pn !== name) return -1;
  const pSegs = pe.split(".");
  if (!matchSegments(pSegs, eq.split("."))) return -1;
  return pSegs.filter((s) => s !== "*" && s !== "**").length * 2 + (pn === "*" ? 0 : 1);
}

export function createI18n(options: I18nOptions): I18n {
  const fallback = options.fallbackLocale ?? "en";
  const locale = writable(options.locale);
  const reported = new Set<string>();

  const layers = (loc: string) => [...(options.catalogs[loc] ?? [])].reverse();

  const find = <T>(pick: (c: Catalog) => T | undefined): T | undefined => {
    for (const loc of [locale.get(), fallback]) {
      for (const c of layers(loc)) {
        const v = pick(c);
        if (v !== undefined) return v;
      }
    }
    return undefined;
  };

  const missing = (key: string) => {
    const tag = `${locale.get()}:${key}`;
    if (reported.has(tag)) return;
    reported.add(tag);
    options.onMissing?.(key, locale.get());
  };

  const t = (key: string, params?: Record<string, string | number>) => {
    const text = find((c) => lookup(c.messages, key));
    if (text === undefined) {
      missing(key);
      return key;
    }
    return interpolate(text, params);
  };

  return {
    locale,
    setLocale: (l) => locale.set(l),
    locales: () => Object.keys(options.catalogs),
    t,
    has: (key) => find((c) => lookup(c.messages, key)) !== undefined,

    equipmentName: (equipment) => find((c) => c.equipment?.[equipment]) ?? equipment,

    stateLabel(id, value) {
      if (value === null) return null;
      const v = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
      for (const loc of [locale.get(), fallback]) {
        let bestScore = -1;
        let bestLabel: string | null = null;
        for (const c of layers(loc)) {
          for (const [pattern, labels] of Object.entries(c.states ?? {})) {
            const label = labels[v];
            if (label === undefined) continue;
            const score = statePatternScore(pattern, id);
            if (score > bestScore) {
              bestScore = score;
              bestLabel = label;
            }
          }
        }
        if (bestLabel !== null) return bestLabel;
      }
      return null;
    },

    alarmText(alarm) {
      const key = `alarms.${alarm.name}.${alarm.condition}`;
      const text = find((c) => lookup(c.messages, key)) ?? find((c) => lookup(c.messages, `alarms.${alarm.name}._`));
      if (text !== undefined) return text;
      missing(key);
      return `${alarm.name} · ${alarm.condition}`;
    },

    formatNumber: (value, opts) => new Intl.NumberFormat(locale.get(), opts).format(value),
    formatDateTime: (value, opts) => new Intl.DateTimeFormat(locale.get(), opts).format(value),
  };
}
