/**
 * HTTP side of the simulator:
 *
 *   POST /webhook          the REST agents forward commands here
 *   POST /scenario/<name>  trigger a scenario (see SCENARIOS)
 *   GET  /state            a few key values, for a quick look
 *   GET  /health
 *   POST /perf/start       { points, hz }: start the end-to-end performance points
 *   POST /perf/stop        stop them; GET /perf: the current run
 *
 * The /perf routes answer browsers on localhost (CORS), so the HMI's
 * performance bench can drive them.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { PerfGenerator } from "../perf.ts";
import { SCENARIOS, type Scenario, type Simulation } from "./model.ts";

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Body the REST agent posts for a command (see the REST agent reference). */
export interface WebhookBody {
  command: { name: string; equipment: string; driver?: unknown; interlock?: unknown };
  value: number | null;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

function reply(res: ServerResponse, status: number, body: unknown) {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const isWebhookBody = (b: unknown): b is WebhookBody =>
  typeof b === "object" &&
  b !== null &&
  typeof (b as WebhookBody).command?.name === "string" &&
  typeof (b as WebhookBody).command?.equipment === "string";

export function createSimServer(sim: Simulation, log: (msg: string) => void = () => {}, perf?: PerfGenerator): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://sim");
    const origin = req.headers.origin;
    if (url.pathname.startsWith("/perf") && origin && LOCAL_ORIGIN.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Vary", "Origin");
    }
    try {
      if (perf && url.pathname.startsWith("/perf")) {
        if (req.method === "OPTIONS") return reply(res, 204, null);
        if (req.method === "GET" && url.pathname === "/perf") return reply(res, 200, { run: perf.status() });
        if (req.method === "POST" && url.pathname === "/perf/start") {
          const body = (await readJson(req)) as { points?: unknown; hz?: unknown } | null;
          const run = perf.start(Number(body?.points), Number(body?.hz));
          log(`perf: ${run.points} points at ${run.hz} Hz`);
          return reply(res, 200, { run });
        }
        if (req.method === "POST" && url.pathname === "/perf/stop") {
          const run = perf.stop();
          if (run) log(`perf: stopped after ${run.sent} values`);
          return reply(res, 200, { run });
        }
      }
      if (req.method === "POST" && url.pathname === "/webhook") {
        const body = await readJson(req);
        if (!isWebhookBody(body)) return reply(res, 400, { error: "expected { command: { name, equipment }, value }" });
        const outcome = sim.command({ equipment: body.command.equipment, name: body.command.name, value: body.value ?? null });
        log(`command ${body.command.equipment} ${body.command.name}${body.value === null ? "" : ` = ${body.value}`}: ${outcome.ok ? "ok" : outcome.message}`);
        return outcome.ok ? reply(res, 200, { ok: true }) : reply(res, outcome.status, { error: outcome.message });
      }
      const scenario = /^\/scenario\/([\w-]+)$/.exec(url.pathname)?.[1];
      if (req.method === "POST" && scenario) {
        if (!(SCENARIOS as readonly string[]).includes(scenario)) return reply(res, 404, { error: "unknown scenario", scenarios: SCENARIOS });
        sim.scenario(scenario as Scenario);
        log(`scenario ${scenario}`);
        return reply(res, 200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/state") {
        const keys = [
          "vds.wf.met::wind_ms",
          "vds.sub.hv.l1::p_mw",
          "vds.sub.tr1::oil_temp",
          "vds.sub.tr2::oil_temp",
          "vds.sub.mv.a::v_kv",
          "vds.sub.mv.b::v_kv",
          "vds.sub.mv.bc.cb::pos",
        ];
        return reply(res, 200, { t: sim.time(), ...Object.fromEntries(keys.map((k) => [k, sim.get(k)])) });
      }
      if (req.method === "GET" && url.pathname === "/health") return reply(res, 200, { ok: true });
      return reply(res, 404, { error: "not found" });
    } catch (err) {
      return reply(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
