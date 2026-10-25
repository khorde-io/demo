import { describe, expect, it } from "vitest";
import { count, render } from "../test-render.tsx";
import { niceTicks, segments, Sparkline, TrendChart } from "./trend.tsx";

describe("trend maths", () => {
  it("picks nice ticks", () => {
    expect(niceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(33.2, 35.1)).toEqual([33.5, 34, 34.5, 35]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });

  it("breaks the line at gaps and outside the range", () => {
    const s = { id: "a", label: "a", t: [0, 1, 2, 3, 4, 5], v: [1, 2, null, 3, 4, 5] };
    expect(segments(s, (t) => t, (v) => v, 0, 4)).toEqual(["0.0,1.0 1.0,2.0", "3.0,3.0 4.0,4.0"]);
  });
});

describe("trend chart", () => {
  const from = Date.UTC(2026, 9, 25, 12);
  const to = from + 3600e3;
  const s1 = { id: "a", label: "TR1 oil", t: [from, from + 600e3, from + 1200e3, from + 1800e3], v: [60, 62, null, 66] };
  const s2 = { id: "b", label: "TR2 oil", t: [from, from + 1800e3], v: [70, 78] };

  it("draws each series, split at gaps, with dash patterns and a legend", () => {
    const html = render(<TrendChart series={[s1, s2]} from={from} to={to} unit="°C" limits={[{ value: 75, label: "H 75" }]} label="Oil temperature" />);
    expect(count(html, 'class="kh-trend-line" points=')).toBe(3);
    expect(html).toContain('stroke-dasharray="8 5"');
    expect(html).toContain("H 75");
    expect(html).toContain("TR2 oil");
    expect(html).toContain('aria-label="Oil temperature"');
  });

  it("shows a message instead of lines", () => {
    const html = render(<TrendChart series={[s1]} from={from} to={to} label="x" message="No data in this period" />);
    expect(html).toContain("No data in this period");
    expect(html).not.toContain('class="kh-trend-line" points=');
  });

  it("draws a sparkline with its last value marked", () => {
    const html = render(<Sparkline values={[1, 3, null, 2]} label="P" />);
    expect(count(html, "kh-spark-line")).toBe(2);
    expect(html).toContain("kh-spark-dot");
  });
});
