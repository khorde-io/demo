import { describe, expect, it, vi } from "vitest";
import type { Sample } from "./model.ts";
import { createPublisher } from "./publisher.ts";

const analog = (value: number, quality = true): Sample => ({ addr: "a.p", value, quality, type: "analogical" });
const discrete = (value: number): Sample => ({ addr: "a.pos", value, quality: true, type: "discrete" });

function setup(status = 200) {
  const bodies: unknown[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response("", { status });
  });
  const pub = createPublisher({ url: "http://agent:9090", fetch: fetch as unknown as typeof globalThis.fetch, refreshMs: 30_000, deadband: 0.01 });
  return { pub, fetch, bodies };
}

describe("publisher", () => {
  it("posts every value first, then only changes beyond the deadband", async () => {
    const { pub, fetch, bodies } = setup();
    expect(await pub.publish([analog(100), discrete(1)], 0)).toBe(2);
    expect(fetch.mock.calls[0]?.[0]).toBe("http://agent:9090/batch");
    expect(await pub.publish([analog(100.5), discrete(1)], 1000)).toBe(0);
    expect(await pub.publish([analog(102), discrete(0)], 2000)).toBe(2);
    expect(bodies[1]).toEqual([
      { addr: "a.p", value: 102, quality: true, timestamp: new Date(2000).toISOString() },
      { addr: "a.pos", value: 0, quality: true, timestamp: new Date(2000).toISOString() },
    ]);
  });

  it("sends quality changes and periodic refreshes", async () => {
    const { pub } = setup();
    await pub.publish([analog(100)], 0);
    expect(await pub.publish([analog(100, false)], 1000)).toBe(1);
    expect(await pub.publish([analog(100, false)], 2000)).toBe(0);
    expect(await pub.publish([analog(100, false)], 31_000)).toBe(1);
  });

  it("retries values the agent did not accept", async () => {
    const failing = setup(503);
    expect(await failing.pub.publish([analog(100)], 0)).toBe(0);
    expect(await failing.pub.publish([analog(100)], 1000)).toBe(0);
    expect(failing.fetch).toHaveBeenCalledTimes(2);
  });
});
