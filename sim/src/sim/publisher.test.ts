import { describe, expect, it, vi } from "vitest";
import type { Report } from "./field.ts";
import { createPublisher } from "./publisher.ts";

const report = (addr: string, value: number, at: number): Report => ({ addr, value, quality: true, at });

function setup(status = 200) {
  const bodies: unknown[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response("", { status });
  });
  const pub = createPublisher({ url: "http://agent:9090", fetch: fetch as unknown as typeof globalThis.fetch });
  return { pub, fetch, bodies };
}

describe("publisher", () => {
  it("sends each report with its own timestamp", async () => {
    const { pub, fetch, bodies } = setup();
    expect(await pub.publish([report("a.p", 1, 1000), report("a.pos", 0, 1250)])).toBe(2);
    expect(fetch.mock.calls[0]?.[0]).toBe("http://agent:9090/batch");
    expect(bodies[0]).toEqual([
      { addr: "a.p", value: 1, quality: true, timestamp: new Date(1000).toISOString() },
      { addr: "a.pos", value: 0, quality: true, timestamp: new Date(1250).toISOString() },
    ]);
  });

  it("sends nothing when nothing is due", async () => {
    const { pub, fetch } = setup();
    expect(await pub.publish([])).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("drops what the agent refuses instead of retrying it forever", async () => {
    const refused = setup(404);
    expect(await refused.pub.publish([report("unknown.v", 1, 1000)])).toBe(0);
    expect(await refused.pub.publish([report("a.p", 2, 2000)])).toBe(0);
    expect(refused.bodies[1]).toHaveLength(1);
  });

  it("keeps what an unreachable or failing agent did not take and sends it with the next reports", async () => {
    const failing = setup(503);
    expect(await failing.pub.publish([report("a.p", 1, 1000)])).toBe(0);
    expect(await failing.pub.publish([report("a.p", 2, 2000)])).toBe(0);
    expect(failing.bodies[1]).toHaveLength(2);
  });
});
