import { describe, expect, it } from "vitest";
import { createMockBackend } from "@khorde/hmi-core/mock";
import type { PointId } from "@khorde/hmi-core";
import { plant } from "../plant.ts";
import { analogCondition, createAlarmEngine } from "./alarmEngine.ts";
import { startMockSite } from "./mockSite.ts";

const OIL = { high: { value: 75, severity: "medium" as const, deadband: 2 }, high_high: { value: 90, severity: "high" as const, deadband: 2 } };

describe("analog alarm conditions", () => {
  it("picks the worst limit and holds it within the deadband", () => {
    expect(analogCondition(OIL, 70, null)).toBe(null);
    expect(analogCondition(OIL, 76, null)).toBe("high");
    expect(analogCondition(OIL, 91, "high")).toBe("high_high");
    expect(analogCondition(OIL, 88.5, "high_high")).toBe("high_high");
    expect(analogCondition(OIL, 87.9, "high_high")).toBe("high");
    expect(analogCondition(OIL, 73.5, "high")).toBe("high");
    expect(analogCondition(OIL, 72.9, "high")).toBe(null);
  });
});

describe("alarm engine", () => {
  it("raises, moves and resets alarms as values change", () => {
    const backend = createMockBackend({ points: [{ equipment: "vds.sub.tr2", name: "oil_temp", type: "analogical", value: 60 }] });
    const engine = createAlarmEngine([{ type: "analog", name: "sub_tr2_oil_temp", area: "vds.sub.tr2", meas: "vds.sub.tr2::oil_temp", conditions: OIL }], backend);
    const read = (id: PointId) => backend.value(id);
    engine.evaluate(read);
    expect(engine.active().size).toBe(0);
    backend.publish("vds.sub.tr2::oil_temp", 80);
    engine.evaluate(read);
    expect(engine.active().get("sub_tr2_oil_temp")).toBe("high");
    backend.publish("vds.sub.tr2::oil_temp", 95);
    engine.evaluate(read);
    expect(engine.active().get("sub_tr2_oil_temp")).toBe("high_high");
    backend.publish("vds.sub.tr2::oil_temp", 60);
    engine.evaluate(read);
    expect(engine.active().size).toBe(0);
  });

  it("holds the state while the value is bad", () => {
    const backend = createMockBackend({ points: [{ equipment: "x", name: "trip", type: "discrete", value: 1 }] });
    const engine = createAlarmEngine([{ type: "digital", name: "x_trip", area: "x", meas: "x::trip", set: 1, reset: 0, severity: "high" }], backend);
    engine.evaluate((id) => backend.value(id));
    backend.publish("x::trip", 0, { quality: "bad" });
    engine.evaluate((id) => backend.value(id));
    expect(engine.active().get("x_trip")).toBe("set");
  });
});

describe("mock site", () => {
  it("runs the simulator behind the mock backend, alarms included", async () => {
    const site = startMockSite(plant, { tickMs: 60_000, scenario: "normal" });
    try {
      expect(site.backend.value("vds.sub.hv.bus::v_kv")?.value).toBeGreaterThan(130);
      site.scenario("tr1-trip");
      // Discrete changes reach the backend after the field's event delay.
      await new Promise((r) => setTimeout(r, 700));
      const active = await site.backend.activeAlarms();
      expect(active.map((a) => a.name)).toEqual(expect.arrayContaining(["sub_tr1_buchholz", "sub_hv_tr1_cb_trip", "sub_mv_a_tr1_cb_trip"]));
      expect(site.backend.value("vds.sub.hv.tr1.cb::pos")?.value).toBe(0);
      // Reports carry their own times: the trip changes are not all stamped alike.
      const stamps = ["vds.sub.hv.tr1.cb::pos", "vds.sub.mv.a.tr1.cb::pos", "vds.sub.tr1::buchholz"].map((id) => site.backend.value(id as PointId)?.timestamp.getTime());
      expect(new Set(stamps).size).toBeGreaterThan(1);
    } finally {
      site.stop();
    }
  });
});
