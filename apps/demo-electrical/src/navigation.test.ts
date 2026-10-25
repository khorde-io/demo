import { describe, expect, it } from "vitest";
import { focusOf, parseRoute, routeHash } from "./navigation.ts";

describe("routes", () => {
  it("reads a page and the equipment in focus", () => {
    expect(parseRoute("#substation/vds.sub.mv.a.f1.cb")).toEqual({ page: "substation", focus: "vds.sub.mv.a.f1.cb" });
    expect(parseRoute("#windfarm")).toEqual({ page: "windfarm", focus: null });
    expect(routeHash({ page: "windfarm", focus: "vds.wf.f1.t03" })).toBe("#windfarm/vds.wf.f1.t03");
  });

  it("falls back to the overview and drops unknown equipment", () => {
    expect(parseRoute("")).toEqual({ page: "overview", focus: null });
    expect(parseRoute("#nope")).toEqual({ page: "overview", focus: null });
    expect(parseRoute("#substation/vds.nothing")).toEqual({ page: "substation", focus: null });
  });

  it("opens the bay of a device, a transformer or a turbine", () => {
    expect(focusOf("vds.sub.mv.bc.ds_b")).toEqual({ kind: "bay", id: "vds.sub.mv.bc", device: "vds.sub.mv.bc.ds_b" });
    expect(focusOf("vds.sub.tr2")).toEqual({ kind: "transformer", id: "vds.sub.tr2" });
    expect(focusOf("vds.wf.f4.t24")).toEqual({ kind: "turbine", id: "vds.wf.f4.t24" });
  });
});
