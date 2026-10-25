import { describe, expect, it } from "vitest";
import { createAlarmStore, filterAlarms, loadAlarmHistory, mergeAlarm, untilClearedAndAcked, whileSet } from "./alarms.ts";
import { createMockBackend } from "./mock/backend.ts";
import type { Alarm } from "./model.ts";
import { feederBay, tick } from "./test-fixtures.ts";

const alarm = (over: Partial<Alarm>): Alarm => ({
  instanceId: "i1",
  name: "tr2_oil_temp",
  area: "vds.sub.tr2",
  condition: "high",
  state: "Set",
  severity: "medium",
  priority: 2,
  value: 78.4,
  timestamp: new Date("2026-10-25T14:28:51Z"),
  acked: false,
  ackTimestamp: null,
  actorId: null,
  actorDisplay: null,
  ...over,
});

describe("mergeAlarm", () => {
  it("keeps a returned alarm until it is acknowledged", () => {
    let list = mergeAlarm([], alarm({}));
    list = mergeAlarm(list, alarm({ state: "Reset" }));
    expect(list).toHaveLength(1);
    expect(list[0]?.state).toBe("Reset");
    list = mergeAlarm(list, alarm({ state: "Reset", acked: true }));
    expect(list).toHaveLength(0);
  });

  it("keeps an acknowledged alarm while it is still active", () => {
    const list = mergeAlarm([alarm({})], alarm({ acked: true }));
    expect(list[0]?.acked).toBe(true);
  });

  it("does not lose an ack when a later update omits it", () => {
    const list = mergeAlarm([alarm({ acked: true })], alarm({ value: 80 }));
    expect(list[0]).toMatchObject({ acked: true, value: 80 });
  });

  it("removes an event once acknowledged", () => {
    const list = mergeAlarm([alarm({ state: "Event" })], alarm({ state: "Event", acked: true }));
    expect(list).toHaveLength(0);
  });

  it("sorts newest first", () => {
    const list = mergeAlarm([alarm({ instanceId: "old", timestamp: new Date(1000) })], alarm({ instanceId: "new", timestamp: new Date(2000) }));
    expect(list.map((a) => a.instanceId)).toEqual(["new", "old"]);
  });
});

describe("alarm store", () => {
  it("loads active alarms, follows changes and counts by priority", async () => {
    const backend = createMockBackend(feederBay());
    const existing = backend.raiseAlarm({ name: "f2_sf6", area: "vds.sub.f2", severity: "low" });
    const store = createAlarmStore(backend);
    await store.start();
    expect(store.get().loaded).toBe(true);
    expect(store.get().alarms.map((a) => a.instanceId)).toEqual([existing.instanceId]);

    backend.raiseAlarm({ name: "wtg14_converter", area: "vds.wf.f3", severity: "high" });
    await tick();
    const { counts } = store.get();
    expect(counts).toMatchObject({ total: 2, unacked: 2 });
    expect(counts.byPriority[1]).toEqual({ total: 1, unacked: 1 });
    expect(counts.byPriority[3]).toEqual({ total: 1, unacked: 1 });
  });

  it("does not lose an alarm raised while the initial query runs", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend);
    const started = store.start();
    backend.raiseAlarm({ name: "late", area: "vds.sub.tr1", severity: "medium" });
    await started;
    await tick();
    expect(store.get().alarms.map((a) => a.name)).toContain("late");
  });

  it("acknowledges and drops returned alarms", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend);
    await store.start();
    const a = backend.raiseAlarm({ name: "gearbox", area: "vds.wf.f1", severity: "low" });
    backend.resetAlarm(a.instanceId);
    await tick();
    expect(store.get().alarms[0]?.state).toBe("Reset");
    await expect(store.ack(a.instanceId)).resolves.toBe(true);
    expect(store.get().alarms).toHaveLength(0);
  });

  it("acknowledges several at once", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend);
    await store.start();
    const ids = ["a", "b"].map((n) => backend.raiseAlarm({ name: n, area: "vds.sub", severity: "low" }).instanceId);
    await tick();
    await expect(store.ackMany([...ids, "missing"])).resolves.toEqual(ids);
    expect(store.get().counts.unacked).toBe(0);
  });

  it("does not acknowledge without the ack permission", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend, { permissions: { can: (p) => p !== "ackAlarm" } });
    await store.start();
    const { instanceId } = backend.raiseAlarm({ name: "a", area: "vds.sub", severity: "low" });
    await tick();
    await expect(store.ack(instanceId)).resolves.toBe(false);
    await expect(store.ackMany([instanceId])).resolves.toEqual([]);
    expect(store.get().counts.unacked).toBe(1);
  });

  it("follows only its areas", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend, { areas: ["vds.wf.>"] });
    await store.start();
    backend.raiseAlarm({ name: "sub", area: "vds.sub.tr1", severity: "low" });
    backend.raiseAlarm({ name: "wf", area: "vds.wf.f1", severity: "low" });
    await tick();
    expect(store.get().alarms.map((a) => a.name)).toEqual(["wf"]);
  });
});

