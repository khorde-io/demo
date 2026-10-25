import { describe, expect, it } from "vitest";
import { SCADA_ROLES, writable, type Alarm, type AlarmSnapshot, type ConnectionState, type Heartbeat } from "@khorde/hmi-core";
import { count, render, spokenText } from "../test-render.tsx";
import type { HmiServices } from "../context.tsx";
import { AppShell, bannerAlarm, Footer, Header, roleKey } from "./shell.tsx";

const alarm = (over: Partial<Alarm>): Alarm => ({
  instanceId: "i1",
  name: "wf_f3_t14_state",
  area: "vds.wf.f3",
  condition: "fault",
  state: "Set",
  severity: "high",
  priority: 1,
  value: 3,
  timestamp: new Date("2026-10-25T17:32:07Z"),
  acked: false,
  ackTimestamp: null,
  actorId: null,
  actorDisplay: null,
  ...over,
});

function alarmsService(list: Alarm[]): HmiServices["alarms"] {
  const by = (p: 1 | 2 | 3) => ({ total: list.filter((a) => a.priority === p).length, unacked: list.filter((a) => a.priority === p && !a.acked).length });
  const snap: AlarmSnapshot = { alarms: list, counts: { total: list.length, unacked: list.filter((a) => !a.acked).length, byPriority: { 1: by(1), 2: by(2), 3: by(3) } }, loaded: true, error: null };
  return { ...writable(snap), start: async () => {}, stop: () => {}, ack: async () => true, ackMany: async () => [] } as unknown as HmiServices["alarms"];
}

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "substation", label: "Substation" },
  { id: "alarms", label: "Alarms" },
];
const NOW = new Date("2026-10-25T17:32:41Z");

describe("header", () => {
  const header = (alarms: Alarm[], extra: Partial<Parameters<typeof Header>[0]> = {}) =>
    render(
      <Header
        site={{ name: "Ventos da Serra", subtitle: "108 MW · 24 WTG" }}
        nav={NAV}
        active="substation"
        breadcrumb={[{ label: "Site", href: "#overview" }, { label: "Substation" }]}
        user={{ name: "operator1", role: "Operator" }}
        timeZone="America/Sao_Paulo"
        now={NOW}
        {...extra}
      />,
      { alarms: alarmsService(alarms) },
    );

  it("shows the site, marks the current page and the breadcrumb", () => {
    const html = header([]);
    expect(html).toContain("Ventos da Serra");
    expect(html).toMatch(/kh-nav-item kh-nav-item--active" aria-current="page"[^>]*>Substation</);
    expect(html).toContain('<a href="#overview">Site</a>');
    expect(html).toContain("No active alarms");
  });

  it("shows the local time with its offset and the user", () => {
    const html = header([]);
    expect(html).toContain(">14:32:41<");
    expect(html).toContain("GMT-3");
    expect(html).toContain("Signed in as");
    expect(html).toContain("operator1");
    expect(html).toContain(">OP<");
  });

  it("counts alarms per priority and flashes only priorities with unacknowledged alarms", () => {
    const html = header([alarm({}), alarm({ instanceId: "i2", priority: 3, severity: "low", acked: true }), alarm({ instanceId: "i3", priority: 3, severity: "low" })]);
    // The name comes from the content: hidden words around the visible count.
    expect(html).toContain("Priority 1:");
    expect(html).toContain("alarms, 1 not acknowledged");
    expect(spokenText(html)).toContain("Priority 3: 2 alarms, 1 not acknowledged");
    expect(html).toContain("2 unacked");
    expect(count(html, "kh-alarm-shape--unacked")).toBe(2 + 1); // P1 and P3 summary items, plus the banner
  });

  it("puts the newest unacknowledged alarm in the banner with its dictionary text", () => {
    const html = header([alarm({ instanceId: "new", acked: true, name: "x", condition: "y" }), alarm({})], { onAck: () => {}, onOpenAlarms: () => {} });
    expect(html).toContain("WTG 14 converter fault");
    expect(html).toContain("Wind farm · F3");
    expect(html).toContain(">14:32:07<");
    expect(html).toContain(">Ack<");
    expect(html).toContain(">Alarm list<");
  });

  it("offers no Ack without the permission", () => {
    expect(header([alarm({})])).not.toContain(">Ack<");
  });

  it("picks the banner alarm", () => {
    expect(bannerAlarm([alarm({ instanceId: "a", acked: true }), alarm({ instanceId: "b" })])?.instanceId).toBe("b");
    expect(bannerAlarm([alarm({ instanceId: "a", acked: true })])?.instanceId).toBe("a");
    expect(bannerAlarm([])).toBeNull();
    // Raised together: the most urgent one wins.
    expect(bannerAlarm([alarm({ instanceId: "p3", priority: 3 }), alarm({ instanceId: "p1", priority: 1 })])?.instanceId).toBe("p1");
    const later = new Date("2026-10-25T17:40:00Z");
    expect(bannerAlarm([alarm({ instanceId: "old-p1" }), alarm({ instanceId: "new-p3", priority: 3, timestamp: later })])?.instanceId).toBe("new-p3");
  });
});

describe("footer", () => {
  const beat = (id: string, status: Heartbeat["status"]): Heartbeat => ({ id, status, lastSeenAt: null });
  const footer = (connection: ConnectionState, agents: Heartbeat[]) =>
    render(<Footer agents={new Map(agents.map((a) => [a.id, a]))}>v0.1</Footer>, {
      backend: { connection: writable(connection) } as unknown as HmiServices["backend"],
    });

  it("shows the API link and how many agents are online", () => {
    const html = footer("online", [beat("a", "online"), beat("b", "offline")]);
    expect(html).toContain("API Online");
    expect(html).toContain("Agents 1/2 online");
    expect(html).toContain("kh-dot--offline");
    expect(html).toContain("v0.1");
  });

  it("shows a dropped link by shape", () => {
    expect(footer("offline", [])).toContain("kh-dot kh-dot--offline");
  });
});

describe("shell", () => {
  it("lays out header, view and footer, at a fixed canvas when asked", () => {
    const html = render(
      <AppShell header={<header>h</header>} footer={<footer>f</footer>} canvas={{ width: 1920, height: 1080 }}>
        view
      </AppShell>,
    );
    expect(html).toContain('class="kh-shell-stage"');
    expect(html).toContain("width:1920px;height:1080px");
    expect(html).toContain('<main class="kh-shell-main" tabindex="0">view</main>');
  });

  it("names the most capable role", () => {
    expect(roleKey(new Set([SCADA_ROLES.operator, SCADA_ROLES.interlockBypass]))).toBe("shell.role.supervisor");
    expect(roleKey(new Set([SCADA_ROLES.viewer]))).toBe("shell.role.viewer");
    expect(roleKey(new Set())).toBe("shell.role.none");
  });
});
