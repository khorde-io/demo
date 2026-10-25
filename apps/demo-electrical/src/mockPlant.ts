/**
 * The demo plant on the in-browser mock backend: the same points, commands and
 * interlocks as the agent config uploaded to the hub, so screens can be built
 * and tried without a hub.
 */

import type { Expression } from "@khorde/hmi-core";
import type { MockBackendOptions } from "@khorde/hmi-core/mock";
import type { Plant } from "@khorde/demo-plant";

export function mockPlant(plant: Plant): MockBackendOptions {
  return {
    agents: Object.values(plant.agents),
    stepMs: 300,
    points: plant.points.map((p) => ({ equipment: p.equipment, name: p.name, type: p.type, value: p.initial, agent: p.agent, tags: p.tags })),
    commands: plant.commands.map((c) => ({ agent: c.agent, equipment: c.equipment, name: c.name, ...(c.interlock ? { interlock: c.interlock } : {}) })),
    interlocks: Object.fromEntries(plant.interlocks.map((i) => [i.key, { description: i.description, expression: i.expression as Expression }])),
  };
}
