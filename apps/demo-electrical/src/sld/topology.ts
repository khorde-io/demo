/**
 * Which parts of the single-line are energized, from what is measured: buses,
 * the line and feeder cables with a voltage above a threshold are live, and
 * the colouring spreads from them through closed switches. A switch in an
 * unknown position stops it, and what lies beyond is unknown rather than dead.
 *
 * The plant's connections are listed once, as nodes (conductors) and edges
 * (switches and transformers), from the plant description.
 */

import { pointId, type PointId, type PointValue } from "@khorde/hmi-core";
import type { Bay, Plant } from "@khorde/demo-plant";

export interface Edge {
  a: string;
  b: string;
  /** Switching device id; absent for a transformer, which always conducts. */
  device?: string;
}

export interface Network {
  nodes: string[];
  edges: Edge[];
  /** Voltage point that tells a node is live, by node. */
  sources: Map<string, PointId>;
  /** The node on each side of a device, top side first as drawn. */
  sides: Map<string, [string, string]>;
}

export type Energized = boolean | null;

/** Nodes of a bay: `<bay>.mid` between its switches and `<bay>.out` past its breaker. */
export const mid = (bay: Bay) => `${bay.id}.mid`;
export const out = (bay: Bay) => `${bay.id}.out`;

const BUS_NODE: Record<Bay["bus"], string> = { hv: "vds.sub.hv.bus", a: "vds.sub.mv.a", b: "vds.sub.mv.b" };

export function buildNetwork(plant: Plant): Network {
  const nodes = new Set<string>();
  const edges: Edge[] = [];
  const sources = new Map<string, PointId>();
  const sides = new Map<string, [string, string]>();
  const link = (a: string, b: string, device?: string) => {
    nodes.add(a);
    nodes.add(b);
    edges.push(device ? { a, b, device } : { a, b });
    if (device) sides.set(device, [a, b]);
  };

  for (const bus of plant.buses) {
    nodes.add(bus.id);
    sources.set(bus.id, pointId(bus.id, "v_kv"));
  }
  for (const bay of plant.bays) {
    const bus = BUS_NODE[bay.bus];
    switch (bay.kind) {
      case "line":
        // Drawn from the grid down: line, disconnector, breaker, bus.
        link(out(bay), mid(bay), bay.ds);
        link(mid(bay), bus, bay.cb);
        sources.set(out(bay), pointId(bay.id, "v_kv"));
        break;
      case "coupler":
        link(bus, mid(bay), bay.ds);
        link(mid(bay), `${bay.id}.b`, bay.cb);
        link(`${bay.id}.b`, BUS_NODE.b, bay.dsB);
        break;
      case "incomer":
        // Drawn from the transformer down: breaker, disconnector, bus.
        link(out(bay), mid(bay), bay.cb);
        link(mid(bay), bus, bay.ds);
        break;
      default:
        // Bus first: disconnector, breaker, then the circuit.
        link(bus, mid(bay), bay.ds);
        link(mid(bay), out(bay), bay.cb);
        if (bay.kind === "feeder") sources.set(out(bay), pointId(bay.id, "v_kv"));
    }
  }
  for (const tr of plant.transformers) {
    const hv = plant.bays.find((b) => b.id === tr.hvBay);
    const lv = plant.bays.find((b) => b.id === tr.lvBay);
    if (hv && lv) link(out(hv), out(lv));
  }
  return { nodes: [...nodes], edges, sources, sides };
}

/** Points the energization depends on. */
export function networkPoints(net: Network): PointId[] {
  return [...net.sources.values(), ...net.edges.flatMap((e) => (e.device ? [pointId(e.device, "pos")] : []))];
}

const isLive = (v: PointValue | undefined, kv: number) => (v && v.quality === "good" && typeof v.value === "number" ? v.value > kv : null);

/** Energization of every node. `liveKv` is the threshold for "live". */
export function energize(net: Network, values: ReadonlyMap<PointId, PointValue>, liveKv = 1): Map<string, Energized> {
  const state = new Map<string, Energized>(net.nodes.map((n) => [n, false]));
  const queue: string[] = [];
  for (const [node, id] of net.sources) {
    const live = isLive(values.get(id), liveKv);
    if (live) {
      state.set(node, true);
      queue.push(node);
    } else if (live === null) state.set(node, null);
  }
  const conducts = (e: Edge): boolean | null => {
    if (!e.device) return true;
    const v = values.get(pointId(e.device, "pos"));
    if (!v || v.quality !== "good") return null;
    return v.value === 1;
  };
  // Spread live through closed switches; past an unknown one, a dead node becomes unknown.
  while (queue.length) {
    const node = queue.shift() as string;
    for (const e of net.edges) {
      if (e.a !== node && e.b !== node) continue;
      const other = e.a === node ? e.b : e.a;
      const c = conducts(e);
      if (c && state.get(other) !== true) {
        state.set(other, true);
        queue.push(other);
      } else if (c === null && state.get(other) === false) state.set(other, null);
    }
  }
  return state;
}
