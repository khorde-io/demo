/**
 * The menu tree and the routes. A route is a page plus, optionally, the
 * equipment whose faceplate is open on it: `#substation/vds.sub.mv.a.f1`.
 * Links to equipment can be shared and survive a reload.
 */

import { bayById, bayOfDevice, plant } from "./plant.ts";

export const PAGES = [
  { id: "overview", label: "Overview", level: "L1" },
  { id: "substation", label: "Substation", level: "L2" },
  { id: "windfarm", label: "Wind farm", level: "L2" },
  { id: "alarms", label: "Alarms", level: "L4" },
  { id: "events", label: "Event log", level: "L4" },
  { id: "trends", label: "Trends", level: "L4" },
  { id: "comms", label: "Comms", level: "L4" },
] as const;

const ALL_DEV_PAGES = [
  { id: "interlocks", label: "Interlock bench" },
  { id: "symbols", label: "Symbol sheet" },
  { id: "perf", label: "Performance bench" },
] as const;

/**
 * Whether this build has the development pages. A public deployment leaves
 * them out (`VITE_DEV_PAGES=false`): the performance bench can load the hub
 * with thousands of values a second.
 */
export const DEV_PAGES_ENABLED = import.meta.env.VITE_DEV_PAGES !== "false";

/** Development pages, reachable from the footer. */
export const DEV_PAGES: readonly (typeof ALL_DEV_PAGES)[number][] = DEV_PAGES_ENABLED ? ALL_DEV_PAGES : [];

export type PageId = (typeof PAGES)[number]["id"] | (typeof ALL_DEV_PAGES)[number]["id"];

export interface Route {
  page: PageId;
  /** Equipment id whose faceplate is open. */
  focus: string | null;
}

const KNOWN = new Set<string>([...PAGES, ...DEV_PAGES].map((p) => p.id));

export function parseRoute(hash: string): Route {
  const [page = "", ...rest] = hash.replace(/^#\/?/, "").split("/");
  const focus = rest.join("/") || null;
  return { page: KNOWN.has(page) ? (page as PageId) : "overview", focus: focus && focusOf(focus) ? focus : null };
}

export function routeHash(route: Route): string {
  return `#${route.page}${route.focus ? `/${route.focus}` : ""}`;
}

export type Focus =
  | { kind: "bay"; id: string; device: string | null }
  | { kind: "transformer"; id: string }
  | { kind: "turbine"; id: string };

/** What an equipment id opens: a turbine, a transformer, or a bay (from the bay or one of its devices). */
export function focusOf(id: string): Focus | null {
  if (plant.turbines.some((t) => t.id === id)) return { kind: "turbine", id };
  if (plant.transformers.some((t) => t.id === id)) return { kind: "transformer", id };
  if (bayById.has(id)) return { kind: "bay", id, device: null };
  const bay = bayOfDevice(id);
  return bay ? { kind: "bay", id: bay.id, device: id } : null;
}
