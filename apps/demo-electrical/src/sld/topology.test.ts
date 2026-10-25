import { describe, expect, it } from "vitest";
import type { PointId, PointValue } from "@khorde/hmi-core";
import { buildPlant } from "@khorde/demo-plant";
import { buildNetwork, energize, networkPoints } from "./topology.ts";

const plant = buildPlant();
const net = buildNetwork(plant);
const good = (value: number): PointValue => ({ value, quality: "good", timestamp: new Date(0) }) as PointValue;

/** The normal plant: everything closed except the coupler and spare, grid and buses live. */
function normal(over: Record<string, number | null> = {}): Map<PointId, PointValue> {
  const values = new Map<PointId, PointValue>();
  for (const p of plant.points) {
    if (p.name === "pos" || p.name === "v_kv") values.set(`${p.equipment}::${p.name}` as PointId, good(p.initial));
  }
  values.set("vds.sub.mv.a.f1::v_kv" as PointId, good(34.5));
  for (const [id, v] of Object.entries(over)) {
    if (v === null) values.set(id as PointId, { value: 0, quality: "bad", timestamp: new Date(0) } as PointValue);
    else values.set(id as PointId, good(v));
  }
  return values;
}

describe("energize", () => {
  it("lights everything connected to a live bus or line", () => {
    const e = energize(net, normal());
    expect(e.get("vds.sub.hv.bus")).toBe(true);
    expect(e.get("vds.sub.hv.l1.mid")).toBe(true);
    expect(e.get("vds.sub.mv.a.f1.out")).toBe(true);
    expect(e.get("vds.sub.mv.a.tr1.out")).toBe(true);
    // The coupler breaker is open: only its bus A side is live... and its B side from bus B.
    expect(e.get("vds.sub.mv.bc.mid")).toBe(true);
    expect(e.get("vds.sub.mv.b.spare.mid")).toBe(false);
  });

  it("goes dead past an open breaker", () => {
    const e = energize(net, normal({ "vds.sub.mv.a.f1.cb::pos": 0, "vds.sub.mv.a.f1::v_kv": 0 }));
    expect(e.get("vds.sub.mv.a.f1.mid")).toBe(true);
    expect(e.get("vds.sub.mv.a.f1.out")).toBe(false);
  });

  it("is unknown past a switch in an unknown position", () => {
    const e = energize(net, normal({ "vds.sub.mv.a.f1.cb::pos": null, "vds.sub.mv.a.f1::v_kv": 0 }));
    expect(e.get("vds.sub.mv.a.f1.out")).toBe(null);
  });

  it("feeds bus A from TR2 through the coupler after a TR1 trip", () => {
    const e = energize(
      net,
      normal({ "vds.sub.hv.tr1.cb::pos": 0, "vds.sub.mv.a.tr1.cb::pos": 0, "vds.sub.mv.a::v_kv": 0, "vds.sub.mv.bc.cb::pos": 1 }),
    );
    expect(e.get("vds.sub.mv.a")).toBe(true);
    expect(e.get("vds.sub.hv.tr1.out")).toBe(false);
  });

  it("depends on the sources and every switch position", () => {
    const ids = networkPoints(net);
    expect(ids).toContain("vds.sub.mv.bc.ds_b::pos");
    expect(ids).toContain("vds.sub.hv.l1::v_kv");
  });
});
