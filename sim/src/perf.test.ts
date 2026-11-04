import { describe, expect, it } from "vitest";
import { agentConfigs } from "./agent-config.ts";
import { buildPlant } from "./plant.ts";
import { createPerfGenerator, perfAlarmPoints, perfAlarms, perfPoints, PERF_AGENT, PERF_ALARM_PERIOD_MS } from "./perf.ts";

describe("perf points", () => {
  it("are analog points on the wind farm agent, kept out of history", () => {
    const points = perfPoints(3);
    expect(points.map((p) => `${p.equipment}::${p.name}`)).toEqual(["perf.p0000::v", "perf.p0001::v", "perf.p0002::v"]);
    expect(points.every((p) => p.agent === PERF_AGENT && p.store === false)).toBe(true);
  });

  it("go into the agent config of the wind farm agent only", () => {
    const plant = buildPlant();
    const configs = agentConfigs({ ...plant, points: [...plant.points, ...perfPoints(10)] });
    expect(configs[PERF_AGENT].measurements.filter((m) => String(m.equipment).startsWith("perf.")).length).toBe(10);
    expect(configs[plant.agents.substation].measurements.some((m) => String(m.equipment).startsWith("perf."))).toBe(false);
  });
});

describe("perf alarms", () => {
  it("are digital alarms on their own points, outside what a value run watches", () => {
    const [alarm] = perfAlarms(1);
    expect(alarm?.agent).toBe(PERF_AGENT);
    expect(alarm?.config).toMatchObject({ type: "digital", area: "perfalarm.a0000", meas: "perfalarm.a0000::v", set: 1, reset: 0 });
    expect(perfAlarmPoints(1)[0]).toMatchObject({ equipment: "perfalarm.a0000", name: "v", type: "discrete", store: false });
  });
});

describe("perf generator", () => {
  it("sends every point once per period, each at its own phase and time", () => {
    let t = 0;
    const gen = createPerfGenerator({ now: () => t });
    gen.start(500, 1);
    const reports = [];
    for (t = 20; t <= 3000; t += 20) reports.push(...gen.tick(t));
    expect(reports.length).toBeGreaterThanOrEqual(1400);
    expect(reports.length).toBeLessThanOrEqual(1500);
    expect(new Set(reports.map((r) => r.at)).size).toBeGreaterThan(400);
    expect(reports.every((r) => r.at <= 3000)).toBe(true);
    expect(gen.status()?.sent).toBe(reports.length);
  });

  it("rejects runs it cannot do and stops cleanly", () => {
    const gen = createPerfGenerator({ max: 100 });
    expect(() => gen.start(101, 1)).toThrow("points must be an integer from 0 to 100");
    expect(() => gen.start(0, 1)).toThrow("a run needs points or alarms");
    expect(() => gen.start(10, 0)).toThrow("hz must be above 0");
    gen.start(10, 2);
    expect(gen.stop()?.points).toBe(10);
    expect(gen.tick(Date.now() + 5000)).toEqual([]);
  });

  it("raises and returns each alarm in turn, one change per period", () => {
    let t = 0;
    const gen = createPerfGenerator({ now: () => t });
    gen.start(0, 1, 50);
    const reports = [];
    for (t = 20; t <= 3 * PERF_ALARM_PERIOD_MS; t += 20) reports.push(...gen.tick(t));
    // Every alarm's phase falls in the first period, and three periods give it 2 or 3 changes.
    expect(reports.length).toBeGreaterThanOrEqual(100);
    expect(reports.length).toBeLessThanOrEqual(150);
    expect(gen.status()?.alarmChanges).toBe(reports.length);
    expect(gen.status()?.sent).toBe(0);
    const first = reports.find((r) => r.addr === "perfalarm.a0007.v");
    expect(first?.value).toBe(1);
    const values = reports.filter((r) => r.addr === "perfalarm.a0007.v").map((r) => r.value);
    expect(values.slice(0, 2)).toEqual([1, 0]);
  });

  it("returns what is still raised when stopped, once", () => {
    let t = 0;
    const gen = createPerfGenerator({ now: () => t, random: () => 0.5 });
    gen.start(0, 1, 3);
    expect(gen.drain()).toBe(null);
    t = 1100;
    expect(gen.tick(t).map((r) => r.value)).toEqual([1, 1, 1]);
    gen.stop();
    expect(gen.drain()?.map((r) => [r.addr, r.value])).toEqual([
      ["perfalarm.a0000.v", 0],
      ["perfalarm.a0001.v", 0],
      ["perfalarm.a0002.v", 0],
    ]);
    expect(gen.drain()).toBe(null);
  });
});
