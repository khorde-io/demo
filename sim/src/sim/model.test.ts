import { describe, expect, it } from "vitest";
import { buildPlant, RATED_KW, SWITCH, TURBINE } from "../plant.ts";
import { createSimulation, powerCurve } from "./model.ts";

const plant = buildPlant();

/** A clean plant after a minute of simulated time. */
function running() {
  const sim = createSimulation(plant, { seed: 7, thermalSpeed: 1, travelS: 0.5 });
  sim.scenario("normal");
  for (let i = 0; i < 60; i++) sim.step(1);
  return sim;
}

const run = (sim: ReturnType<typeof createSimulation>, s: number) => {
  for (let i = 0; i < s; i++) sim.step(1);
};

describe("power curve", () => {
  it("is zero below cut-in and above cut-out, rated in between", () => {
    expect(powerCurve(2.9)).toBe(0);
    expect(powerCurve(25)).toBe(0);
    expect(powerCurve(12)).toBe(RATED_KW);
    expect(powerCurve(7)).toBeGreaterThan(0);
    expect(powerCurve(7)).toBeLessThan(RATED_KW);
  });
});

describe("simulation", () => {
  it("energizes the plant and exports the farm's power", () => {
    const sim = running();
    expect(sim.get("vds.sub.hv.bus::v_kv")).toBeGreaterThan(130);
    expect(sim.get("vds.sub.mv.a::v_kv")).toBeGreaterThan(33);
    expect(sim.get("vds.sub.mv.b::v_kv")).toBeGreaterThan(33);
    const farmKw = plant.turbines.reduce((s, t) => s + sim.get(`${t.id}::p_kw`), 0);
    expect(farmKw).toBeGreaterThan(0);
    // The line carries what the feeders bring, less aux load and losses.
    expect(sim.get("vds.sub.hv.l1::p_mw")).toBeGreaterThan((farmKw / 1000) * 0.9);
    expect(sim.get("vds.sub.hv.l1::p_mw")).toBeLessThanOrEqual(farmKw / 1000);
  });

  it("trips TR1 on a Buchholz alarm and loses bus A until the coupler closes", () => {
    const sim = running();
    sim.scenario("tr1-trip");
    run(sim, 2);
    expect(sim.get("vds.sub.hv.tr1.cb::pos")).toBe(SWITCH.open);
    expect(sim.get("vds.sub.hv.tr1.cb::trip")).toBe(1);
    expect(sim.get("vds.sub.mv.a.tr1.cb::pos")).toBe(SWITCH.open);
    expect(sim.get("vds.sub.mv.a::v_kv")).toBe(0);
    expect(sim.get("vds.sub.mv.a.f1::p_mw")).toBe(0);
    expect(sim.get("vds.sub.mv.b::v_kv")).toBeGreaterThan(33);

    expect(sim.command({ equipment: "vds.sub.mv.bc.cb", name: "pos.close", value: null })).toEqual({ ok: true });
    expect(sim.get("vds.sub.mv.bc.cb::pos")).toBe(SWITCH.intermediate);
    run(sim, 2);
    expect(sim.get("vds.sub.mv.bc.cb::pos")).toBe(SWITCH.closed);
    expect(sim.get("vds.sub.mv.a::v_kv")).toBeGreaterThan(33);
    // Bus A's export now crosses the coupler towards TR2 (B to A is positive).
    expect(sim.get("vds.sub.mv.bc::p_mw")).toBeLessThan(0);
  });

  it("opens a feeder breaker on command and de-energizes its turbines", () => {
    const sim = running();
    expect(sim.command({ equipment: "vds.sub.mv.a.f1.cb", name: "pos.open", value: null }).ok).toBe(true);
    run(sim, 2);
    expect(sim.get("vds.sub.mv.a.f1.cb::pos")).toBe(SWITCH.open);
    expect(sim.get("vds.sub.mv.a.f1::p_mw")).toBe(0);
    for (const t of plant.turbines.filter((x) => x.feeder === "vds.sub.mv.a.f1")) {
      expect(sim.get(`${t.id}::state`)).toBe(TURBINE.waiting);
      expect(sim.get(`${t.id}::p_kw`)).toBe(0);
    }
  });

  it("refuses unknown commands and taps past the end of the range", () => {
    const sim = running();
    expect(sim.command({ equipment: "vds.sub.mv.a.f1.cb", name: "explode", value: null })).toMatchObject({ ok: false, status: 404 });
    for (let i = 0; i < 20; i++) sim.command({ equipment: "vds.sub.tr1", name: "tap.raise", value: null });
    expect(sim.get("vds.sub.tr1::tap")).toBe(17);
    expect(sim.command({ equipment: "vds.sub.tr1", name: "tap.raise", value: null })).toMatchObject({ ok: false, status: 409 });
  });

  it("handles turbine start, stop, reset and curtailment", () => {
    const sim = running();
    const t = plant.turbines[0]!;
    expect(sim.command({ equipment: t.id, name: "stop", value: null }).ok).toBe(true);
    run(sim, 1);
    expect(sim.get(`${t.id}::state`)).toBe(TURBINE.stopped);
    expect(sim.get(`${t.id}::p_kw`)).toBe(0);
    expect(sim.command({ equipment: t.id, name: "reset", value: null })).toMatchObject({ ok: false, status: 409 });
    expect(sim.command({ equipment: t.id, name: "start", value: null }).ok).toBe(true);
    expect(sim.command({ equipment: t.id, name: "curtail.setpoint", value: 500 }).ok).toBe(true);
    run(sim, 2);
    expect(sim.get(`${t.id}::p_kw`)).toBeLessThanOrEqual(500);
  });

  it("freezes a silent turbine and marks its values bad", () => {
    const sim = running();
    sim.scenario("comms-loss");
    const t22 = plant.turbines.find((t) => t.number === 22)!;
    const bad = sim.samples().filter((s) => !s.quality);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.every((s) => s.addr.startsWith(`${t22.id}.`))).toBe(true);
    expect(sim.get(`${t22.id}::comm`)).toBe(0);
    expect(sim.command({ equipment: t22.id, name: "stop", value: null })).toMatchObject({ ok: false, status: 409 });
    sim.scenario("comms-restore");
    expect(sim.samples().every((s) => s.quality)).toBe(true);
  });

  it("emits one sample per configured point", () => {
    const sim = running();
    expect(sim.samples()).toHaveLength(plant.points.length);
  });
});
