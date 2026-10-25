// @vitest-environment happy-dom
import { afterAll, describe, expect, it } from "vitest";
import axe from "axe-core";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HmiProvider } from "@khorde/hmi-react";
import { boot } from "../boot.ts";
import { focusOf } from "../navigation.ts";
import { EquipmentFaceplate } from "../faceplates/EquipmentFaceplate.tsx";
import { AlarmsScreen } from "./AlarmsScreen.tsx";
import { CommsScreen } from "./CommsScreen.tsx";
import { OverviewScreen } from "./OverviewScreen.tsx";
import { SubstationScreen } from "./SubstationScreen.tsx";
import { WindFarmScreen } from "./WindFarmScreen.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Structure, names, roles and required attributes. Contrast and "label in
// name" need real layout, which happy-dom lacks (axe reports them as
// incomplete there): the browser audit in docs/accessibility.md covers them,
// and the theme contract test covers the token contrasts.
const booted = await boot("mock");
await booted.hmi.start();
afterAll(() => {
  booted.site?.stop();
  booted.hmi.stop();
});
const noop = () => {};

async function violations(node: ReactNode) {
  const container = document.createElement("main");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<HmiProvider hmi={booted.hmi}>{node}</HmiProvider>));
  await act(async () => new Promise((r) => setTimeout(r, 100)));
  const result = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  act(() => root.unmount());
  container.remove();
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

describe("accessibility of the plant screens", () => {
  it("catches a broken control (so a pass means something)", async () => {
    expect(await violations(<button type="button" />)).not.toEqual([]);
  });

  it.each([
    ["overview", () => <OverviewScreen onNavigate={noop} />],
    ["substation", () => <SubstationScreen focus={null} onFocus={noop} />],
    ["wind farm", () => <WindFarmScreen focus={null} onFocus={noop} />],
    ["alarms", () => <AlarmsScreen onNavigate={noop} />],
    ["comms", () => <CommsScreen agents={booted.hmi.agents} onOpenTurbine={noop} />],
  ])("%s has no axe violations", async (_name, screen) => {
    expect(await violations(screen())).toEqual([]);
  });

  it.each(["vds.sub.mv.a.f1.cb", "vds.sub.tr2", "vds.wf.f3.t14"])("the faceplate of %s has no axe violations", async (id) => {
    const focus = focusOf(id);
    if (!focus) throw new Error(id);
    expect(await violations(<EquipmentFaceplate focus={focus} onClose={noop} />)).toEqual([]);
  });
});
