/**
 * How Ventos da Serra is wired, for the single-line's energization: which
 * conductors each switching device and transformer joins, and which
 * conductors have a voltage measurement. The engine that works out what is
 * live is in the library (`networkBuilder` / `energize` in hmi-core,
 * `useEnergization` in hmi-react); this file is only the plant.
 *
 * Each device is described supply side first, matching how the single-line
 * draws it, so `sides()` gives its `liveIn` / `liveOut` in order.
 */

import { networkBuilder, pointId, type Network } from "@khorde/hmi-core";
import type { Bay, Plant } from "@khorde/demo-plant";

/** Nodes of a bay: `<bay>.mid` between its switches and `<bay>.out` past its breaker. */
export const mid = (bay: Bay) => `${bay.id}.mid`;
export const out = (bay: Bay) => `${bay.id}.out`;

const BUS_NODE: Record<Bay["bus"], string> = { hv: "vds.sub.hv.bus", a: "vds.sub.mv.a", b: "vds.sub.mv.b" };

export function buildNetwork(plant: Plant): Network {
  const net = networkBuilder();
  for (const bus of plant.buses) net.source(bus.id, pointId(bus.id, "v_kv"));

  for (const bay of plant.bays) {
    const bus = BUS_NODE[bay.bus];
    switch (bay.kind) {
      case "line":
        // Drawn from the grid down: line, disconnector, breaker, bus.
        net.device(out(bay), mid(bay), bay.ds).device(mid(bay), bus, bay.cb).source(out(bay), pointId(bay.id, "v_kv"));
        break;
      case "coupler":
        net.device(bus, mid(bay), bay.ds).device(mid(bay), `${bay.id}.b`, bay.cb).device(`${bay.id}.b`, BUS_NODE.b, bay.dsB as string);
        break;
      case "incomer":
        // Drawn from the transformer down: breaker, disconnector, bus.
        net.device(out(bay), mid(bay), bay.cb).device(mid(bay), bus, bay.ds);
        break;
      default:
        // Bus first: disconnector, breaker, then the circuit.
        net.device(bus, mid(bay), bay.ds).device(mid(bay), out(bay), bay.cb);
        if (bay.kind === "feeder") net.source(out(bay), pointId(bay.id, "v_kv"));
    }
  }

  for (const tr of plant.transformers) {
    const hv = plant.bays.find((b) => b.id === tr.hvBay);
    const lv = plant.bays.find((b) => b.id === tr.lvBay);
    if (hv && lv) net.link(out(hv), out(lv), tr.id);
  }
  return net.build();
}
