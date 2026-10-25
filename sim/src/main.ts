/**
 * Runs the plant simulator: steps the model, pushes values to both REST
 * agents, and serves the command webhook.
 *
 * Environment (defaults suit `docker compose` in sim/):
 *   SUBSTATION_AGENT_URL   http://agent-substation:9090
 *   WINDFARM_AGENT_URL     http://agent-windfarm:9090
 *   PORT                   8091   (webhook + scenario control)
 *   TICK_MS                1000   (model step; values are reported on their own scans)
 *   TURBINES_PER_FEEDER    6      (must match the uploaded agent config)
 *   SCENARIO               showcase  (initial state; "normal" for a clean plant)
 *   THERMAL_SPEED          10     (transformer temperatures move this much faster)
 */

import { createSimulation, SCENARIOS, type Scenario } from "./sim/model.ts";
import { createField } from "./sim/field.ts";
import { createPublisher } from "./sim/publisher.ts";
import { createSimServer } from "./sim/server.ts";
import { AGENTS, buildPlant } from "./plant.ts";

const env = (k: string, d: string) => process.env[k] ?? d;
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const plant = buildPlant({ turbinesPerFeeder: Number(env("TURBINES_PER_FEEDER", "6")) });
const sim = createSimulation(plant, { seed: Date.now() & 0xffff, thermalSpeed: Number(env("THERMAL_SPEED", "10")) });
const initial = env("SCENARIO", "showcase");
if (!(SCENARIOS as readonly string[]).includes(initial)) throw new Error(`Unknown SCENARIO ${initial}; use one of ${SCENARIOS.join(", ")}`);
sim.scenario(initial as Scenario);

const agentOf = new Map<string, string>(plant.points.map((p) => [`${p.equipment}.${p.name}`, p.agent]));
const publishers = {
  [AGENTS.substation]: createPublisher({ url: env("SUBSTATION_AGENT_URL", "http://agent-substation:9090"), log }),
  [AGENTS.windfarm]: createPublisher({ url: env("WINDFARM_AGENT_URL", "http://agent-windfarm:9090"), log }),
};

// The model steps once per TICK_MS; the field polls ten times as often, so
// points are scanned and reported at their own moments, not all at once.
const tickMs = Number(env("TICK_MS", "1000"));
const field = createField();
let stepped = Date.now();
setInterval(() => {
  const now = Date.now();
  while (now - stepped >= tickMs) {
    sim.step(tickMs / 1000);
    stepped += tickMs;
  }
  const reports = field.poll(sim.samples(), now);
  for (const [agent, pub] of Object.entries(publishers)) void pub.publish(reports.filter((r) => agentOf.get(r.addr) === agent));
}, 100);

const port = Number(env("PORT", "8091"));
createSimServer(sim, log).listen(port, () => {
  log(`Ventos da Serra simulator: ${plant.turbines.length} turbines, scenario "${initial}", webhook on :${port}/webhook`);
  log(`Scenarios: ${SCENARIOS.map((s) => `POST :${port}/scenario/${s}`).join(" · ")}`);
});
