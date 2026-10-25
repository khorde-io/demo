// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Alarm } from "@khorde/hmi-core";
import { mount } from "../test-dom.tsx";
import { count, render, testI18n } from "../test-render.tsx";
import { alarmChanges, AlarmHistoryList, changesToCsv } from "./AlarmHistoryList.tsx";
import { AlarmList } from "./AlarmList.tsx";

const t0 = new Date("2026-10-25T17:30:00Z").getTime();
const alarm = (id: string, over: Partial<Alarm> = {}): Alarm => ({
  instanceId: id,
  name: "wf_f3_t14_state",
  area: "vds.wf.f3",
  condition: "fault",
  state: "Set",
  severity: "high",
  priority: 1,
  value: 3,
  timestamp: new Date(t0),
  acked: false,
  ackTimestamp: null,
  actorId: null,
  actorDisplay: null,
  ...over,
});

const LIST = [
  alarm("a"),
  alarm("b", { name: "sub_tr2_oil_temp", area: "vds.sub.tr2", condition: "high", priority: 2, severity: "medium", value: 78.4, acked: true, ackTimestamp: new Date(t0 + 60e3), actorDisplay: "operator1" }),
  alarm("c", { name: "sub_mv_a_f2_cb_sf6_low", area: "vds.sub.mv.a.f2", condition: "_", priority: 3, severity: "low", value: 1, state: "Reset" }),
];
const AREAS = [
  { label: "Substation", patterns: ["vds.sub.>"] },
  { label: "Wind farm", patterns: ["vds.wf.>"] },
];

describe("alarm list", () => {
  it("lists every alarm with its dictionary text, bold while unacknowledged", () => {
    const html = render(<AlarmList alarms={LIST} canAck />);
    expect(count(html, "<tr ")).toBe(3);
    expect(count(html, "kh-row--unacked")).toBe(2);
    expect(html).toContain("WTG 14 converter fault");
    expect(html).toContain("operator1 · ");
    expect(html).toContain("Returned");
    expect(html).toContain("Ack visible (2)");
    expect(html).toContain("3 active · 2 unacknowledged");
  });

  it("offers no acknowledgement without the permission", () => {
    const html = render(<AlarmList alarms={LIST} canAck={false} />);
    expect(html).not.toContain("Ack visible");
    expect(html).not.toContain(">Ack<");
  });

  it("filters by area and priority, and acknowledges what is visible", async () => {
    const onAck = vi.fn();
    const m = await mount(<AlarmList alarms={LIST} areas={AREAS} onAck={onAck} canAck />);
    await m.click(m.button("Substation"));
    expect(m.container.querySelectorAll("tbody tr")).toHaveLength(2);
    await m.click(m.button("P3"));
    expect(m.container.querySelectorAll("tbody tr")).toHaveLength(1);
    await m.click(m.button("Ack visible"));
    expect(onAck).not.toHaveBeenCalled(); // only an acknowledged alarm is left
    await m.click(m.button("All"));
    await m.click(m.button("Ack visible (1)"));
    expect(onAck).toHaveBeenCalledWith(["a"]);
    m.unmount();
  });

  it("filters by the translated text", async () => {
    const m = await mount(<AlarmList alarms={LIST} />);
    const input = m.container.querySelector("input") as HTMLInputElement;
    const { act } = await import("react");
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(input, "converter");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(m.container.querySelectorAll("tbody tr")).toHaveLength(1);
    m.unmount();
  });

  it("says when nothing is active", () => {
    expect(render(<AlarmList alarms={[]} />)).toContain("No active alarms");
  });
});

describe("alarm history", () => {
  it("splits an acknowledged alarm into two changes, newest first", () => {
    const changes = alarmChanges(LIST);
    expect(changes.map((c) => `${c.alarm.instanceId}:${c.kind}`)).toEqual(["b:ack", "a:Set", "b:Set", "c:Reset"]);
  });

  it("exports CSV with quoting", () => {
    const csv = changesToCsv(testI18n, alarmChanges([alarm("x", { area: 'a,"b"' })]));
    expect(csv.split("\n")[0]).toBe("time,priority,area,alarm,name,condition,value,change,by");
    expect(csv).toContain('"a,""b"""');
  });

  it("shows the changes it is given", () => {
    const html = render(<AlarmHistoryList from={new Date(t0 - 3600e3)} to={new Date(t0 + 3600e3)} alarms={LIST} />);
    expect(html).toContain("4 changes");
    expect(html).toContain("Acknowledged");
    expect(html).toContain("Raised");
  });
});
