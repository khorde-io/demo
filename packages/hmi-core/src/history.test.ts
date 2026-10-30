import { describe, expect, it, vi } from "vitest";
import { createHistoryService, downsample, toSeries, type Series } from "./history.ts";
import { createMockBackend } from "./mock/backend.ts";
import { pointId, type Measurement } from "./model.ts";
import { feederBay } from "./test-fixtures.ts";

const HOUR = 3_600_000;

describe("downsample", () => {
  const series = (v: (number | null)[]): Series => ({ id: "a::b", t: v.map((_, i) => i), v });

  it("leaves short series alone", () => {
    const s = series([1, 2, 3]);
    expect(downsample(s, 100)).toBe(s);
  });

  it("keeps the extremes of each bucket", () => {
    const v = Array.from({ length: 1000 }, (_, i) => Math.sin(i / 50));
    v[500] = 99;
    v[700] = -99;
    const out = downsample(series(v), 100);
    expect(out.t.length).toBeLessThanOrEqual(150);
    expect(out.v).toContain(99);
    expect(out.v).toContain(-99);
    expect([...out.t].sort((a, b) => a - b)).toEqual(out.t);
  });

  it("keeps gaps", () => {
    const v: (number | null)[] = Array.from({ length: 400 }, () => 1);
    v[200] = null;
    expect(downsample(series(v), 20).v).toContain(null);
  });
});

describe("toSeries", () => {
  it("groups by point, sorts by time and turns bad quality into gaps", () => {
    const m = (name: string, t: number, value: number, quality: "good" | "bad" = "good"): Measurement => ({
      id: pointId("e", name), equipment: "e", name, type: "analogical", value, quality, timestamp: new Date(t),
    });
    const out = toSeries([m("a", 2, 20), m("a", 1, 10), m("b", 1, 5, "bad")]);
    expect(out.get("e::a")).toEqual({ id: "e::a", t: [1, 2], v: [10, 20] });
    expect(out.get("e::b")?.v).toEqual([null]);
  });
});

describe("history service", () => {
  it("follows the pages, newest first, for every path in one query", async () => {
    let t = 0;
    const backend = createMockBackend(feederBay({ now: () => new Date(t) }));
    for (let h = 1; h <= 10; h++) {
      t = h * HOUR;
      backend.publish("vds.wf.f1.t01::p_kw", h * 100);
      backend.publish("vds.sub.f1::p_mw", h);
    }
    const spy = vi.spyOn(backend, "history");
    const history = createHistoryService(backend, { pageSize: 4 });
    const data = await history.fetch("analogical", ["vds.wf.*.*.p_kw", "vds.sub.f1.p_mw"], new Date(HOUR), new Date(10 * HOUR));
    expect(spy).toHaveBeenCalledTimes(5);
    expect(spy.mock.calls.map(([, q]) => q.after)).toEqual([undefined, "4", "8", "12", "16"]);
    expect(spy.mock.calls.every(([, q]) => q.order === "desc" && q.paths.length === 2)).toBe(true);
    expect(data).toHaveLength(20);
    expect(data.filter((d) => d.name === "p_kw").map((d) => d.value)).toEqual([1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]);
  });

  it("stops at the row cap, keeping the newest rows", async () => {
    let t = 0;
    const backend = createMockBackend(feederBay({ now: () => new Date(t) }));
    for (let i = 1; i <= 10; i++) {
      t = i * 1000;
      backend.publish("vds.sub.f1::p_mw", i);
    }
    const history = createHistoryService(backend, { pageSize: 3, maxRows: 5 });
    const data = await history.fetch("analogical", ["vds.sub.f1.p_mw"], new Date(0), new Date(t));
    expect(data.map((d) => d.value)).toEqual([10, 9, 8, 7, 6]);
  });

  it("returns downsampled series per point", async () => {
    let t = 0;
    const backend = createMockBackend(feederBay({ now: () => new Date(t) }));
    for (let i = 1; i <= 500; i++) {
      t = i * 1000;
      backend.publish("vds.sub.f1::p_mw", i);
    }
    const history = createHistoryService(backend);
    const out = await history.series({ type: "analogical", paths: ["vds.sub.f1.p_mw"], from: new Date(0), to: new Date(t), maxPoints: 50 });
    expect(out.get("vds.sub.f1::p_mw")?.t.length).toBeLessThanOrEqual(75);
  });
});
