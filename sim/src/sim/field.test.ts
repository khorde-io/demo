import { describe, expect, it } from "vitest";
import type { Sample } from "./model.ts";
import { createField, scanRange } from "./field.ts";

const analog = (addr: string, value: number): Sample => ({ addr, value, quality: true, type: "analogical" });
const discrete = (addr: string, value: number, quality = true): Sample => ({ addr, value, quality, type: "discrete" });

/** Polls every `stepMs` from `from` to `to`, with `samples(t)` as the model's values. */
function run(field: ReturnType<typeof createField>, samples: (t: number) => Sample[], from: number, to: number, stepMs = 100) {
  const out = [];
  for (let t = from; t <= to; t += stepMs) out.push(...field.poll(samples(t), t));
  return out;
}

describe("field", () => {
  it("spreads the first reports over the scan period instead of one instant", () => {
    const field = createField();
    const points = Array.from({ length: 200 }, (_, i) => analog(`vds.sub.b${i}.p_mw`, 10));
    const reports = run(field, () => points, 0, 2000);
    expect(new Set(reports.map((r) => r.addr)).size).toBe(200);
    expect(new Set(reports.map((r) => r.at)).size).toBeGreaterThan(100);
    expect(Math.max(...reports.map((r) => r.at))).toBeLessThanOrEqual(1600);
  });

  it("reports analog values on their own scans, only past the deadband", () => {
    let v = 100;
    const field = createField({ random: () => 0.5 });
    const first = run(field, () => [analog("x.p_mw", v)], 0, 3000);
    const scans = first.length;
    expect(scans).toBe(1); // unchanged after the first report
    v = 100.1; // inside the 0.2 % deadband
    expect(run(field, () => [analog("x.p_mw", v)], 3100, 6000)).toHaveLength(0);
    v = 105;
    const moved = run(field, () => [analog("x.p_mw", v)], 6100, 8000);
    expect(moved).toHaveLength(1);
    expect(moved[0]?.at).toBeLessThanOrEqual(8000);
  });

  it("reports a discrete change as an event after a short delay, timestamped then", () => {
    let pos = 1;
    const field = createField({ random: () => 0.5, eventDelayMs: [100, 300] });
    run(field, () => [discrete("cb.pos", pos)], 0, 1000);
    pos = 0;
    const at = field.poll([discrete("cb.pos", pos)], 2000);
    expect(at).toHaveLength(0);
    const later = run(field, () => [discrete("cb.pos", pos)], 2100, 2500);
    expect(later).toEqual([{ addr: "cb.pos", value: 0, quality: true, at: 2200 }]);
  });

  it("drops an event the model took back before it was reported", () => {
    let pos = 1;
    const field = createField({ random: () => 0.5, eventDelayMs: [400, 400] });
    run(field, () => [discrete("cb.pos", pos)], 0, 1000);
    pos = 2;
    field.poll([discrete("cb.pos", pos)], 1100);
    pos = 1;
    expect(run(field, () => [discrete("cb.pos", pos)], 1200, 2000)).toHaveLength(0);
  });

  it("sends every point again on its own integrity period", () => {
    const field = createField({ integrityMs: [10_000, 20_000] });
    const points = Array.from({ length: 50 }, (_, i) => discrete(`d${i}.pos`, 1));
    const reports = run(field, () => points, 0, 25_000, 500).filter((r) => r.at > 1000);
    expect(reports.length).toBeGreaterThanOrEqual(50);
    expect(new Set(reports.map((r) => r.at)).size).toBeGreaterThan(10);
  });

  it("scans electrical values faster than temperatures", () => {
    expect(scanRange("vds.sub.mv.a.f1.p_mw")[1]).toBeLessThan(scanRange("vds.sub.tr1.oil_temp")[0]);
  });
});
