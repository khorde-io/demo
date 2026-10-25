import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createPerfGenerator } from "../perf.ts";
import { buildPlant } from "../plant.ts";
import { createSimulation } from "./model.ts";
import { createSimServer } from "./server.ts";

const perf = createPerfGenerator({ max: 100 });
const server = createSimServer(createSimulation(buildPlant()), () => {}, perf);
let base = "";

beforeAll(async () => {
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

const post = (path: string, body: unknown, origin = "http://localhost:5173") =>
  fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });

describe("perf routes", () => {
  it("start and stop a run, for a page on localhost", async () => {
    const start = await post("/perf/start", { points: 50, hz: 2 });
    expect(start.status).toBe(200);
    expect(start.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    expect((await start.json()).run).toMatchObject({ points: 50, hz: 2 });
    expect(perf.status()?.points).toBe(50);
    const stop = await post("/perf/stop", {});
    expect((await stop.json()).run.points).toBe(50);
    expect(perf.status()).toBe(null);
  });

  it("answers the preflight, and not other sites", async () => {
    const pre = await fetch(`${base}/perf/start`, { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } });
    expect(pre.status).toBe(204);
    const other = await post("/perf/stop", {}, "https://example.com");
    expect(other.headers.get("access-control-allow-origin")).toBe(null);
  });

  it("refuses a run larger than the config holds", async () => {
    expect((await post("/perf/start", { points: 101, hz: 1 })).status).toBe(400);
  });
});
