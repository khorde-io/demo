import { energize, networkPoints, type EnergizeOptions, type Energized, type Network } from "@khorde/hmi-core";
import { useMemo } from "react";
import { usePointValues } from "../context.tsx";

/**
 * Live energization of a network (built with `networkBuilder` from
 * hmi-core): watches its sources and switch positions and returns a lookup
 * by node, for the `energized` / `liveIn` / `liveOut` props of the symbols.
 * Build the network once, outside the component; options are read when a
 * value changes.
 */
export function useEnergization(net: Network, options?: EnergizeOptions): (node: string) => Energized {
  const points = useMemo(() => networkPoints(net), [net]);
  const values = usePointValues(points);
  const conducts = options?.conducts;
  const liveAbove = options?.liveAbove;
  return useMemo(() => {
    const state = energize(net, values, { ...(conducts ? { conducts } : {}), ...(liveAbove !== undefined ? { liveAbove } : {}) });
    return (node: string) => state.get(node) ?? null;
  }, [net, values, conducts, liveAbove]);
}
