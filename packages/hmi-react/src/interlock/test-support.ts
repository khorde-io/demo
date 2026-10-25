/** Shared by the interlock tests. Not exported from the package. */

import { readFileSync } from "node:fs";
import { coreMessages, createI18n, type InterlockDetail, type NodeState, type PointId, type PointValue } from "@khorde/hmi-core";

/** commandInterlockDetail from the demo hub: bus coupler close, both incomers closed. */
export const COUPLER: InterlockDetail = JSON.parse(
  readFileSync(new URL("../../../hmi-core/test-data/interlock-detail.bus-coupler.json", import.meta.url), "utf8"),
);

/** The coupler detail with TR1's incomer open: the first OR branch now permits. */
export function couplerWithTr1Open(): InterlockDetail {
  const set: Record<string, NodeState> = { $: "PERMIT", "$.and.3": "PERMIT", "$.and.3.or.0": "PERMIT" };
  return { ...COUPLER, outcome: "PERMIT", nodeStates: COUPLER.nodeStates.map((n) => ({ ...n, state: set[n.path] ?? n.state })) };
}

export const i18n = createI18n({
  locale: "en",
  catalogs: {
    en: [
      { messages: coreMessages },
      {
        equipment: {
          "vds.sub.mv.bc.cb": "Coupler CB",
          "vds.sub.mv.bc.ds_a": "DS A",
          "vds.sub.mv.bc.ds_b": "DS B",
          "vds.sub.mv.a.tr1.cb": "TR1 incomer",
          "vds.sub.mv.b.tr2.cb": "TR2 incomer",
          "vds.sub.mv.a.f1": "F1",
        },
        states: {
          "**::pos": { "0": "Open", "1": "Closed", "2": "Intermediate", "3": "Invalid" },
          "**::remote_local": { "0": "Local", "1": "Remote" },
        },
        points: { "**::remote_local": "Control", "**::v_kv": "Voltage" },
        units: { "**::v_kv": "kV" },
      },
    ],
  },
});

export function value(id: PointId, v: number, quality: "good" | "bad" = "good"): PointValue {
  return { id, value: v, type: "discrete", quality, timestamp: new Date(0), stale: false };
}
