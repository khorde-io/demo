import { describe, expect, it, vi } from "vitest";
import { createAlarmJournalReader, createAlarmStore as createStore, filterAlarms, loadAlarmHistory, sortAlarms, type AlarmStoreOptions } from "./alarms.ts";
import type { ActiveAlarmChange, Sink } from "./backend.ts";
import { createMockBackend } from "./mock/backend.ts";
import type { Alarm } from "./model.ts";
import { feederBay, tick } from "./test-fixtures.ts";

const alarm = (over: Partial<Alarm>): Alarm => ({
  key: "tr2_oil_temp/high",
  instanceId: "i1",
  origin: "hub",
  name: "tr2_oil_temp",
  area: "vds.sub.tr2",
  condition: "high",
  state: "Set",
  severity: "medium",
  priority: 2,
  value: 78.4,
  setAt: new Date("2026-10-25T14:28:51Z"),
  stateAt: new Date("2026-10-25T14:28:51Z"),
  acked: false,
  ackPending: false,
  ackedAt: null,
  ackedBy: null,
  originOnline: true,
  ...over,
});

/** Publishing every change, so tests read the list right after a change; batching has its own tests. */
const createAlarmStore = (backend: Parameters<typeof createStore>[0], options: AlarmStoreOptions = {}) => createStore(backend, { publishEveryMs: 0, ...options });

/** A backend whose alarm stream the test drives by hand. */
function scripted() {
  const backend = createMockBackend(feederBay());
  let sink: Sink<ActiveAlarmChange> | undefined;
  vi.spyOn(backend, "subscribeActiveAlarms").mockImplementation((_areas, s) => {
    sink = s;
    return () => {};
  });
  const send = (...changes: ActiveAlarmChange[]) => {
    for (const c of changes) sink?.next(c);
  };
  return { backend, send, error: (e: unknown) => sink?.error?.(e) };
}

