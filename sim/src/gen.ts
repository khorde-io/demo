/**
 * Writes the agent configuration for the demo plant.
 *
 *   npm run gen -w @khorde/demo-plant                 # 6 turbines per feeder
 *   TURBINES_PER_FEEDER=15 npm run gen -w @khorde/demo-plant
 *
 * Also writes vds-agents.perf.yaml: the same plus the end-to-end performance
 * points (see perf.ts).
 */

import { writeFileSync } from "node:fs";
import { agentConfigYaml, perfConfigYaml } from "./agent-config.ts";
import { buildPlant } from "./plant.ts";

const turbinesPerFeeder = Number(process.env.TURBINES_PER_FEEDER ?? 6);
const plant = buildPlant({ turbinesPerFeeder });
const target = new URL("../site-config/vds-agents.yaml", import.meta.url);
writeFileSync(target, agentConfigYaml(plant));
// The same plus the performance-bench points, uploaded only for end-to-end runs.
const perfTarget = new URL("../site-config/vds-agents.perf.yaml", import.meta.url);
writeFileSync(perfTarget, perfConfigYaml(plant));

const per = (agent: string) => plant.points.filter((p) => p.agent === agent).length;
console.log(
  `Wrote ${target.pathname}: ${plant.points.length} measurements ` +
    `(${per(plant.agents.substation)} substation, ${per(plant.agents.windfarm)} wind farm), ` +
    `${plant.alarms.length} alarms, ${plant.commands.length} commands, ${plant.interlocks.length} interlocks.`,
);
console.log(`Wrote ${perfTarget.pathname}: the same plus the performance-bench points.`);
