import { describe, expect, it } from "vitest";
import { analyzeFlow, buildTree, conditions, treeFromDetail, type InterlockNode, type NodeState } from "@khorde/hmi-core";
import { DEFAULT_METRICS as M, layoutLadder, type GateBox } from "./layout.ts";
import { COUPLER, couplerWithTr1Open } from "./test-support.ts";

const ladderOf = (tree: InterlockNode | null) => layoutLadder(tree, analyzeFlow(tree), conditions(tree));
const gateAt = (l: ReturnType<typeof ladderOf>, n: number) => {
  const g = l.gates.find((x) => x.condition.n === n);
  if (!g) throw new Error(`no gate ${n}`);
  return g;
};

describe("ladder layout", () => {
  const blocked = ladderOf(treeFromDetail(COUPLER));

  it("draws the coupler interlock: a shared frame, three gates in series, then two branches", () => {
    expect(blocked.gates.map((g) => g.condition.n)).toEqual([1, 2, 3, 4, 5]);
    expect(blocked.frames).toMatchObject([{ kind: "ref", key: "sub_mv_bc_cb_remote" }]);
    const [g1, g2, g3, g4, g5] = [1, 2, 3, 4, 5].map((n) => gateAt(blocked, n)) as [GateBox, GateBox, GateBox, GateBox, GateBox];
    // Series: same column, going down.
    expect(new Set([g1, g2, g3].map((g) => g.x)).size).toBe(1);
    expect(g1.y < g2.y && g2.y < g3.y && g3.y < g4.y).toBe(true);
    // Parallel: same row, side by side, centred on the main line.
    expect(g4.y).toBe(g5.y);
    expect(g5.x - g4.x).toBe(M.gateWidth + M.gap);
    expect((g4.x + g5.x + M.gateWidth) / 2).toBeCloseTo(blocked.start.x);
  });

  it("keeps everything inside the drawing", () => {
    for (const g of blocked.gates) {
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x + g.w).toBeLessThanOrEqual(blocked.width);
      expect(g.y + g.h).toBeLessThan(blocked.end.y);
    }
    for (const w of blocked.wires) expect(Math.max(w.y1, w.y2)).toBeLessThanOrEqual(blocked.height);
    const ref = blocked.frames[0]!;
    expect(ref.w).toBeGreaterThanOrEqual(2 * ("sub_mv_bc_cb_remote".length * M.titleCharWidth));
  });

  it("lights the wire down to where permission stops, and not past it", () => {
    expect(blocked.end.allowed).toBe(false);
    const g4 = gateAt(blocked, 4);
    const intoG4 = blocked.wires.find((w) => w.x1 === w.x2 && w.y2 === g4.y && w.x1 === g4.x + g4.w / 2);
    const outOfG4 = blocked.wires.find((w) => w.x1 === w.x2 && w.y1 === g4.y + g4.h && w.x1 === g4.x + g4.w / 2);
    expect(intoG4?.live).toBe(true);
    expect(outOfG4?.live).toBe(false);
    expect(gateAt(blocked, 4).flow.stops && gateAt(blocked, 5).flow.stops).toBe(true);
  });

  it("joins the live branch to the end when one incomer opens", () => {
    const open = ladderOf(treeFromDetail(couplerWithTr1Open()));
    expect(open.end.allowed).toBe(true);
    const g4 = gateAt(open, 4);
    const joinY = Math.max(...open.wires.filter((w) => w.y1 === w.y2).map((w) => w.y1));
    expect(open.wires.some((w) => w.live && w.y1 === joinY && Math.min(w.x1, w.x2) === g4.x + g4.w / 2)).toBe(true);
    // The other branch is no longer needed, so it does not "block here".
    expect(gateAt(open, 5).flow).toMatchObject({ stops: false, needed: false });
  });

  it("folds a NOT around one comparison into a gate and frames a NOT around a group", () => {
    const states = (m: Record<string, NodeState>) => new Map(Object.entries(m));
    const folded = ladderOf(buildTree({ not: { eq: ["a::x", 1] } }, states({ $: "PERMIT", "$.not": "BLOCK" })));
    expect(folded.frames).toEqual([]);
    expect(folded.gates).toHaveLength(1);
    expect(folded.end.allowed).toBe(true);

    const group = ladderOf(
      buildTree({ not: { and: [{ eq: ["a::x", 1] }, { eq: ["b::y", 1] }] } }, states({ $: "BLOCK", "$.not": "PERMIT", "$.not.and.0": "PERMIT", "$.not.and.1": "PERMIT" })),
    );
    expect(group.frames).toMatchObject([{ kind: "not", flow: { stops: true } }]);
    expect(group.gates.every((g) => !g.flow.stops)).toBe(true);
    expect(group.end.allowed).toBe(false);
  });

  it("is wide enough for the end label even for a single gate", () => {
    const one = ladderOf(buildTree({ eq: ["a::x", 1] }, new Map([["$", "BLOCK"]])));
    expect(one.width).toBeGreaterThanOrEqual(2 * M.labelRoom);
  });
});
