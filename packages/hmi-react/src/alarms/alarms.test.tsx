// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { Alarm, AlarmJournalEntry } from "@khorde/hmi-core";
import { createMockBackend } from "@khorde/hmi-core/mock";
import { mount } from "../test-dom.tsx";
import { count, render, testI18n } from "../test-render.tsx";
import { AlarmHistoryList, journalToCsv } from "./AlarmHistoryList.tsx";
import { AlarmList } from "./AlarmList.tsx";

const t0 = new Date("2026-10-25T17:30:00Z").getTime();
const alarm = (id: string, over: Partial<Alarm> = {}): Alarm => ({
  key: `${id}/key`,
  instanceId: id,
  origin: "hub",
  name: "wf_f3_t14_state",
  area: "vds.wf.f3",
  condition: "fault",
  state: "Set",
  severity: "high",
  priority: 1,
  value: 3,
  setAt: new Date(t0),
  stateAt: new Date(t0),
  acked: false,
  ackPending: false,
  ackedAt: null,
  ackedBy: null,
  originOnline: true,
  ...over,
});

const LIST = [
  alarm("a"),
  alarm("b", { name: "sub_tr2_oil_temp", area: "vds.sub.tr2", condition: "high", priority: 2, severity: "medium", value: 78.4, acked: true, ackedAt: new Date(t0 + 60e3), ackedBy: "operator1" }),
  alarm("c", { name: "sub_mv_a_f2_cb_sf6_low", area: "vds.sub.mv.a.f2", condition: "_", priority: 3, severity: "low", value: 1, state: "Reset" }),
];
const AREAS = [
  { label: "Substation", patterns: ["vds.sub.>"] },
  { label: "Wind farm", patterns: ["vds.wf.>"] },
];

const MANY = Array.from({ length: 45 }, (_, i) => alarm(`n${i}`, { stateAt: new Date(t0 - i * 1000) }));
const ids = (root: Element) => [...root.querySelectorAll("tbody tr")].length;
const firstRowTime = (root: Element) => root.querySelector("tbody tr td:nth-child(2)")?.textContent;

describe("alarm list pages", () => {
  it("draws one page, and acknowledges only the rows on it", async () => {
    const onAck = vi.fn();
    const m = await mount(<AlarmList alarms={MANY} onAck={onAck} canAck pageSize={20} />);
    expect(ids(m.container)).toBe(20);
    expect(m.container.textContent).toContain("1–20 of 45");
    await m.click(m.button("Ack visible (20)"));
    expect(onAck.mock.calls[0]?.[0]).toEqual(MANY.slice(0, 20).map((a) => a.instanceId));
    m.unmount();
  });

  it("moves through the pages and back to the newest", async () => {
    const m = await mount(<AlarmList alarms={MANY} pageSize={20} canAck={false} />);
    expect(m.button("Previous").disabled).toBe(true);
    await m.click(m.button("Next"));
    await m.click(m.button("Next"));
    expect(ids(m.container)).toBe(5);
    expect(m.container.textContent).toContain("41–45 of 45");
    expect(m.button("Next").disabled).toBe(true);
    await m.click(m.button("First"));
    expect(m.container.textContent).toContain("1–20 of 45");
    m.unmount();
  });

  it("has no pager when everything fits, and a new filter starts from the first page", async () => {
    const m = await mount(<AlarmList alarms={[...MANY, alarm("p3", { priority: 3, severity: "low" })]} pageSize={20} canAck={false} />);
    await m.click(m.button("Next"));
    await m.click(m.button("P1"));
    expect(ids(m.container)).toBe(1);
    expect(m.container.querySelector("nav")).toBe(null);
    m.unmount();
  });

  it("stays on a page that still exists when the list shrinks", async () => {
    const { act, useEffect, useState } = await import("react");
    let set: (l: Alarm[]) => void = () => {};
    const Host = () => {
      const [l, setL] = useState(MANY);
      useEffect(() => {
        set = setL;
      }, []);
      return <AlarmList alarms={l} pageSize={20} canAck={false} />;
    };
    const m = await mount(<Host />);
    await m.click(m.button("Next"));
    await m.click(m.button("Next"));
    await act(async () => set(MANY.slice(0, 25)));
    expect(m.container.textContent).toContain("21–25 of 25");
    m.unmount();
  });
});

