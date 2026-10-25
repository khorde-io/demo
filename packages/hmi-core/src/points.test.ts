import { describe, expect, it, vi } from "vitest";
import { createMockBackend } from "./mock/backend.ts";
import { createPointStore } from "./points.ts";
import { syncScheduler } from "./store.ts";
import { feederBay, tick } from "./test-fixtures.ts";

const setup = () => {
  const backend = createMockBackend(feederBay());
  const points = createPointStore(backend, { debounceMs: 0, scheduler: syncScheduler });
  return { backend, points };
};

describe("point store", () => {
  it("returns an empty value before anything arrives", () => {
    const { points } = setup();
    expect(points.get("vds.sub.f1.cb::pos")).toMatchObject({ value: null, timestamp: null, stale: false });
  });

  it("fills watched points from the subscription's cached values", async () => {
    const { points } = setup();
    points.watch(["vds.sub.f1.cb::pos"]);
    await tick();
    expect(points.get("vds.sub.f1.cb::pos")).toMatchObject({ value: 1, quality: "good", type: "discrete" });
  });

  it("keeps the same object until the point changes", async () => {
    const { backend, points } = setup();
    points.watch(["vds.sub.f1.cb::pos"]);
    await tick();
    const first = points.get("vds.sub.f1.cb::pos");
    expect(points.get("vds.sub.f1.cb::pos")).toBe(first);
    backend.publish("vds.sub.f1.cb::pos", 0);
    await tick();
    expect(points.get("vds.sub.f1.cb::pos")).not.toBe(first);
    expect(points.get("vds.sub.f1.cb::pos").value).toBe(0);
  });

  it("notifies only listeners of the point that changed", async () => {
    const { backend, points } = setup();
    points.watch(["vds.sub.>"]);
    await tick();
    const cb = vi.fn();
    const ds = vi.fn();
    points.subscribe("vds.sub.f1.cb::pos", cb);
    points.subscribe("vds.sub.f1.ds::pos", ds);
    backend.publish("vds.sub.f1.cb::pos", 0);
    await tick();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(ds).not.toHaveBeenCalled();
  });

  it("batches several updates of one point into one notification per flush", async () => {
    const backend = createMockBackend(feederBay());
    const flushes: (() => void)[] = [];
    const points = createPointStore(backend, { debounceMs: 0, scheduler: (f) => flushes.push(f) });
    points.watch(["vds.sub.f1::p_mw"]);
    await tick();
    flushes.splice(0).forEach((f) => f());
    const listener = vi.fn();
    points.subscribe("vds.sub.f1::p_mw", listener);
    backend.publish("vds.sub.f1::p_mw", 21);
    backend.publish("vds.sub.f1::p_mw", 22);
    await tick();
    expect(flushes).toHaveLength(1);
    flushes[0]?.();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(points.get("vds.sub.f1::p_mw").value).toBe(22);
  });

  it("uses one subscription for everything watched, reduced to covering patterns", async () => {
    const backend = createMockBackend(feederBay());
    const spy = vi.spyOn(backend, "subscribeMeasurements");
    const points = createPointStore(backend, { debounceMs: 5, scheduler: syncScheduler });
    points.watch(["vds.sub.f1.cb::pos"]);
    points.watch(["vds.sub.>"]);
    points.watch(["vds.wf.f1.t01::p_kw"]);
    await tick(10);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(points.subscribedPaths()).toEqual(["vds.sub.>", "vds.wf.f1.t01.p_kw"]);
  });

  it("re-subscribes when interest changes and closes the subscription when nothing is watched", async () => {
    const { points } = setup();
    const release = points.watch(["vds.sub.f1.cb::pos"]);
    await tick();
    expect(points.subscribedPaths()).toEqual(["vds.sub.f1.cb.pos"]);
    release();
    await tick();
    expect(points.subscribedPaths()).toEqual([]);
  });

  it("marks values stale while the link is offline and fresh again after reconnect", async () => {
    const { backend, points } = setup();
    points.watch(["vds.sub.f1.cb::pos"]);
    await tick();
    backend.setConnection("offline");
    expect(points.get("vds.sub.f1.cb::pos").stale).toBe(true);
    backend.setConnection("online");
    await tick();
    expect(points.get("vds.sub.f1.cb::pos")).toMatchObject({ stale: false, value: 1 });
  });

  it("marks matching points stale on request", async () => {
    const { points } = setup();
    points.watch(["vds.>"]);
    await tick();
    points.setStale((id) => id.startsWith("vds.wf."), true);
    expect(points.get("vds.wf.f1.t01::p_kw").stale).toBe(true);
    expect(points.get("vds.sub.f1.cb::pos").stale).toBe(false);
  });

  it("carries bad quality through", async () => {
    const { backend, points } = setup();
    points.watch(["vds.sub.f1::v_kv"]);
    await tick();
    backend.publish("vds.sub.f1::v_kv", 34.5, { quality: "bad" });
    await tick();
    expect(points.get("vds.sub.f1::v_kv").quality).toBe("bad");
  });
});
