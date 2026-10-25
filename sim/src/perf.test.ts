import { describe, expect, it } from "vitest";
import { agentConfigs } from "./agent-config.ts";
import { buildPlant } from "./plant.ts";
import { createPerfGenerator, perfPoints, PERF_AGENT } from "./perf.ts";

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
    expect(() => gen.start(101, 1)).toThrow("points must be an integer from 1 to 100");
    expect(() => gen.start(10, 0)).toThrow("hz must be above 0");
    gen.start(10, 2);
    expect(gen.stop()?.points).toBe(10);
    expect(gen.tick(Date.now() + 5000)).toEqual([]);
  });
});
