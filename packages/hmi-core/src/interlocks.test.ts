import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  analyzeFlow,
  buildTree,
  conditions,
  commandId,
  createInterlockStatesWatcher,
  createInterlockWatcher,
  evaluate,
  expandRefs,
  inputPoints,
  treeFromDetail,
  type Expression,
} from "./interlocks.ts";
import { createMockBackend } from "./mock/backend.ts";
import type { InterlockDetail } from "./model.ts";
import { createPointStore } from "./points.ts";
import { syncScheduler } from "./store.ts";
import { CB, CB_CLOSE, ES_CLOSE, feederBay, tick } from "./test-fixtures.ts";

/** commandInterlockDetail as the demo hub returned it for the bus coupler close (both incomers closed). */
const COUPLER: InterlockDetail = JSON.parse(readFileSync(new URL("../test-data/interlock-detail.bus-coupler.json", import.meta.url), "utf8"));

const values: Record<string, number> = { "a::x": 1, "b::y": 5 };
const read = (id: string) => ({ value: values[id] ?? null, good: id in values });
const statesOf = (expr: Expression, refs: Record<string, Expression> = {}) =>
  new Map(evaluate(expr, read, refs).nodeStates.map((n) => [n.path, n.state] as const));

describe("evaluate", () => {
  it("names node states with the hub's paths", () => {
    const expr: Expression = { and: [{ eq: ["a::x", 1] }, { or: [{ gt: ["b::y", 10] }, { not: { eq: ["a::x", 0] } }] }] };
    const r = evaluate(expr, read);
    expect(r.state).toBe("PERMIT");
    expect(Object.fromEntries(r.nodeStates.map((n) => [n.path, n.state]))).toEqual({
      $: "PERMIT",
      "$.and.0": "PERMIT",
      "$.and.1": "PERMIT",
      "$.and.1.or.0": "BLOCK",
      "$.and.1.or.1": "PERMIT",
      "$.and.1.or.1.not": "BLOCK",
    });
  });

  it("reports bad quality when an input is missing, unless another input already blocks", () => {
    expect(evaluate({ lt: ["missing::v", 1] }, read).state).toBe("BAD_QUALITY");
    expect(evaluate({ and: [{ lt: ["missing::v", 1] }, { eq: ["a::x", 0] }] }, read).state).toBe("BLOCK");
    expect(evaluate({ or: [{ lt: ["missing::v", 1] }, { eq: ["a::x", 1] }] }, read).state).toBe("PERMIT");
  });

  it("evaluates references under .ref:<key>", () => {
    const refs = { x_is_one: { eq: ["a::x", 1] } as Expression };
    const states = statesOf({ and: [{ ref: "x_is_one" }] }, refs);
    expect(states.get("$.and.0")).toBe("PERMIT");
    expect(states.get("$.and.0.ref:x_is_one")).toBe("PERMIT");
  });

  it("expands references the way the hub's graph does", () => {
    const refs = { x_is_one: { eq: ["a::x", 1] } as Expression };
    expect(expandRefs({ and: [{ ref: "x_is_one" }, { ref: "missing" }] }, refs)).toEqual({
      and: [{ ref_group: { key: "x_is_one", expression: { eq: ["a::x", 1] } } }, { ref: "missing" }],
    });
  });
});

describe("tree from the hub", () => {
  it("reads the real bus coupler detail: paths, ref_group and states", () => {
    const tree = treeFromDetail(COUPLER);
    expect(tree).toMatchObject({
      kind: "and",
      path: "$",
      state: "BLOCK",
      children: [
        { kind: "ref", ref: "sub_mv_bc_cb_remote", state: "PERMIT", children: [{ kind: "compare", path: "$.and.0.ref:sub_mv_bc_cb_remote", state: "PERMIT" }] },
        { kind: "compare", state: "PERMIT" },
        { kind: "compare", state: "PERMIT" },
        { kind: "or", path: "$.and.3", state: "BLOCK", children: [{ state: "BLOCK" }, { state: "BLOCK" }] },
      ],
    });
    expect(inputPoints(tree)).toEqual([
      "vds.sub.mv.bc.cb::remote_local",
      "vds.sub.mv.bc.ds_a::pos",
      "vds.sub.mv.bc.ds_b::pos",
      "vds.sub.mv.a.tr1.cb::pos",
      "vds.sub.mv.b.tr2.cb::pos",
    ]);
  });

  it("numbers the conditions in reading order and keeps their shared interlock", () => {
    const list = conditions(treeFromDetail(COUPLER));
    expect(list.map((c) => [c.n, c.path, c.within])).toEqual([
      [1, "$.and.0.ref:sub_mv_bc_cb_remote", ["sub_mv_bc_cb_remote"]],
      [2, "$.and.1", []],
      [3, "$.and.2", []],
      [4, "$.and.3.or.0", []],
      [5, "$.and.3.or.1", []],
    ]);
  });

  it("finds where permission stops: both incomers, since either one would do", () => {
    const flow = analyzeFlow(treeFromDetail(COUPLER));
    expect(flow.allowed).toBe(false);
    expect(flow.stoppers).toEqual(["$.and.3.or.0", "$.and.3.or.1"]);
    expect(flow.byPath.get("$.and.2")).toEqual({ reached: true, passes: true, needed: true, stops: false });
  });
});

