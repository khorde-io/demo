// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createCommandService, type Permission } from "@khorde/hmi-core";
import { createMockBackend } from "@khorde/hmi-core/mock";
import { mount } from "../test-dom.tsx";
import { CommandDialog } from "./CommandDialog.tsx";
import { Faceplate } from "./Faceplate.tsx";

const AGENT = "vds-substation";
const OPEN = { agent: AGENT, equipment: "vds.sub.f1.cb", name: "pos.open" };
const CLOSE = { agent: AGENT, equipment: "vds.sub.f1.cb", name: "pos.close" };

function plant() {
  return createMockBackend({
    agents: [AGENT],
    stepMs: 1,
    points: [
      { equipment: "vds.sub.f1.cb", name: "pos", type: "discrete", value: 1, agent: AGENT },
      { equipment: "vds.sub.f1.es", name: "pos", type: "discrete", value: 1, agent: AGENT },
    ],
    commands: [OPEN, { ...CLOSE, interlock: "es_open" }],
    interlocks: { es_open: { expression: { eq: ["vds.sub.f1.es::pos", 0] } } },
  });
}

const as = (...perms: Permission[]) => ({ can: (p: Permission) => perms.includes(p) });
async function dialog(key: typeof OPEN, perms: Permission[], verb: string) {
  const backend = plant();
  const permissions = as(...perms);
  const commands = createCommandService(backend, { permissions, pollIntervalMs: 2 });
  const onDone = vi.fn();
  const auth = permissions as never;
  const m = await mount(<CommandDialog command={key} title={`${verb} F1 circuit breaker`} verb={verb.toLowerCase()} onClose={() => {}} onDone={onDone} />, { commands, auth });
  await m.settle(5);
  return { m, onDone };
}

describe("command dialog", () => {
  it("selects, confirms and follows the request to success", async () => {
    const { m, onDone } = await dialog(OPEN, ["operate"], "Open");
    expect(m.container.textContent).toContain("Selection expires in 30 s");
    expect(m.container.textContent).toContain("None"); // no interlock on open
    await m.click(m.button("Confirm open"));
    for (let i = 0; i < 50 && !onDone.mock.calls.length; i++) await m.settle(5);
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: "success" }));
    expect(m.container.textContent).toContain("Command completed");
    expect(m.container.textContent).toContain("Forwarded to agent");
    m.unmount();
  });

  it("will not confirm a blocked command, and offers bypass only to those allowed", async () => {
    const op = await dialog(CLOSE, ["operate"], "Close");
    expect(op.m.container.textContent).toContain("Blocked");
    expect(op.m.button("Confirm close").disabled).toBe(true);
    expect(op.m.container.textContent).not.toContain("Bypass the interlock");
    op.m.unmount();

    const sup = await dialog(CLOSE, ["operate", "bypassInterlock"], "Close");
    const box = sup.m.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await sup.m.click(box);
    expect(sup.m.button("Confirm close").disabled).toBe(false);
    await sup.m.click(sup.m.button("Confirm close"));
    for (let i = 0; i < 50 && !sup.onDone.mock.calls.length; i++) await sup.m.settle(5);
    expect(sup.m.container.textContent).toContain("Forwarded to agent, interlock bypassed");
    sup.m.unmount();
  });

  it("tells a viewer they may not send commands", async () => {
    const { m } = await dialog(OPEN, ["view"], "Open");
    expect(m.container.textContent).toContain("You are not allowed to do this");
    expect(m.container.textContent).toContain("Your role can view this command but not send it.");
    m.unmount();
  });

  it("checks an analog value before it can be sent", async () => {
    const backend = plant();
    const commands = createCommandService(backend, { permissions: as("operate") });
    const m = await mount(
      <CommandDialog command={OPEN} title="Set curtailment" verb="set" analog={{ min: 0, max: 4500, unit: "kW", initial: 6000 }} onClose={() => {}} />,
      { commands },
    );
    await m.settle(5);
    expect(m.container.textContent).toContain("Enter a value between 0 and 4500");
    expect(m.button("Confirm set").disabled).toBe(true);
    m.unmount();
  });
});

describe("faceplate", () => {
  const tabs = [
    { id: "overview", label: "Overview", content: <p>overview body</p> },
    { id: "control", label: "Control", content: <p>control body</p> },
  ];

  it("shows the active tab, moves with the arrow keys and closes on Escape", async () => {
    let active = "overview";
    const onClose = vi.fn();
    const onTab = vi.fn((id: string) => (active = id));
    const m = await mount(<Faceplate title="F1 · WTG 01–06" subtitle="vds.sub.mv.a.f1" tabs={tabs} activeTab={active} onTabChange={onTab} onClose={onClose} />);
    expect(m.container.textContent).toContain("overview body");
    expect(m.container.querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")).toBeTruthy();
    const tablist = m.container.querySelector('[role="tablist"]') as HTMLElement;
    await act(async () => {
      tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(onTab).toHaveBeenCalledWith("control");
    const dlg = m.container.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => {
      dlg.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
    m.unmount();
  });
});
