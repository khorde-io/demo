/** A small feeder bay used across the tests. Not exported from the package. */

import type { MockBackendOptions } from "./mock/backend.ts";

export const AGENT = "vds-substation";

export const CB = { agent: AGENT, equipment: "vds.sub.f1.cb", name: "pos.open" };
export const CB_CLOSE = { agent: AGENT, equipment: "vds.sub.f1.cb", name: "pos.close" };
export const ES_CLOSE = { agent: AGENT, equipment: "vds.sub.f1.es", name: "pos.close" };
export const TR_TAP = { agent: AGENT, equipment: "vds.sub.tr1", name: "tap.setpoint" };

export function feederBay(overrides: Partial<MockBackendOptions> = {}): MockBackendOptions {
  return {
    agents: [AGENT],
    sites: ["vds-leaf"],
    stepMs: 1,
    points: [
      { equipment: "vds.sub.f1.cb", name: "pos", type: "discrete", value: 1, agent: AGENT },
      { equipment: "vds.sub.f1.cb", name: "remote_local", type: "discrete", value: 1, agent: AGENT },
      { equipment: "vds.sub.f1.ds", name: "pos", type: "discrete", value: 1, agent: AGENT },
      { equipment: "vds.sub.f1.es", name: "pos", type: "discrete", value: 0, agent: AGENT },
      { equipment: "vds.sub.f1", name: "v_kv", type: "analogical", value: 34.6, agent: AGENT },
      { equipment: "vds.sub.f1", name: "p_mw", type: "analogical", value: 20.8, agent: AGENT, tags: ["power"] },
      { equipment: "vds.sub.tr1", name: "tap", type: "discrete", value: 9, agent: AGENT },
      { equipment: "vds.wf.f1.t01", name: "p_kw", type: "analogical", value: 3520, agent: "vds-windfarm" },
    ],
    commands: [
      { ...CB },
      { ...CB_CLOSE, interlock: "f1_cb_close_safe" },
      { ...ES_CLOSE, interlock: "f1_es_close_safe" },
      { ...TR_TAP },
    ],
    interlocks: {
      f1_cb_close_safe: {
        description: "Close the breaker only with the earthing switch open",
        expression: { eq: ["vds.sub.f1.es::pos", 0] },
      },
      f1_es_close_safe: {
        description: "Close the earthing switch only when the feeder is isolated and dead",
        expression: {
          and: [{ eq: ["vds.sub.f1.cb::remote_local", 1] }, { eq: ["vds.sub.f1.ds::pos", 0] }, { lt: ["vds.sub.f1::v_kv", 1] }],
        },
      },
    },
    ...overrides,
  };
}

export const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
