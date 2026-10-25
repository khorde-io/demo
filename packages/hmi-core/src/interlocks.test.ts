import { describe, expect, it } from "vitest";
import { buildTree, createInterlockWatcher, evaluate, inputPoints, treeFromDetail, type Expression } from "./interlocks.ts";
import { createMockBackend } from "./mock/backend.ts";
import { createPointStore } from "./points.ts";
import { syncScheduler } from "./store.ts";
import { ES_CLOSE, feederBay, tick } from "./test-fixtures.ts";

const values: Record<string, number> = { "a::x": 1, "b::y": 5 };
const read = (id: string) => ({ value: values[id] ?? null, good: id in values });

describe("evaluate", () => {
  it("evaluates logic and comparisons with node states by path", () => {
    const expr: Expression = { and: [{ eq: ["a::x", 1] }, { or: [{ gt: ["b::y", 10] }, { not: { eq: ["a::x", 0] } }] }] };
    const r = evaluate(expr, read);
    expect(r.state).toBe("PERMIT");
    expect(Object.fromEntries(r.nodeStates.map((n) => [n.path, n.state]))).toEqual({
      "": "PERMIT",
      "0": "PERMIT",
      "1": "PERMIT",
      "1.0": "BLOCK",
      "1.1": "PERMIT",
      "1.1.0": "BLOCK",
    });
  });

  it("reports bad quality when an input is missing", () => {
    expect(evaluate({ lt: ["missing::v", 1] }, read).state).toBe("BAD_QUALITY");
  });

  it("inlines references", () => {
    expect(evaluate({ ref: "x_is_one" }, read, { x_is_one: { eq: ["a::x", 1] } }).state).toBe("PERMIT");
  });
});

describe("tree", () => {
  it("builds a display tree with states and lists its input points", () => {
    const expr: Expression = { and: [{ eq: ["a::x", 1] }, { lt: ["b::y", 1] }] };
    const r = evaluate(expr, read);
    const tree = buildTree(expr, new Map(r.nodeStates.map((n) => [n.path, n.state])));
    expect(tree).toMatchObject({ kind: "and", state: "BLOCK", children: [{ kind: "compare", op: "eq", state: "PERMIT" }, { kind: "compare", op: "lt", state: "BLOCK" }] });
    expect(inputPoints(tree)).toEqual(["a::x", "b::y"]);
  });

  it("accepts a graph wrapped as {expression} and root-prefixed paths", () => {
    const tree = treeFromDetail({
      agent: "a", equipment: "e", name: "n", hasInterlock: true, outcome: "BLOCK", key: "k", description: null,
      graph: { expression: { not: { eq: ["a::x", 1] } } },
      nodeStates: [{ path: "root", state: "BLOCK" }, { path: "root/0", state: "PERMIT" }],
    });
    expect(tree).toMatchObject({ kind: "not", state: "BLOCK", children: [{ state: "PERMIT" }] });
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
    await tick(10);
    expect(watcher.get().detail?.outcome).toBe("PERMIT");
    watcher.stop();
  });
});