describe("alarm store", () => {
  it("publishes nothing until the hub says the list is complete", async () => {
    const { backend, send } = scripted();
    const store = createAlarmStore(backend);
    const started = store.start();
    send({ kind: "upsert", alarm: alarm({}) });
    expect(store.get()).toMatchObject({ loaded: false, alarms: [] });
    send({ kind: "synced" });
    await started;
    expect(store.get().loaded).toBe(true);
    expect(store.get().alarms.map((a) => a.instanceId)).toEqual(["i1"]);
  });

  it("applies upserts and removes by instance", async () => {
    const { backend, send } = scripted();
    const store = createAlarmStore(backend);
    void store.start();
    send({ kind: "upsert", alarm: alarm({}) }, { kind: "synced" });
    send({ kind: "upsert", alarm: alarm({ acked: true }) });
    expect(store.get().alarms).toHaveLength(1);
    expect(store.get().counts.unacked).toBe(0);
    send({ kind: "remove", instanceId: "i1" });
    expect(store.get().alarms).toEqual([]);
  });

  it("lists the newest change first, the most urgent first when raised together", () => {
    const { backend, send } = scripted();
    const store = createAlarmStore(backend);
    void store.start();
    const t = new Date("2026-10-25T12:00:00Z");
    send(
      { kind: "upsert", alarm: alarm({ instanceId: "p3", priority: 3, stateAt: t }) },
      { kind: "upsert", alarm: alarm({ instanceId: "p1", priority: 1, stateAt: t }) },
      { kind: "upsert", alarm: alarm({ instanceId: "new", priority: 3, stateAt: new Date(t.getTime() + 1000) }) },
      { kind: "synced" },
    );
    expect(store.get().alarms.map((a) => a.instanceId)).toEqual(["new", "p1", "p3"]);
  });

  it("keeps the list when the hub repeats synced on its own", () => {
    const { backend, send } = scripted();
    const store = createAlarmStore(backend);
    void store.start();
    send({ kind: "upsert", alarm: alarm({}) }, { kind: "synced" }, { kind: "synced" });
    expect(store.get().alarms).toHaveLength(1);
  });

  it("drops what left during an outage, and keeps the old list until it knows", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend);
    const stays = backend.raiseAlarm({ name: "stays", area: "vds.sub", severity: "low" });
    const leaves = backend.raiseAlarm({ name: "leaves", area: "vds.sub", severity: "low" });
    await store.start();
    expect(store.get().alarms).toHaveLength(2);

    backend.setConnection("offline");
    backend.resetAlarm(leaves.instanceId);
    await backend.ackAlarm(leaves.key, leaves.instanceId);
    await tick();
    expect(store.get().alarms).toHaveLength(2);

    backend.setConnection("online");
    await tick();
    expect(store.get().alarms.map((a) => a.instanceId)).toEqual([stays.instanceId]);
  });

  it("says when the subscription fails, and start still resolves", async () => {
    const { backend, error } = scripted();
    const store = createAlarmStore(backend);
    const started = store.start();
    const failure = new Error("denied");
    error(failure);
    await started;
    expect(store.get()).toMatchObject({ error: failure, loaded: false });
  });

  it("resolves a start that is stopped before the list is complete", async () => {
    const { backend } = scripted();
    const store = createAlarmStore(backend);
    const started = store.start();
    store.stop();
    await expect(started).resolves.toBeUndefined();
  });

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

  it("does not lose an alarm raised while starting", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend);
    const started = store.start();
    backend.raiseAlarm({ name: "late", area: "vds.sub.tr1", severity: "medium" });
    await started;
    await tick();
    expect(store.get().alarms.map((a) => a.name)).toContain("late");
  });

  it("acknowledges by key and instance, and drops a returned alarm when the hub removes it", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend);
    await store.start();
    const a = backend.raiseAlarm({ name: "gearbox", area: "vds.wf.f1", severity: "low" });
    backend.resetAlarm(a.instanceId);
    await tick();
    expect(store.get().alarms[0]?.state).toBe("Reset");
    const spy = vi.spyOn(backend, "ackAlarm");
    await expect(store.ack(a.instanceId)).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith(a.key, a.instanceId);
    await tick();
    expect(store.get().alarms).toHaveLength(0);
  });

  it("keeps an acknowledged alarm while it is still active", async () => {
    const backend = createMockBackend({ ...feederBay(), actor: () => ({ id: "u-42", display: "operator1" }) });
    const store = createAlarmStore(backend);
    await store.start();
    const a = backend.raiseAlarm({ name: "gearbox", area: "vds.wf.f1", severity: "low" });
    await tick();
    await store.ack(a.instanceId);
    await tick();
    expect(store.get().alarms[0]).toMatchObject({ acked: true, ackedBy: "operator1" });
    // Without an actor, the mock says so rather than inventing a name.
    const anonymous = createMockBackend(feederBay());
    const b = anonymous.raiseAlarm({ name: "gearbox", area: "vds.wf.f1", severity: "low" });
    await anonymous.ackAlarm(b.key, b.instanceId);
    expect(anonymous.activeAlarms()[0]?.ackedBy).toBe("Mock operator");
  });

  it("counts a queued or repeated ack as taken, and a vanished alarm as not", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend);
    await store.start();
    const a = backend.raiseAlarm({ name: "gearbox", area: "vds.wf.f1", severity: "low" });
    await tick();
    const spy = vi.spyOn(backend, "ackAlarm");
    spy.mockResolvedValueOnce("PENDING");
    await expect(store.ack(a.instanceId)).resolves.toBe(true);
    spy.mockResolvedValueOnce("ALREADY_ACKED");
    await expect(store.ack(a.instanceId)).resolves.toBe(true);
    spy.mockResolvedValueOnce("NOT_FOUND");
    await expect(store.ack(a.instanceId)).resolves.toBe(false);
  });

  it("acknowledges several at once", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend);
    await store.start();
    const ids = ["a", "b"].map((n) => backend.raiseAlarm({ name: n, area: "vds.sub", severity: "low" }).instanceId);
    await tick();
    await expect(store.ackMany([...ids, "missing"])).resolves.toEqual(ids);
    await tick();
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

  it("drops a returned alarm when another client acknowledges it", async () => {
    const backend = createMockBackend(feederBay());
    const store = createAlarmStore(backend);
    await store.start();
    const a = backend.raiseAlarm({ name: "gearbox", area: "vds.wf.f1", severity: "low" });
    backend.resetAlarm(a.instanceId);
    await tick();
    expect(store.get().alarms).toHaveLength(1);
    // Acked elsewhere: the store only sees it on the subscription.
    await backend.ackAlarm(a.key, a.instanceId);
    await tick();
    expect(store.get().alarms).toHaveLength(0);
  });
});

