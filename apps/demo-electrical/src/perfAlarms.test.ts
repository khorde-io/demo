import { createAlarmStore, type Alarm } from "@khorde/hmi-core";
import { createMockBackend } from "@khorde/hmi-core/mock";
import { describe, expect, it } from "vitest";
import { ackPerfAlarms, createAlarmFeed, createAlarmTally, isPerfAlarmAddr } from "./perfAlarms.ts";

const report = (n: string, value: number) => ({ addr: `perfalarm.a${n}.v`, value, quality: true, at: 0 });
const alarm = (id: string, area: string, stateAt: number) => ({ instanceId: id, area, stateAt: new Date(stateAt) }) as Alarm;
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("alarm feed", () => {
  it("raises and returns mock alarms from the generator's reports", () => {
    const backend = createMockBackend();
    const feed = createAlarmFeed(backend);
    expect(isPerfAlarmAddr(report("0004", 1).addr)).toBe(true);
    expect(isPerfAlarmAddr("perf.p0004.v")).toBe(false);

    feed(report("0004", 1));
    expect(backend.activeAlarms()[0]).toMatchObject({ area: "perfalarm.a0004", state: "Set", priority: 2 });

    feed(report("0004", 0));
    expect(backend.activeAlarms()[0]).toMatchObject({ area: "perfalarm.a0004", state: "Reset", acked: false });
  });
});

describe("alarm tally", () => {
  it("counts each state change once, with its age, and leaves other alarms out", () => {
    let now = 1000;
    const tally = createAlarmTally(() => now);
    tally.observe([alarm("a", "perfalarm.a0000", 900), alarm("p", "vds.wf.t01", 900)], true);
    tally.observe([alarm("a", "perfalarm.a0000", 900)], true);
    expect(tally.shown).toBe(1);
    expect(tally.latencies).toEqual([100]);

    now = 3000;
    tally.observe([alarm("a", "perfalarm.a0000", 2990), alarm("b", "perfalarm.a0001", 2950)], true);
    expect(tally.shown).toBe(3);
    expect(tally.latencies).toEqual([100, 10, 50]);
    expect(tally.peak).toBe(2);
  });

  it("doesn't count what it saw during warm-up, then or later", () => {
    const tally = createAlarmTally(() => 1000);
    tally.observe([alarm("a", "perfalarm.a0000", 900)], false);
    tally.observe([alarm("a", "perfalarm.a0000", 900)], true);
    expect(tally.shown).toBe(0);
    expect(tally.latencies).toEqual([]);
  });
});

describe("clearing a run's alarms", () => {
  it("acknowledges the bench's alarms and leaves the plant's", async () => {
    const backend = createMockBackend();
    const store = createAlarmStore(backend, { publishEveryMs: 0 });
    const started = store.start();
    await settle();
    await started;
    const feed = createAlarmFeed(backend);
    feed(report("0000", 1));
    feed(report("0000", 0));
    backend.raiseAlarm({ name: "trip", area: "vds.sub.hv.l1", severity: "high" });
    await settle();
    expect(store.get().alarms).toHaveLength(2);

    expect(await ackPerfAlarms(store)).toBe(0);
    await settle();
    expect(store.get().alarms.map((a) => a.area)).toEqual(["vds.sub.hv.l1"]);
  });

  it("says how many it could not acknowledge", async () => {
    const store = {
      get: () => ({ alarms: [alarm("a", "perfalarm.a0000", 1), alarm("b", "perfalarm.a0001", 1)], counts: { total: 2, unacked: 2, byPriority: { 1: { total: 0, unacked: 0 }, 2: { total: 0, unacked: 0 }, 3: { total: 0, unacked: 0 } } }, loaded: true, error: null }),
      ackMany: async () => ["a"],
    };
    expect(await ackPerfAlarms(store)).toBe(1);
  });
});