describe("alarm list order", () => {
  const flood = [
    alarm("new-p3", { priority: 3, severity: "low", stateAt: new Date(t0 + 3000) }),
    alarm("old-p1-acked", { acked: true, stateAt: new Date(t0) }),
    alarm("mid-p2", { priority: 2, severity: "medium", stateAt: new Date(t0 + 2000) }),
    alarm("old-p1", { stateAt: new Date(t0 + 1000) }),
  ];
  const times = (root: Element) => [...root.querySelectorAll("tbody tr td:nth-child(2)")].map((td) => td.textContent);
  const at = (ms: number) => new Date(t0 + ms).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

  it("opens newest first and lets the operator change to most urgent first, and back", async () => {
    const m = await mount(<AlarmList alarms={flood} canAck={false} />);
    expect(m.button("Newest first").getAttribute("aria-pressed")).toBe("true");
    // The store's list is used as it comes, already in this order.
    await m.click(m.button("Most urgent first"));
    expect(m.button("Most urgent first").getAttribute("aria-pressed")).toBe("true");
    expect(times(m.container)).toEqual([at(1000), at(0), at(2000), at(3000)]);
    await m.click(m.button("Newest first"));
    expect(times(m.container)).toEqual([at(3000), at(0), at(2000), at(1000)]);
    m.unmount();
  });

  it("can open in the order a project prefers, and starts again from the first page", async () => {
    const m = await mount(<AlarmList alarms={[...MANY, alarm("p3", { priority: 3, severity: "low", stateAt: new Date(t0 + 9000) })]} defaultOrder="urgent" pageSize={20} canAck={false} />);
    expect(m.button("Most urgent first").getAttribute("aria-pressed")).toBe("true");
    await m.click(m.button("Next"));
    expect(m.container.textContent).toContain("21–40 of 46");
    await m.click(m.button("Newest first"));
    expect(m.container.textContent).toContain("1–20 of 46");
    m.unmount();
  });

  it("acknowledges the rows the chosen order put on the page", async () => {
    const onAck = vi.fn();
    const m = await mount(<AlarmList alarms={[alarm("p3", { priority: 3, severity: "low", stateAt: new Date(t0 + 9000) }), alarm("p1")]} pageSize={1} onAck={onAck} canAck defaultOrder="urgent" />);
    await m.click(m.button("Ack visible (1)"));
    expect(onAck).toHaveBeenCalledWith(["p1"]);
    m.unmount();
  });
});