describe("alarm store in a flood", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 25, 12, 0, s));

  it("publishes the first change at once and the rest together", () => {
    vi.useFakeTimers();
    try {
      const { backend, send } = scripted();
      const store = createStore(backend);
      void store.start();
      send({ kind: "synced" });
      vi.advanceTimersByTime(1000);
      const published = vi.fn();
      const off = store.subscribe(published);
      published.mockClear();

      send({ kind: "upsert", alarm: alarm({ instanceId: "a" }) });
      expect(published).toHaveBeenCalledTimes(1);
      send({ kind: "upsert", alarm: alarm({ instanceId: "b" }) }, { kind: "upsert", alarm: alarm({ instanceId: "c" }) });
      expect(published).toHaveBeenCalledTimes(1);
      expect(store.get().alarms).toHaveLength(1);

      vi.advanceTimersByTime(250);
      expect(published).toHaveBeenCalledTimes(2);
      expect(store.get().counts.total).toBe(3);
      off();
      store.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the order when changes are merged in", () => {
    const { backend, send } = scripted();
    const store = createStore(backend, { publishEveryMs: 0 });
    void store.start();
    send(
      { kind: "upsert", alarm: alarm({ instanceId: "old", stateAt: at(1) }) },
      { kind: "upsert", alarm: alarm({ instanceId: "mid", stateAt: at(2) }) },
      { kind: "upsert", alarm: alarm({ instanceId: "new", stateAt: at(3) }) },
      { kind: "synced" },
    );
    // Returning the oldest moves it to the top; a late report lands by its own time.
    send({ kind: "upsert", alarm: alarm({ instanceId: "old", state: "Reset", stateAt: at(5) }) });
    send({ kind: "upsert", alarm: alarm({ instanceId: "late", stateAt: at(2), priority: 1 }) });
    send({ kind: "remove", instanceId: "new" });
    expect(store.get().alarms.map((a) => a.instanceId)).toEqual(["old", "late", "mid"]);
    expect(store.get().counts.total).toBe(3);
  });

  it("doesn't publish a half-synced list when a publish was pending", async () => {
    vi.useFakeTimers();
    try {
      const backend = createMockBackend(feederBay());
      const store = createStore(backend);
      const started = store.start();
      await vi.advanceTimersByTimeAsync(0);
      await started;
      await vi.advanceTimersByTimeAsync(1000);
      backend.raiseAlarm({ name: "a", area: "vds.sub", severity: "low" });
      await vi.advanceTimersByTimeAsync(0);
      const b = backend.raiseAlarm({ name: "b", area: "vds.sub", severity: "low" });
      await vi.advanceTimersByTimeAsync(0);
      expect(store.get().alarms).toHaveLength(1);

      // The link drops with b waiting to be published: nothing shows until the hub has listed again.
      backend.setConnection("offline");
      await vi.advanceTimersByTimeAsync(1000);
      expect(store.get().alarms).toHaveLength(1);
      backend.setConnection("online");
      await vi.advanceTimersByTimeAsync(0);
      expect(store.get().alarms.map((x) => x.instanceId)).toContain(b.instanceId);
      store.stop();
    } finally {
      vi.useRealTimers();
    }
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
    await backend.ackAlarm(a.key, a.instanceId);
    t = 4000;
    backend.raiseAlarm({ name: "oil", area: "vds.sub.tr2", severity: "medium" });

    const all = await loadAlarmHistory(backend, { from: new Date(0), to: new Date(5000) });
    expect(all.map((x) => [x.name, x.kind, x.acked])).toEqual([
      ["oil", "SET", false],
      ["gearbox", "ACK", true],
      ["gearbox", "RESET", false],
      ["gearbox", "SET", false],
    ]);
    const wf = await loadAlarmHistory(backend, { from: new Date(0), to: new Date(5000) }, { areas: ["vds.wf.>"] });
    expect(wf.every((x) => x.area === "vds.wf.f1")).toBe(true);
  });

  it("keeps a gap whatever the filter", async () => {
    const backend = createMockBackend(feederBay());
    const row = { timestamp: new Date(1000), origin: "site-1", name: "", area: "", condition: "", instanceId: "0", state: null, severity: null, priority: null, value: null, acked: false, ackedAt: null, ackedBy: null };
    vi.spyOn(backend, "alarmJournal").mockResolvedValue({
      items: [
        { ...row, kind: "GAP" },
        { ...row, kind: "SET", name: "other", area: "vds.sub", priority: 3 },
      ],
      next: null,
    });
    const got = await loadAlarmHistory(backend, { from: new Date(0), to: new Date(5000) }, { areas: ["vds.wf.>"], priorities: [1], text: "gearbox" });
    expect(got.map((e) => e.kind)).toEqual(["GAP"]);
  });

  it("follows the pages, newest first, and keeps the newest rows at the cap", async () => {
    let t = 0;
    const backend = createMockBackend(feederBay({ now: () => new Date(t) }));
    for (let i = 1; i <= 7; i++) {
      t = i * 1000;
      backend.raiseAlarm({ name: `a${i}`, area: "vds.sub", severity: "low" });
    }
    const spy = vi.spyOn(backend, "alarmJournal");
    const range = { from: new Date(0), to: new Date(t) };
    const all = await loadAlarmHistory(backend, range, {}, { pageSize: 3 });
    expect(spy.mock.calls.map(([q]) => [q.order, q.first, q.after])).toEqual([["desc", 3, undefined], ["desc", 3, "3"], ["desc", 3, "6"]]);
    expect(all.map((a) => a.name)).toEqual(["a7", "a6", "a5", "a4", "a3", "a2", "a1"]);
    const capped = await loadAlarmHistory(backend, range, {}, { pageSize: 3, maxRows: 4 });
    expect(capped.map((a) => a.name)).toEqual(["a7", "a6", "a5", "a4"]);
  });
});

