// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createPointStore, networkBuilder, syncScheduler, type PointId } from "@khorde/hmi-core";
import { createMockBackend } from "@khorde/hmi-core/mock";
import { mount } from "../test-dom.tsx";
import { useEnergization } from "./useEnergization.ts";

// bus ─[CB]─ feeder; the bus is measured.
const net = networkBuilder().source("bus", "b::v_kv" as PointId).device("bus", "feeder", "f.cb").build();

function Probe() {
  const e = useEnergization(net);
  return <span>{["bus", "feeder"].map((n) => `${n}=${String(e(n))}`).join(" ")}</span>;
}

describe("useEnergization", () => {
  it("follows the live values of the network's sources and switches", async () => {
    const backend = createMockBackend({
      points: [
        { equipment: "b", name: "v_kv", type: "analogical", value: 34.5 },
        { equipment: "f.cb", name: "pos", type: "discrete", value: 1 },
      ],
    });
    const points = createPointStore(backend, { scheduler: syncScheduler, debounceMs: 0 });
    const m = await mount(<Probe />, { backend, points });
    await m.settle(20);
    expect(m.container.textContent).toBe("bus=true feeder=true");

    await act(async () => backend.publish("f.cb::pos" as PointId, 0));
    await m.settle(20);
    expect(m.container.textContent).toBe("bus=true feeder=false");

    await act(async () => backend.publish("f.cb::pos" as PointId, 1, { quality: "bad" }));
    await m.settle(20);
    expect(m.container.textContent).toBe("bus=true feeder=null");
    m.unmount();
  });
});