describe("flow", () => {
  const tree = (expr: Expression, vals: Record<string, number>) => {
    const r = (id: string) => ({ value: vals[id] ?? null, good: id in vals });
    return buildTree(expandRefs(expr, {}), new Map(evaluate(expr, r).nodeStates.map((n) => [n.path, n.state] as const)));
  };

  it("stops at the first blocking condition in series; later ones are not reached", () => {
    const flow = analyzeFlow(tree({ and: [{ eq: ["a::x", 0] }, { eq: ["b::y", 0] }] }, { "a::x": 1, "b::y": 1 }));
    expect(flow.stoppers).toEqual(["$.and.0"]);
    expect(flow.byPath.get("$.and.1")).toMatchObject({ reached: false, stops: false });
  });

  it("marks branches of a satisfied OR as not needed", () => {
    const flow = analyzeFlow(tree({ or: [{ eq: ["a::x", 1] }, { eq: ["b::y", 0] }] }, { "a::x": 1, "b::y": 1 }));
    expect(flow.allowed).toBe(true);
    expect(flow.stoppers).toEqual([]);
    expect(flow.byPath.get("$.or.1")).toMatchObject({ reached: true, passes: false, needed: false });
  });

  it("folds a NOT around one comparison into a single negated condition", () => {
    const t = tree({ and: [{ not: { eq: ["a::x", 1] } }] }, { "a::x": 0 });
    expect(conditions(t)).toMatchObject([{ path: "$.and.0", negated: true, compare: { op: "ne", operands: ["a::x", 1] }, state: "PERMIT" }]);
    expect(analyzeFlow(t).allowed).toBe(true);
  });

  it("treats a NOT around a group as one gate and its inside as context", () => {
    const t = tree({ not: { and: [{ eq: ["a::x", 1] }, { eq: ["b::y", 1] }] } }, { "a::x": 1, "b::y": 1 });
    const flow = analyzeFlow(t);
    expect(flow.allowed).toBe(false);
    expect(flow.stoppers).toEqual(["$"]);
    expect(flow.byPath.get("$.not.and.0")).toMatchObject({ needed: false, stops: false });
  });

  it("does not let bad quality through", () => {
    const flow = analyzeFlow(tree({ eq: ["missing::v", 1] }, {}));
    expect(flow.allowed).toBe(false);
    expect(flow.stoppers).toEqual(["$"]);
  });
});

describe("interlock watcher", () => {
  it("re-queries when an input point changes", async () => {
    const backend = createMockBackend(feederBay());
    const points = createPointStore(backend, { debounceMs: 0, scheduler: syncScheduler });
    const watcher = createInterlockWatcher(backend, points, ES_CLOSE, { debounceMs: 0 });
    await watcher.start();
    expect(watcher.get().detail?.outcome).toBe("BLOCK");
    expect(watcher.get().tree?.children.map((c) => c.state)).toEqual(["PERMIT", "BLOCK", "BLOCK"]);

    backend.publish("vds.sub.f1.ds::pos", 0);
    backend.publish("vds.sub.f1::v_kv", 0);
    // The re-query is debounced and asynchronous; wait for it rather than for a fixed time.
    for (let i = 0; i < 100 && watcher.get().detail?.outcome !== "PERMIT"; i++) await tick(5);
    expect(watcher.get().detail?.outcome).toBe("PERMIT");
    watcher.stop();
  });

  it("gets graphs with expanded references from the mock, like the hub", async () => {
    const backend = createMockBackend(
      feederBay({
        commands: [{ ...ES_CLOSE, interlock: "es_close" }],
        interlocks: {
          remote: { expression: { eq: ["vds.sub.f1.cb::remote_local", 1] } },
          es_close: { expression: { and: [{ ref: "remote" }, { eq: ["vds.sub.f1.ds::pos", 0] }] } },
        },
      }),
    );
    const detail = await backend.interlockDetail(ES_CLOSE);
    expect(detail.graph).toEqual({ and: [{ ref_group: { key: "remote", expression: { eq: ["vds.sub.f1.cb::remote_local", 1] } } }, { eq: ["vds.sub.f1.ds::pos", 0] }] });
    expect(treeFromDetail(detail)?.children[0]).toMatchObject({ kind: "ref", state: "PERMIT", children: [{ state: "PERMIT" }] });
  });
});

describe("interlock states of many commands", () => {
  const setup = async () => {
    const backend = createMockBackend(feederBay());
    const points = createPointStore(backend, { debounceMs: 0, scheduler: syncScheduler });
    const watcher = createInterlockStatesWatcher(backend, points, [CB, CB_CLOSE, ES_CLOSE], { debounceMs: 0 });
    await watcher.start();
    await tick(10);
    const of = (k: typeof CB) => watcher.get().get(commandId(k));
    const until = async (k: typeof CB, s: string) => {
      for (let i = 0; i < 100 && of(k) !== s; i++) await tick(5);
    };
    return { backend, watcher, of, until };
  };

  it("tells which commands are interlocked, allowed or have no interlock, in one call", async () => {
    const { watcher, of } = await setup();
    expect(of(CB)).toBe("none");
    expect(of(CB_CLOSE)).toBe("permit");
    expect(of(ES_CLOSE)).toBe("block");
    watcher.stop();
  });

  it("follows the inputs and asks again when one changes", async () => {
    const { backend, watcher, of, until } = await setup();
    backend.publish("vds.sub.f1.es::pos", 1);
    await until(CB_CLOSE, "block");
    expect(of(CB_CLOSE)).toBe("block");
    backend.publish("vds.sub.f1.ds::pos", 0);
    backend.publish("vds.sub.f1::v_kv", 0);
    await until(ES_CLOSE, "permit");
    expect(of(ES_CLOSE)).toBe("permit");
    watcher.stop();
  });

  it("is unknown while an input is stale, so an old answer is not shown as current", async () => {
    const { backend, watcher, of, until } = await setup();
    backend.setConnection("offline");
    await until(CB_CLOSE, "unknown");
    expect(of(CB_CLOSE)).toBe("unknown");
    expect(of(CB)).toBe("none");
    watcher.stop();
  });
});