describe("active-alarm rule", () => {
  it("never lists a change that is no longer active, even if it is new to the list", () => {
    expect(mergeAlarm([], alarm({ state: "Reset", acked: true }))).toEqual([]);
    expect(mergeAlarm([], alarm({ state: "Event", acked: true }))).toEqual([]);
  });

  it("can list only alarms whose condition is present", () => {
    let list = mergeAlarm([], alarm({}), whileSet);
    expect(list).toHaveLength(1);
    list = mergeAlarm(list, alarm({ state: "Reset" }), whileSet);
    expect(list).toHaveLength(0);
    expect(untilClearedAndAcked(alarm({ state: "Reset" }))).toBe(true);
  });

  it("drops a returned alarm when another client acknowledges it", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend);
    await store.start();
    const a = backend.raiseAlarm({ name: "gearbox", area: "vds.wf.f1", severity: "low" });
    backend.resetAlarm(a.instanceId);
    await tick();
    expect(store.get().alarms).toHaveLength(1);
    // Acked elsewhere: the store only sees the changed alarm on the subscription.
    await backend.ackAlarm(a.instanceId);
    await tick();
    expect(store.get().alarms).toHaveLength(0);
  });

  it("applies the configured rule to the initial list too", async () => {
    const backend = createMockBackend(feederBay());
    const a = backend.raiseAlarm({ name: "gearbox", area: "vds.wf.f1", severity: "low" });
    backend.resetAlarm(a.instanceId);
    const store = createAlarmStore(backend, { isActive: whileSet });
    await store.start();
    expect(store.get().alarms).toHaveLength(0);
  });
});

describe("loadAlarmHistory", () => {
  it("returns every change in the range, newest first and filtered", async () => {
    let t = 1000;
    const backend = createMockBackend(feederBay({ now: () => new Date(t) }));
    const a = backend.raiseAlarm({ name: "gearbox", area: "vds.wf.f1", severity: "low" });
    t = 2000;
    backend.resetAlarm(a.instanceId);
    t = 3000;
    await backend.ackAlarm(a.instanceId);
    t = 4000;
    backend.raiseAlarm({ name: "oil", area: "vds.sub.tr2", severity: "medium" });

    const all = await loadAlarmHistory(backend, { from: new Date(0), to: new Date(5000) });
    expect(all.map((x) => [x.name, x.state, x.acked])).toEqual([
      ["oil", "Set", false],
      ["gearbox", "Reset", true],
      ["gearbox", "Reset", false],
      ["gearbox", "Set", false],
    ]);
    const wf = await loadAlarmHistory(backend, { from: new Date(0), to: new Date(5000) }, { areas: ["vds.wf.>"] });
    expect(wf.every((x) => x.area === "vds.wf.f1")).toBe(true);
  });
});

describe("filterAlarms", () => {
  const list = [
    alarm({ instanceId: "1", priority: 1, area: "vds.wf.f3", name: "wtg14_converter" }),
    alarm({ instanceId: "2", priority: 2, area: "vds.sub.tr2", acked: true }),
    alarm({ instanceId: "3", priority: 3, area: "vds.sub.f2", name: "f2_sf6" }),
  ];

  it("filters by area, priority, ack and text", () => {
    expect(filterAlarms(list, { areas: ["vds.sub.>"] }).map((a) => a.instanceId)).toEqual(["2", "3"]);
    expect(filterAlarms(list, { priorities: [1, 3] }).map((a) => a.instanceId)).toEqual(["1", "3"]);
    expect(filterAlarms(list, { unackedOnly: true }).map((a) => a.instanceId)).toEqual(["1", "3"]);
    expect(filterAlarms(list, { text: "SF6" }).map((a) => a.instanceId)).toEqual(["3"]);
    expect(filterAlarms(list, { text: "converter fault", textOf: (a) => (a.instanceId === "1" ? "Converter fault trip" : "") }))
      .toHaveLength(1);
  });
});
