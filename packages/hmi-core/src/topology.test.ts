import { describe, expect, it } from "vitest";
import type { PointId, PointValue } from "./model.ts";
import { energize, networkBuilder, networkPoints, sides } from "./topology.ts";

const good = (value: number): PointValue => ({ id: "x::y" as PointId, value, type: "analogical", quality: "good", timestamp: new Date(0), stale: false });
const bad: PointValue = { id: "x::y" as PointId, value: null, type: null, quality: "bad", timestamp: null, stale: false };

/**
 *   grid ─[DS]─ mid ─[CB]─ bus ─(TR)─ lv ─[CB2]─ feeder
 *   grid is measured; so is the feeder cable.
 */
const net = networkBuilder()
  .source("grid", "line::v_kv" as PointId)
  .device("grid", "mid", "line.ds")
  .device("mid", "bus", "line.cb")
  .link("bus", "lv", "tr")
  .device("lv", "feeder", "f.cb")
  .source("feeder", "f::v_kv" as PointId)
  .build();

const values = (over: Record<string, PointValue>) =>
  new Map<PointId, PointValue>(
    Object.entries({
      "line::v_kv": good(138),
      "line.ds::pos": good(1),
      "line.cb::pos": good(1),
      "f.cb::pos": good(1),
      "f::v_kv": good(0),
      ...over,
    }) as [PointId, PointValue][],
  );

describe("energize", () => {
  it("spreads live from a measured source through closed switches and fixed links", () => {
    const e = energize(net, values({}));
    expect([...e]).toEqual([
      ["grid", true],
      ["mid", true],
      ["bus", true],
      ["lv", true],
      ["feeder", true],
    ]);
  });

  it("stops at an open switch", () => {
    const e = energize(net, values({ "line.cb::pos": good(0) }));
    expect(e.get("mid")).toBe(true);
    expect(e.get("bus")).toBe(false);
    expect(e.get("feeder")).toBe(false);
  });

  it("makes what lies past an unknown switch unknown, not dead", () => {
    const e = energize(net, values({ "line.cb::pos": bad }));
    expect(e.get("bus")).toBe(null);
    // Measured dead beyond the unknown switch stays dead.
    expect(e.get("feeder")).toBe(false);
  });

  it("trusts a measured live source even when the switches around it say otherwise", () => {
    const e = energize(net, values({ "line.cb::pos": good(0), "f::v_kv": good(34.5) }));
    expect(e.get("feeder")).toBe(true);
    expect(e.get("lv")).toBe(true);
    expect(e.get("bus")).toBe(true);
  });

  it("is unknown at a source with a bad measurement", () => {
    const e = energize(networkBuilder().source("bus", "b::v" as PointId).build(), new Map([["b::v" as PointId, bad]]));
    expect(e.get("bus")).toBe(null);
  });

  it("takes the project's switch coding and thresholds", () => {
    const coded = networkBuilder().source("a", "a::v" as PointId, 10).device("a", "b", "sw").build();
    const vs = new Map<PointId, PointValue>([
      ["a::v" as PointId, good(12)],
      ["sw::pos" as PointId, good(2)],
    ]);
    expect(energize(coded, vs).get("b")).toBe(false);
    expect(energize(coded, vs, { conducts: (v) => v === 2 }).get("b")).toBe(true);
    vs.set("a::v" as PointId, good(5));
    expect(energize(coded, vs, { conducts: (v) => v === 2 }).get("a")).toBe(false);
  });
});

describe("network helpers", () => {
  it("lists the points energization depends on, once each", () => {
    expect(networkPoints(net).sort()).toEqual(["f.cb::pos", "f::v_kv", "line.cb::pos", "line.ds::pos", "line::v_kv"]);
  });

  it("gives a device's two sides, supply side first", () => {
    expect(sides(net, "line.cb")).toEqual(["mid", "bus"]);
    expect(sides(net, "nope")).toBeUndefined();
  });
});
