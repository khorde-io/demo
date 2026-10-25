import { describe, expect, it } from "vitest";
import { render } from "../test-render.tsx";
import { TurbineTile } from "./TurbineTile.tsx";
import { alarmIndication, AlarmIndicator, AnalogBar, AnalogValue } from "./widgets.tsx";

describe("alarm indicator", () => {
  it("derives the indication from the alarm", () => {
    expect(alarmIndication({ state: "Set", acked: false })).toBe("active-unacked");
    expect(alarmIndication({ state: "Set", acked: true })).toBe("active-acked");
    expect(alarmIndication({ state: "Reset", acked: false })).toBe("returned-unacked");
    expect(alarmIndication({ state: "Event", acked: false })).toBe("active-unacked");
  });

  it.each([1, 2, 3] as const)("shows priority %i by shape and number, flashing only while unacknowledged", (p) => {
    const unacked = render(<AlarmIndicator priority={p} indication="active-unacked" />);
    expect(unacked).toContain(`kh-alarm-shape--p${p}`);
    expect(unacked).toContain(`>${p}</text>`);
    expect(unacked).toContain("kh-alarm-shape--unacked");
    expect(unacked).toContain(`Priority ${p} alarm, not acknowledged`);
    expect(render(<AlarmIndicator priority={p} indication="active-acked" />)).not.toContain("kh-alarm-shape--unacked");
    expect(render(<AlarmIndicator priority={p} indication="returned-unacked" />)).toContain("kh-alarm-shape--outline");
  });
});

describe("analog value", () => {
  it("formats the number with its unit", () => {
    const html = render(<AnalogValue value={34.567} unit="kV" decimals={2} label="F1 voltage" />);
    expect(html).toContain(">34.57<");
    expect(html).toContain('aria-label="F1 voltage, 34.57 kV"');
  });

  it("decorates bad, stale and missing values instead of recolouring them", () => {
    expect(render(<AnalogValue value={34.6} unit="kV" quality="bad" />)).toMatch(/kh-value--bad[\s\S]*>\?</);
    expect(render(<AnalogValue value={34.6} unit="kV" stale />)).toContain("kh-value-stale");
    const none = render(<AnalogValue value={null} unit="kV" />);
    expect(none).toContain(">—<");
    expect(none).toContain("no value");
  });

  it("carries an alarm indicator beside the value", () => {
    expect(render(<AnalogValue value={92} unit="°C" alarm={{ priority: 2, indication: "active-acked" }} />)).toContain("kh-alarm-shape--p2");
  });
});

describe("analog bar", () => {
  it("places the pointer, band, limits and setpoint on one scale", () => {
    const html = render(<AnalogBar value={50} min={0} max={100} normal={[20, 65]} limits={[65, 80]} setpoint={40} label="Load" />);
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('class="kh-abar-ptr" style="left:50%"');
    expect(html).toContain("left:20%;width:calc(65% - 20%)");
    expect(html).toContain('class="kh-abar-lim" style="left:80%"');
    expect(html).toContain('class="kh-abar-sp" style="left:40%"');
  });

  it("clamps out-of-range values and draws no pointer for bad quality", () => {
    expect(render(<AnalogBar value={150} min={0} max={100} label="x" />)).toContain("left:100%");
    const bad = render(<AnalogBar value={50} min={0} max={100} quality="bad" label="x" />);
    expect(bad).toContain("kh-abar--bad");
    expect(bad).not.toContain("kh-abar-ptr");
    expect(bad).not.toContain("aria-valuenow");
  });
});

describe("turbine tile", () => {
  const tile = (props: Partial<Parameters<typeof TurbineTile>[0]>) =>
    render(<TurbineTile name="WTG 14" state="producing" powerKw={3520} ratedKw={4500} {...props} />);

  it("shows producing turbines solid with their power", () => {
    const html = tile({});
    expect(html).toContain("kh-tile--producing");
    expect(html).toContain(">3.52<");
    expect(html).toContain('aria-label="WTG 14, Producing, 3.52 MW"');
  });

  it("marks fault, comms loss and curtailment", () => {
    expect(tile({ state: "fault", powerKw: 0, alarm: { priority: 1, indication: "active-unacked" } })).toContain("kh-tile--alarm kh-tile--p1");
    const silent = tile({ state: "unknown" });
    expect(silent).toContain("kh-tile--unknown");
    expect(silent).toContain(">?<");
    const curtailed = tile({ state: "curtailed", powerKw: 2000, setpointKw: 2000 });
    expect(curtailed).toContain("kh-tile-sp");
    expect(curtailed).toContain("Setpoint 2 MW");
  });

  it("is a button when it opens something", () => {
    expect(tile({ onActivate: () => {} })).toMatch(/^<button type="button" class="kh-tile/);
  });
});
