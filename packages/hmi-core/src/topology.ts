/**
 * Energization of a single-line from what is measured, not from assumptions.
 *
 * A network is conductors (nodes) joined by edges: a switching device whose
 * position point says whether it conducts, or a fixed link (a transformer, a
 * busbar section) that always does. Some nodes have a voltage measurement
 * (a bus, a line end, a feeder cable): above a threshold, they are live.
 *
 * `energize` lights the measured live nodes and spreads that through every
 * edge that conducts. A switch in an unknown position (bad quality, no value)
 * stops the spread, and what lies beyond it becomes unknown rather than dead,
 * so the drawing never claims a circuit is dead when it cannot know.
 */

import type { PointId, PointValue } from "./model.ts";

/** Live, dead, or unknown (bad quality or an unknown switch on the way). */
export type Energized = boolean | null;

export interface NetworkEdge {
  a: string;
  b: string;
  /** Name for looking the edge up, usually the device's equipment id. */
  id?: string;
  /** Position point of the switching device; absent for a fixed link. */
  pos?: PointId;
}

export interface NetworkSource {
  /** Voltage point of the node. */
  point: PointId;
  /** Live above this value; defaults to `EnergizeOptions.liveAbove`. */
  liveAbove?: number;
}

export interface Network {
  nodes: readonly string[];
  edges: readonly NetworkEdge[];
  /** Measured nodes, by node. */
  sources: ReadonlyMap<string, NetworkSource>;
}

export interface EnergizeOptions {
  /** Whether a position value means the device conducts. Default: `1` (closed, in double-point coding). */
  conducts?: (value: number) => boolean;
  /** Default threshold for sources. Default 1 (for kV, anything above stray voltage). */
  liveAbove?: number;
}

/**
 * A small builder, so a project describes its wiring in one readable place:
 *
 *     const net = networkBuilder()
 *       .source("bus.a", "vds.sub.mv.a::v_kv")
 *       .device("bus.a", "f1.mid", "vds.sub.mv.a.f1.ds")
 *       .link("tr1.hv", "tr1.lv")
 *       .build();
 *
 * `device(a, b, equipment)` reads `<equipment>::pos`; pass a point id with
 * `::` to use another point. Draw `a` on the side the supply normally comes
 * from: `sides()` returns the pair in that order for the symbol's
 * `liveIn` / `liveOut`.
 */
export function networkBuilder() {
  const nodes = new Set<string>();
  const edges: NetworkEdge[] = [];
  const sources = new Map<string, NetworkSource>();
  const builder = {
    node(id: string) {
      nodes.add(id);
      return builder;
    },
    source(node: string, point: PointId, liveAbove?: number) {
      nodes.add(node);
      sources.set(node, liveAbove === undefined ? { point } : { point, liveAbove });
      return builder;
    },
    device(a: string, b: string, equipment: string) {
      nodes.add(a);
      nodes.add(b);
      const pos = (equipment.includes("::") ? equipment : `${equipment}::pos`) as PointId;
      edges.push({ a, b, id: equipment.split("::")[0] as string, pos });
      return builder;
    },
    link(a: string, b: string, id?: string) {
      nodes.add(a);
      nodes.add(b);
      edges.push(id ? { a, b, id } : { a, b });
      return builder;
    },
    build(): Network {
      return { nodes: [...nodes], edges: [...edges], sources: new Map(sources) };
    },
  };
  return builder;
}

/** Every point the energization depends on: the sources and every device position. */
export function networkPoints(net: Network): PointId[] {
  const ids = new Set<PointId>();
  for (const s of net.sources.values()) ids.add(s.point);
  for (const e of net.edges) if (e.pos) ids.add(e.pos);
  return [...ids];
}

/** The two nodes of an edge, in the order it was described (supply side first). */
export function sides(net: Network, id: string): [string, string] | undefined {
  const e = net.edges.find((x) => x.id === id);
  return e ? [e.a, e.b] : undefined;
}

const numeric = (v: PointValue | undefined): number | null =>
  v && v.quality === "good" && typeof v.value === "number" ? v.value : null;

/** Energization of every node. */
export function energize(net: Network, values: ReadonlyMap<PointId, PointValue>, options: EnergizeOptions = {}): Map<string, Energized> {
  const conducts = options.conducts ?? ((v: number) => v === 1);
  const defaultLive = options.liveAbove ?? 1;
  const state = new Map<string, Energized>(net.nodes.map((n) => [n, false]));

  const byNode = new Map<string, NetworkEdge[]>();
  for (const e of net.edges) {
    for (const n of [e.a, e.b]) byNode.set(n, [...(byNode.get(n) ?? []), e]);
  }

  const queue: string[] = [];
  for (const [node, source] of net.sources) {
    const v = numeric(values.get(source.point));
    if (v === null) state.set(node, null);
    else if (v > (source.liveAbove ?? defaultLive)) {
      state.set(node, true);
      queue.push(node);
    }
  }

  const edgeConducts = (e: NetworkEdge): boolean | null => {
    if (!e.pos) return true;
    const v = numeric(values.get(e.pos));
    return v === null ? null : conducts(v);
  };

  // Spread live through conducting edges; past an unknown one, a dead node becomes unknown.
  while (queue.length) {
    const node = queue.shift() as string;
    for (const e of byNode.get(node) ?? []) {
      const other = e.a === node ? e.b : e.a;
      const c = edgeConducts(e);
      if (c && state.get(other) !== true) {
        state.set(other, true);
        queue.push(other);
      } else if (c === null && state.get(other) === false) state.set(other, null);
    }
  }
  return state;
}
