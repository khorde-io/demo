/**
 * The demo plant and lookups the screens share. The plant description in
 * `@khorde/demo-plant` is the one the agent config is generated from, so the
 * screens and the hub always agree on equipment ids.
 */

import { buildPlant, type Bay } from "@khorde/demo-plant";

export const plant = buildPlant();

export const bayById = new Map(plant.bays.map((b) => [b.id, b]));

/** The bay a switching device belongs to. */
export function bayOfDevice(device: string): Bay | undefined {
  return plant.bays.find((b) => [b.cb, b.ds, b.dsB, b.es].includes(device));
}

export const AGENT_OF = new Map(plant.points.map((p) => [p.equipment, p.agent]));

/** Alarm names start with the equipment id, dots as underscores, without the site. */
export const alarmPrefix = (equipment: string) => `${equipment.replace(/^vds\./, "").replace(/\./g, "_")}_`;

export const turbinesOf = (feederBay: string) => plant.turbines.filter((t) => t.feeder === feederBay);
