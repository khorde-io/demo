/**
 * Writes the agent configuration for the demo plant.
 *
 *   npm run gen -w @khorde/demo-plant                 # 6 turbines per feeder
 *   TURBINES_PER_FEEDER=15 npm run gen -w @khorde/demo-plant
 */

import { writeFileSync } from "node:fs";
import { agentConfigYaml } from "./agent-config.ts";
import { buildPlant } from "./plant.ts";

const turbinesPerFeeder = Number(process.env.TURBINES_PER_FEEDER ?? 6);
const plant = buildPlant({ turbinesPerFeeder });
const target = new URL("../site-config/vds-agents.yaml", import.meta.url);
writeFileSync(target, agentConfigYaml(plant));

const per = (agent: string) => plant.points.filter((p) => p.agent === agent).length;
console.log(
  `Wrote ${target.pathname}: ${plant.points.length} measurements ` +
    `(${per(plant.agents.substation)} substation, ${per(plant.agents.windfarm)} wind farm), ` +
    `${plant.alarms.length} alarms, ${plant.commands.length} commands, ${plant.interlocks.length} interlocks.`,
);