describe("alarm list held rows", () => {
  const setup = async () => {
    const { act, useEffect, useState } = await import("react");
    let set: (l: Alarm[]) => void = () => {};
    const onAck = vi.fn();
    const Host = () => {
      const [l, setL] = useState(MANY);
      useEffect(() => {
        set = setL;
      }, []);
      return <AlarmList alarms={l} pageSize={20} onAck={onAck} canAck />;
    };
    const m = await mount(<Host />);
    const section = m.container.querySelector("section") as HTMLElement;
    const fire = (type: string) => act(async () => void section.dispatchEvent(new PointerEvent(type, { bubbles: true })));
    const update = (l: Alarm[]) => act(async () => set(l));
    return { m, section, fire, update, onAck };
  };
  const raised = alarm("flood", { stateAt: new Date(t0 + 5000) });

  it("moves the rows on while nobody is using the list", async () => {
    const { m, update } = await setup();
    const before = firstRowTime(m.container);
    await update([raised, ...MANY]);
    expect(firstRowTime(m.container)).not.toBe(before);
    m.unmount();
  });

  it("keeps the rows still under the pointer, says what is new, and catches up when it leaves", async () => {
    const { m, fire, update, onAck } = await setup();
    const before = firstRowTime(m.container);
    await fire("pointermove");
    await update([raised, ...MANY]);
    expect(firstRowTime(m.container)).toBe(before);
    expect(m.container.textContent).toContain("Held while you use the list · 1 new");
    expect(m.container.textContent).toContain("46 active");
    await m.click(m.button("Ack visible (20)"));
    expect(onAck.mock.calls[0]?.[0]).not.toContain("flood");
    // A mouse click doesn't leave a browser's focus ring, which is what holds rows after the pointer goes.
    m.button("Ack visible").blur();
    // React's pointer leave comes from `pointerout`.
    await fire("pointerout");
    expect(firstRowTime(m.container)).not.toBe(before);
    expect(m.container.textContent).not.toContain("Held while");
    m.unmount();
  });

  it("shows a held row's new state, and leaves a row that went in place, without its Ack", async () => {
    const { m, fire, update } = await setup();
    await fire("pointermove");
    await update(MANY.slice(1).map((a, i) => (i === 0 ? { ...a, acked: true, ackedBy: "operator1", ackedAt: new Date(t0) } : a)));
    const rows = m.container.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(20);
    expect(rows[0]?.textContent).toContain("No longer active");
    expect(rows[0]?.querySelector("button.kh-btn")).toBe(null);
    expect(rows[1]?.textContent).toContain("operator1");
    m.unmount();
  });

  it("lets go of a pointer that has been parked for a while", async () => {
    const { act } = await import("react");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { m, fire, update } = await setup();
      const before = firstRowTime(m.container);
      await fire("pointermove");
      await update([raised, ...MANY]);
      expect(firstRowTime(m.container)).toBe(before);
      await act(async () => void vi.advanceTimersByTime(20_000));
      expect(firstRowTime(m.container)).not.toBe(before);
      m.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

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

  it("says when an ack is on its way and when a state is only the last known", () => {
    const html = render(<AlarmList alarms={[alarm("p", { acked: true, ackPending: true, ackedBy: "operator1", originOnline: false })]} canAck />);
    expect(html).toContain("operator1 · sending to site");
    expect(html).toContain("Active · Last known");
    expect(html).not.toContain(">Ack<");
  });

  it("says when nothing is active", () => {
    expect(render(<AlarmList alarms={[]} />)).toContain("No active alarms");
  });

  it("doesn't say nothing is active before it knows", () => {
    const html = render(<AlarmList />);
    expect(html).toContain("Reading the active alarms");
    expect(html).not.toContain("No active alarms");
  });
});

describe("alarm history", () => {
  const entry = (kind: AlarmJournalEntry["kind"], over: Partial<AlarmJournalEntry> = {}): AlarmJournalEntry => ({
    timestamp: new Date(t0),
    kind,
    origin: "hub",
    name: "wf_f3_t14_state",
    area: "vds.wf.f3",
    condition: "fault",
    instanceId: "a",
    state: "Set",
    severity: "high",
    priority: 1,
    value: 3,
    acked: false,
    ackedAt: null,
    ackedBy: null,
    ...over,
  });
  const gap = entry("GAP", { name: "", area: "", condition: "", state: null, severity: null, priority: null, value: null, origin: "site-1" });
  const JOURNAL = [entry("ACK", { acked: true, ackedBy: "operator1", timestamp: new Date(t0 + 5000) }), gap, entry("SET")];

  it("exports CSV with quoting", () => {
    const csv = journalToCsv(testI18n, [entry("SET", { area: 'a,"b"' })]);
    expect(csv.split("\n")[0]).toBe("time,priority,area,alarm,name,condition,value,change,by");
    expect(csv).toContain('"a,""b"""');
  });

  it("exports who acknowledged, and a gap with its alarm fields empty", () => {
    const [, ack, lost] = journalToCsv(testI18n, JOURNAL).split("\n");
    expect(ack).toMatch(/,ACK,operator1$/);
    expect(lost).toMatch(/Z,,,,,,,GAP,$/);
  });

  it("shows one row per journal entry", () => {
    const html = render(<AlarmHistoryList from={new Date(t0 - 3600e3)} to={new Date(t0 + 3600e3)} entries={JOURNAL} />);
    expect(html).toContain("3 changes");
    expect(html).toContain("Acknowledged");
    expect(html).toContain("operator1");
    expect(html).toContain("Raised");
  });

  const raised = (i: number) => entry("SET", { instanceId: `i${i}`, value: i, timestamp: new Date(t0 - i * 1000) });
  const firstValue = (root: Element) => root.querySelector("tbody tr td:nth-child(5)")?.textContent;

  it("shows one page of the rows it is given and moves through them", async () => {
    const m = await mount(<AlarmHistoryList from={new Date(t0 - 3600e3)} to={new Date(t0 + 3600e3)} entries={Array.from({ length: 120 }, (_, i) => raised(i))} />);
    expect(m.container.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(m.container.textContent).toContain("120 changes");
    expect(m.container.textContent).toContain("1–50");
    expect(m.button("Previous").disabled).toBe(true);
    await m.click(m.button("Next"));
    await m.click(m.button("Next"));
    expect(m.container.querySelectorAll("tbody tr")).toHaveLength(20);
    expect(m.container.textContent).toContain("101–120");
    expect(m.button("Next").disabled).toBe(true);
    await m.click(m.button("First"));
    expect(firstValue(m.container)).toBe("0");
    m.unmount();
  });

  it("has no pager when everything fits", () => {
    expect(render(<AlarmHistoryList from={new Date(t0 - 3600e3)} to={new Date(t0 + 3600e3)} entries={JOURNAL} />)).not.toContain("Next");
  });

  describe("reading from the backend", () => {
    const flooded = (rows = 1200) => {
      let t = 0;
      const backend = createMockBackend({ now: () => new Date(t) });
      for (let i = 1; i <= rows; i++) {
        t = i * 1000;
        backend.raiseAlarm({ name: "a", area: i % 2 ? "vds.sub" : "vds.wf.f1", severity: "low", value: i });
      }
      const spy = vi.spyOn(backend, "alarmJournal");
      return { hmi: { backend }, spy, from: new Date(0), to: new Date(t) };
    };

    it("reads only what it shows, and more as the pages turn", async () => {
      const { hmi, spy, from, to } = flooded();
      const m = await mount(<AlarmHistoryList from={from} to={to} />, hmi);
      await m.settle();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(m.container.querySelectorAll("tbody tr")).toHaveLength(50);
      expect(m.container.textContent).toContain("500+ changes");
      expect(firstValue(m.container)).toBe("1,200");

      for (let i = 0; i < 9; i++) {
        await m.click(m.button("Next"));
        await m.settle();
      }
      expect(spy).toHaveBeenCalledTimes(2);
      expect(m.container.textContent).toContain("451–500");
      expect(m.container.textContent).toContain("1000+ changes");
      m.unmount();
    });

    it("goes back without reading, and reaches a real end", async () => {
      const { hmi, spy, from, to } = flooded(70);
      const m = await mount(<AlarmHistoryList from={from} to={to} />, hmi);
      await m.settle();
      expect(m.container.textContent).toContain("70 changes");
      await m.click(m.button("Next"));
      await m.settle();
      expect(m.button("Next").disabled).toBe(true);
      expect(m.container.textContent).toContain("51–70");
      await m.click(m.button("Previous"));
      await m.settle();
      expect(m.container.textContent).toContain("1–50");
      expect(spy).toHaveBeenCalledTimes(1);
      m.unmount();
    });

    it("stays on its page when the next one can't be read, and lets you try again", async () => {
      const { hmi, spy, from, to } = flooded();
      const m = await mount(<AlarmHistoryList from={from} to={to} pageSize={400} />, hmi);
      await m.settle();
      await m.click(m.button("Next"));
      await m.settle();
      spy.mockRejectedValueOnce(new Error("down"));
      await m.click(m.button("Next"));
      await m.settle();
      expect(m.container.textContent).toContain("401–800");
      expect(m.container.textContent).toContain("Couldn't read the alarm history");
      await m.click(m.button("Next"));
      await m.settle();
      expect(m.container.textContent).toContain("801–1200");
      expect(m.container.textContent).not.toContain("Couldn't read");
      m.unmount();
    });

    it("exports the whole range, not just what it has read", async () => {
      const { hmi, from, to } = flooded();
      const blobs: Blob[] = [];
      const create = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
        blobs.push(b as Blob);
        return "blob:x";
      });
      const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const m = await mount(<AlarmHistoryList from={from} to={to} />, hmi);
      await m.settle();
      await m.click(m.button("Export CSV"));
      await m.settle();
      expect((await (blobs[0] as Blob).text()).split("\n")).toHaveLength(1201);
      create.mockRestore();
      revoke.mockRestore();
      m.unmount();
    });

    it("starts again from the first page for a new range", async () => {
      const { hmi, from, to } = flooded();
      const { act, useEffect, useState } = await import("react");
      let later: (d: Date) => void = () => {};
      const Host = () => {
        const [end, setEnd] = useState(to);
        useEffect(() => {
          later = setEnd;
        }, []);
        return <AlarmHistoryList from={from} to={end} />;
      };
      const m = await mount(<Host />, hmi);
      await m.settle();
      await m.click(m.button("Next"));
      await m.settle();
      expect(m.container.textContent).toContain("51–100");
      await act(async () => later(new Date(to.getTime() - 60_000)));
      await m.settle();
      expect(m.container.textContent).toContain("1–50");
      expect(firstValue(m.container)).toBe("1,140");
      m.unmount();
    });
  });

  it("says when changes were lost", () => {
    const html = render(<AlarmHistoryList from={new Date(t0 - 3600e3)} to={new Date(t0 + 3600e3)} entries={[gap]} />);
    expect(html).toContain("Changes were lost during an outage at site-1");
    expect(count(html, "kh-alarm-indicator")).toBe(0);
  });
});
