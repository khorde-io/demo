import { afterAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { HmiProvider } from "@khorde/hmi-react";
import { boot } from "../boot.ts";
import { focusOf } from "../navigation.ts";
import { EquipmentFaceplate } from "../faceplates/EquipmentFaceplate.tsx";
import { OverviewScreen } from "./OverviewScreen.tsx";
import { SubstationScreen } from "./SubstationScreen.tsx";
import { WindFarmScreen } from "./WindFarmScreen.tsx";

// Every screen renders against the in-browser plant without errors and shows its parts.
const booted = await boot("mock");
afterAll(() => booted.site?.stop());
const render = (node: ReactNode) => renderToStaticMarkup(<HmiProvider hmi={booted.hmi}>{node}</HmiProvider>);
const noop = () => {};

describe("plant screens", () => {
  it("draws every bay of the single-line", () => {
    const html = render(<SubstationScreen focus={null} onFocus={noop} />);
    for (const name of ["F1 CB", "F4 ES", "Coupler DS B", "TR2 incomer CB", "L1 DS"]) expect(html).toContain(name);
    expect(html).toContain("Bus coupler");
  });

  it("lays out one tile per turbine", () => {
    const html = render(<WindFarmScreen focus={null} onFocus={noop} />);
    expect(html.match(/kh-tile /g)).toHaveLength(booted.plant.turbines.length);
  });

  it("summarises the site", () => {
    const html = render(<OverviewScreen onNavigate={noop} />);
    for (const t of ["Export to grid", "Alarms by area", "Collector feeders", "Turbines F4"]) expect(html).toContain(t);
  });

  it("opens a faceplate for a bay device, a transformer and a turbine", () => {
    for (const id of ["vds.sub.mv.bc.ds_b", "vds.sub.tr1", "vds.wf.f2.t09"]) {
      const focus = focusOf(id);
      if (!focus) throw new Error(id);
      expect(render(<EquipmentFaceplate focus={focus} onClose={noop} />)).toContain(booted.hmi.i18n.equipmentName(focus.id));
    }
  });
});
