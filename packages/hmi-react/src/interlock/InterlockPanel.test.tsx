import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { conditions, treeFromDetail, type InterlockDetail, type InterlockView, type PointId, type PointValue } from "@khorde/hmi-core";
import { HmiProvider } from "../context.tsx";
import { InterlockPanel } from "./InterlockPanel.tsx";
import { describeCondition } from "./labels.ts";
import { COUPLER, couplerWithTr1Open, i18n, value } from "./test-support.ts";

const VALUES = new Map<PointId, PointValue>(
  (
    [
      ["vds.sub.mv.bc.cb::remote_local", 1],
      ["vds.sub.mv.bc.ds_a::pos", 1],
      ["vds.sub.mv.bc.ds_b::pos", 1],
      ["vds.sub.mv.a.tr1.cb::pos", 1],
      ["vds.sub.mv.b.tr2.cb::pos", 1],
    ] as const
  ).map(([id, v]) => [id, value(id, v)]),
);

const viewOf = (detail: InterlockDetail | null, extra: Partial<InterlockView> = {}): InterlockView => ({
  detail,
  tree: detail ? treeFromDetail(detail) : null,
  loading: false,
  error: null,
  ...extra,
});

const render = (view: InterlockView) =>
  renderToStaticMarkup(
    <HmiProvider hmi={{ i18n }}>
      <InterlockPanel view={view} command="Close" values={VALUES} />
    </HmiProvider>,
  );

const count = (html: string, s: string) => html.split(s).length - 1;

describe("condition texts", () => {
  it("builds gate and list texts from the dictionaries", () => {
    const texts = conditions(treeFromDetail(COUPLER)).map((c) => describeCondition(i18n, c));
    expect(texts.map((t) => t.short)).toEqual(["Coupler CB Remote", "DS A Closed", "DS B Closed", "TR1 incomer Open", "TR2 incomer Open"]);
    expect(texts[0]).toMatchObject({ full: "Coupler CB control Remote", expression: "eq vds.sub.mv.bc.cb::remote_local, 1" });
  });

  it("writes analog limits with the unit, and negations and mirrored operands from the point's side", () => {
    const one = (expr: object) => describeCondition(i18n, conditions(treeFromDetail({ ...COUPLER, graph: expr, nodeStates: [] }))[0]!);
    expect(one({ lt: ["vds.sub.mv.a.f1::v_kv", 1] }).short).toBe("F1 Voltage < 1 kV");
    expect(one({ gt: [1, "vds.sub.mv.a.f1::v_kv"] }).short).toBe("F1 Voltage < 1 kV");
    expect(one({ not: { eq: ["vds.sub.mv.bc.ds_a::pos", 1] } })).toMatchObject({ short: "DS A not Closed", expression: "not eq vds.sub.mv.bc.ds_a::pos, 1" });
  });
});

describe("InterlockPanel", () => {
  it("shows the blocked coupler: outcome, five gates, both incomers blocking", () => {
    const html = render(viewOf(COUPLER));
    expect(html).toContain("sub_mv_bc_cb_close");
    expect(html).toContain("Block · 2 conditions stop it");
    expect(count(html, 'class="kh-ilk-gate ')).toBe(5);
    expect(count(html, "kh-ilk-gate--stops")).toBe(2);
    expect(count(html, "kh-ilk-cond--stops")).toBe(2);
    expect(html).toContain("Close not allowed");
    expect(html).toContain("TR1 incomer Open");
    expect(html).toContain("now Closed");
    expect(html).toContain("Shared interlock sub_mv_bc_cb_remote");
  });

  it("shows the allowed path once TR1's incomer is open", () => {
    const html = render(viewOf(couplerWithTr1Open()));
    expect(html).toContain(">Permit<");
    expect(html).toContain("Close allowed");
    expect(html).toContain("kh-ilk-end--allowed");
    expect(count(html, "kh-ilk-gate--stops")).toBe(0);
    expect(html).toContain("Block · Not needed");
  });

  it("marks a condition with bad quality as unknown", () => {
    const bad: InterlockDetail = {
      ...COUPLER,
      nodeStates: COUPLER.nodeStates.map((n) => (n.path === "$.and.1" ? { ...n, state: "BAD_QUALITY" } : n)),
    };
    const html = render(viewOf(bad));
    expect(html).toContain("kh-ilk-gate--unknown");
    expect(count(html, "kh-ilk-gate--stops")).toBe(1);
  });

  it("says when a command has no interlock, and while it loads or fails", () => {
    expect(render(viewOf({ ...COUPLER, hasInterlock: false }))).toContain("No interlock on this command");
    expect(render(viewOf(null, { loading: true }))).toContain("Reading interlock");
    expect(render(viewOf(null, { error: new Error("down") }))).toContain("Interlock state unavailable");
  });
});