describe("alarm journal reader", () => {
  const journal = (count: number) => {
    let t = 0;
    const backend = createMockBackend(feederBay({ now: () => new Date(t) }));
    for (let i = 1; i <= count; i++) {
      t = i * 1000;
      backend.raiseAlarm({ name: `a${i}`, area: i % 10 === 0 ? "vds.wf.f1" : "vds.sub", severity: "low" });
    }
    return { backend, range: { from: new Date(0), to: new Date(t) } };
  };

  it("reads only the pages it is asked for, newest first", async () => {
    const { backend, range } = journal(1000);
    const spy = vi.spyOn(backend, "alarmJournal");
    const reader = createAlarmJournalReader(backend, range, {}, { pageSize: 100 });
    const first = await reader.readUntil(51);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(first.rows).toHaveLength(100);
    expect(first.rows[0]?.name).toBe("a1000");
    expect(first.done).toBe(false);

    await reader.readUntil(100);
    expect(spy).toHaveBeenCalledTimes(1);
    const second = await reader.readUntil(101);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[0]).toMatchObject({ order: "desc", first: 100, after: "100" });
    expect(second.rows).toHaveLength(200);
    expect(second.rows[100]?.name).toBe("a900");
  });

  it("says when the journal ends, and asks for nothing after that", async () => {
    const { backend, range } = journal(5);
    const spy = vi.spyOn(backend, "alarmJournal");
    const reader = createAlarmJournalReader(backend, range, {}, { pageSize: 100 });
    expect(await reader.readUntil(51)).toMatchObject({ done: true });
    expect((await reader.readUntil(1000)).rows).toHaveLength(5);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reads on until a narrow filter has enough rows, and keeps gaps", async () => {
    const { backend, range } = journal(1000);
    const spy = vi.spyOn(backend, "alarmJournal");
    const reader = createAlarmJournalReader(backend, range, { areas: ["vds.wf.>"] }, { pageSize: 100 });
    const { rows } = await reader.readUntil(25);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(30);
    expect(rows.every((r) => r.area === "vds.wf.f1")).toBe(true);
  });

  it("can try again after a failed read, without losing its place", async () => {
    const { backend, range } = journal(300);
    const reader = createAlarmJournalReader(backend, range, {}, { pageSize: 100 });
    await reader.readUntil(1);
    const spy = vi.spyOn(backend, "alarmJournal").mockRejectedValueOnce(new Error("down"));
    await expect(reader.readUntil(101)).rejects.toThrow("down");
    const { rows } = await reader.readUntil(101);
    expect(rows).toHaveLength(200);
    expect(spy.mock.calls[1]?.[0]).toMatchObject({ after: "100" });
  });

  it("stops reading when cancelled", async () => {
    const { backend, range } = journal(300);
    const spy = vi.spyOn(backend, "alarmJournal");
    const reader = createAlarmJournalReader(backend, range, {}, { pageSize: 100 });
    reader.cancel();
    expect((await reader.readUntil(50)).rows).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("sortAlarms", () => {
  const t = (s: number) => new Date(Date.UTC(2026, 9, 25, 12, 0, s));
  const list = [
    alarm({ instanceId: "p3-new", priority: 3, stateAt: t(9) }),
    alarm({ instanceId: "p1-acked", priority: 1, acked: true, stateAt: t(8) }),
    alarm({ instanceId: "p2", priority: 2, stateAt: t(7) }),
    alarm({ instanceId: "p1-old", priority: 1, stateAt: t(1) }),
    alarm({ instanceId: "p1-new", priority: 1, stateAt: t(2) }),
  ];

  it("puts the most urgent first: priority, then not acknowledged, then newest", () => {
    expect(sortAlarms(list, "urgent").map((a) => a.instanceId)).toEqual(["p1-new", "p1-old", "p1-acked", "p2", "p3-new"]);
  });

  it("sorts by the newest change, and leaves the list it was given alone", () => {
    const before = [...list];
    expect(sortAlarms(list, "newest").map((a) => a.instanceId)).toEqual(["p3-new", "p1-acked", "p2", "p1-new", "p1-old"]);
    expect(list).toEqual(before);
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
    expect(filterAlarms(list, { text: "converter fault", textOf: (a) => (a.name === "wtg14_converter" ? "Converter fault trip" : "") }))
      .toHaveLength(1);
  });
});
