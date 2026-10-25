import { describe, expect, it } from "vitest";
import type { PointValue } from "@khorde/hmi-core";
import { count, renderSvg } from "../test-render.tsx";
import { Breaker, Busbar, Disconnector, EarthingSwitch, Line, Transformer2W } from "./electrical.tsx";
import { turbineStateOf } from "./bound.tsx";
import { switchStateOf, type SwitchState } from "./types.ts";
import { WindIndicator, WindTurbine, type TurbineState } from "./wind.tsx";

const SWITCH_STATES: SwitchState[] = ["open", "closed", "intermediate", "invalid", "unknown"];
const pv = (value: number | null, quality: "good" | "bad" = "good"): PointValue => ({ id: "a::b", value, type: "discrete", quality, timestamp: null, stale: false });

describe("switch state coding", () => {
  it("maps the double-point coding and treats bad quality or no value as unknown", () => {
    expect([0, 1, 2, 3, 7].map((v) => switchStateOf(pv(v)))).toEqual(["open", "closed", "intermediate", "invalid", "invalid"]);
    expect(switchStateOf(pv(1, "bad"))).toBe("unknown");
    expect(switchStateOf(pv(null))).toBe("unknown");
    expect(switchStateOf(undefined)).toBe("unknown");
  });

  it("maps turbine states", () => {
    expect([0, 1, 2, 3, 4].map((v) => turbineStateOf(pv(v)))).toEqual(["stopped", "producing", "waiting", "fault", "curtailed"]);
    expect(turbineStateOf(pv(1, "bad"))).toBe("unknown");
  });
});

describe("breaker", () => {
  it.each(SWITCH_STATES)("draws %s by shape and names it", (state) => {
    const html = renderSvg(<Breaker state={state} label="F1 CB" />);
    expect(html).toContain(`kh-breaker--${state}`);
    expect(html).toContain(`aria-label="F1 CB, ${{ open: "Open", closed: "Closed", intermediate: "Intermediate", invalid: "Invalid", unknown: "Unknown" }[state]}"`);
    // Closed is the only filled body.
    expect(html.includes("kh-breaker-body--closed")).toBe(state === "closed");
    expect(html.includes(">?</text>")).toBe(state === "unknown");
  });

  it("keeps the outgoing side dead when open, live when closed, dashed when unknown", () => {
    const wires = (s: SwitchState) => [...renderSvg(<Breaker state={s} />).matchAll(/class="(kh-wire[^"]*)"/g)].map((m) => m[1]);
    expect(wires("closed")).toEqual(["kh-wire kh-wire--live", "kh-wire kh-wire--live"]);
    expect(wires("open")).toEqual(["kh-wire kh-wire--live", "kh-wire"]);
    expect(wires("unknown")).toEqual(["kh-wire kh-wire--unknown", "kh-wire kh-wire--unknown"]);
    expect(renderSvg(<Breaker state="closed" liveIn={false} />)).not.toContain("kh-wire--live");
  });

  it("stacks the alarm, interlock and local badges and says so", () => {
    const html = renderSvg(<Breaker state="closed" label="F1 CB" interlocked local alarm={{ priority: 1, indication: "active-unacked" }} />);
    expect(html).toContain("kh-alarm-shape--p1");
    expect(html).toContain("kh-alarm-shape--unacked");
    expect(html).toContain("kh-badge-lock");
    expect(html).toContain("kh-badge-tag");
    expect(html).toContain('aria-label="F1 CB, Closed, Interlocked, Local control"');
  });

  it("is a keyboard-reachable button only when it can be activated", () => {
    expect(renderSvg(<Breaker state="open" onActivate={() => {}} />)).toContain('role="button" tabindex="0"');
    expect(renderSvg(<Breaker state="open" />)).toContain('role="img"');
  });
});

describe("disconnector and earthing switch", () => {
  it.each(SWITCH_STATES)("draws a disconnector %s", (state) => {
    const html = renderSvg(<Disconnector state={state} />);
    expect(html).toContain(`kh-disconnector--${state}`);
    expect(html.includes("kh-pivot--live")).toBe(state === "closed");
  });

  it.each(SWITCH_STATES)("draws an earthing switch %s, bright only when earthed", (state) => {
    const html = renderSvg(<EarthingSwitch state={state} />);
    expect(html).toContain(`kh-earthing--${state}`);
    expect(html.includes("kh-wire--live")).toBe(state === "closed");
  });
});

describe("conductors and transformer", () => {
  it("draws energized, dead and unknown lines and busbars", () => {
    expect(renderSvg(<Line points={[[0, 0], [10, 0]]} energized />)).toContain("kh-wire kh-wire--live");
    expect(renderSvg(<Line points={[[0, 0], [10, 0]]} energized={false} />)).toContain('class="kh-wire"');
    expect(renderSvg(<Line points={[[0, 0], [10, 0]]} energized={null} />)).toContain("kh-wire--unknown");
    expect(renderSvg(<Busbar points={[[0, 0], [10, 0]]} energized label="Bus A" />)).toContain('aria-label="Bus A, energized"');
    expect(renderSvg(<Busbar points={[[0, 0], [10, 0]]} energized={false} />)).toContain('class="kh-bus"');
  });

  it("draws each winding by its own side and the tap position", () => {
    const html = renderSvg(<Transformer2W hvLive lvLive={false} tap={9} label="TR1" />);
    expect(count(html, "kh-winding kh-wire kh-wire--live")).toBe(1);
    expect(html).toContain("Tap 9");
    expect(html).toContain('aria-label="TR1, Tap 9"');
  });
});

describe("wind", () => {
  const STATES: TurbineState[] = ["producing", "waiting", "stopped", "fault", "curtailed", "unknown"];
  it.each(STATES)("draws a turbine %s", (state) => {
    const html = renderSvg(<WindTurbine state={state} label="WTG 01" />);
    expect(html).toContain(`kh-turbine--${state}`);
    expect(html.includes(">?</text>")).toBe(state === "unknown");
    expect(html.includes("kh-turbine-half")).toBe(state === "curtailed");
    expect(html).toContain("kh-turbine-disc");
  });

  it("puts a fault's alarm on the turbine", () => {
    expect(renderSvg(<WindTurbine state="fault" alarm={{ priority: 1, indication: "active-acked" }} />)).toContain("kh-alarm-shape--p1");
  });

  it("shows wind speed and points the arrow downwind", () => {
    const html = renderSvg(<WindIndicator speed={9.4} direction={135} />);
    expect(html).toContain('aria-label="Wind: 9.4 m/s, 135°"');
    expect(html).toContain("rotate(315)");
    expect(renderSvg(<WindIndicator speed={null} direction={null} />)).toContain("Wind: no value");
  });
});
