/**
 * The whole demo plant in the browser: the simulator from sim/ drives the mock
 * backend, its commands go to the simulator, and the alarm definitions of the
 * agent config are evaluated here the way the hub would. Lets the demo run
 * with no hub, with the same behaviour as against the REST agents.
 */

import { pointId, type PointId } from "@khorde/hmi-core";
import { createMockBackend, type MockBackend } from "@khorde/hmi-core/mock";
import type { Plant } from "@khorde/demo-plant";
import { createSimulation, type Scenario, type Simulation } from "@khorde/demo-plant/sim";
import { createAlarmEngine } from "./alarmEngine.ts";
import { mockPlant } from "./mockPlant.ts";

export interface MockSite {
  backend: MockBackend;
  sim: Simulation;
  scenario(name: Scenario): void;
  stop(): void;
}

export function startMockSite(plant: Plant, options: { tickMs?: number; scenario?: Scenario; thermalSpeed?: number } = {}): MockSite {
  const tickMs = options.tickMs ?? 1000;
  const sim = createSimulation(plant, { seed: Date.now() & 0xffff, thermalSpeed: options.thermalSpeed ?? 10 });
  const backend = createMockBackend({
    ...mockPlant(plant),
    onCommand: ({ key, value }) => sim.command({ equipment: key.equipment, name: key.name, value: value ?? null }).ok,
  });
  const idOf = new Map<string, PointId>(plant.points.map((p) => [`${p.equipment}.${p.name}`, pointId(p.equipment, p.name)]));
  const alarms = createAlarmEngine(plant.alarms.map((a) => a.config), backend);

  const tick = () => {
    sim.step(tickMs / 1000);
    for (const s of sim.samples()) {
      const id = idOf.get(s.addr);
      if (id) backend.publish(id, s.value, { quality: s.quality ? "good" : "bad" });
    }
    alarms.evaluate((id) => backend.value(id));
    for (const agent of Object.values(plant.agents)) backend.setHeartbeat("agent", agent, "online");
  };

  sim.scenario(options.scenario ?? "showcase");
  tick();
  const timer = setInterval(tick, tickMs);
  return {
    backend,
    sim,
    scenario: (name) => {
      sim.scenario(name);
      tick();
    },
    stop: () => clearInterval(timer),
  };
}
