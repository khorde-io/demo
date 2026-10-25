/**
 * Geometry of the interlock ladder: a series-parallel diagram read top to
 * bottom, from the command request to the end node. AND stacks its children in
 * series, OR places them side by side between a split and a join bar, shared
 * interlocks and NOT groups get a frame. Each block's wire enters at its top
 * centre and leaves at its bottom centre. Pure functions, no DOM.
 */

import { foldedNot, type Condition, type FlowInfo, type InterlockFlow, type InterlockNode } from "@khorde/hmi-core";

export interface LadderMetrics {
  gateWidth: number;
  gateHeight: number;
  /** Wire above and below each gate. */
  stub: number;
  /** Space between OR branches. */
  gap: number;
  /** Height of the split and of the join area of an OR. */
  bar: number;
  framePad: number;
  frameTitle: number;
  /** Average width of a frame-title character, to fit a shared interlock's key. */
  titleCharWidth: number;
  top: number;
  bottom: number;
  /** Room right of the centre line for the start and end labels. */
  labelRoom: number;
}

export const DEFAULT_METRICS: LadderMetrics = {
  gateWidth: 220,
  gateHeight: 40,
  stub: 14,
  gap: 24,
  bar: 20,
  framePad: 12,
  frameTitle: 24,
  titleCharWidth: 6.8,
  top: 46,
  bottom: 64,
  labelRoom: 170,
};

export interface Wire {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  live: boolean;
}

export interface GateBox {
  condition: Condition;
  flow: FlowInfo;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameBox {
  kind: "ref" | "not";
  path: string;
  /** The shared interlock's key, for `ref`. */
  key: string | null;
  flow: FlowInfo | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Centre line, where the wire passes: titles sit either side of it. */
  cx: number;
}

export interface Ladder {
  width: number;
  height: number;
  wires: Wire[];
  gates: GateBox[];
  frames: FrameBox[];
  start: { x: number; y: number };
  end: { x: number; y: number; allowed: boolean };
}

type Block =
  | { kind: "gate"; node: InterlockNode; w: number; h: number }
  | { kind: "and"; node: InterlockNode; kids: Block[]; w: number; h: number }
  | { kind: "or"; node: InterlockNode; kids: Block[]; w: number; h: number }
  | { kind: "ref" | "not"; node: InterlockNode; inner: Block; w: number; h: number };

const NO_FLOW: FlowInfo = { reached: false, passes: false, needed: true, stops: false };

function measure(node: InterlockNode, m: LadderMetrics): Block {
  const gate = (): Block => ({ kind: "gate", node, w: m.gateWidth, h: m.gateHeight + 2 * m.stub });
  if (node.kind === "compare" || foldedNot(node)) return gate();
  if (node.kind === "ref" && node.children.length === 0) return gate();
  if (node.kind === "and" || node.kind === "or") {
    const kids = node.children.map((c) => measure(c, m));
    if (kids.length === 0) return gate();
    if (node.kind === "and") return { kind: "and", node, kids, w: Math.max(...kids.map((k) => k.w)), h: kids.reduce((s, k) => s + k.h, 0) };
    return {
      kind: "or",
      node,
      kids,
      w: kids.reduce((s, k) => s + k.w, 0) + m.gap * (kids.length - 1),
      h: 2 * m.bar + Math.max(...kids.map((k) => k.h)),
    };
  }
  const child = node.children[0];
  if (!child) return gate();
  const inner = measure(child, m);
  // A shared interlock's key is written right of the centre wire, so its frame is wide enough for it.
  const keyRoom = node.kind === "ref" ? 2 * (node.ref.length * m.titleCharWidth + 14) : 0;
  return { kind: node.kind === "ref" ? "ref" : "not", node, inner, w: Math.max(inner.w + 2 * m.framePad, keyRoom), h: m.frameTitle + inner.h + m.framePad };
}

export function layoutLadder(
  tree: InterlockNode | null,
  flow: InterlockFlow,
  conditions: readonly Condition[],
  metrics: Partial<LadderMetrics> = {},
): Ladder {
  const m = { ...DEFAULT_METRICS, ...metrics };
  const byPath = new Map(conditions.map((c) => [c.path, c] as const));
  const wires: Wire[] = [];
  const gates: GateBox[] = [];
  const frames: FrameBox[] = [];
  const wire = (x1: number, y1: number, x2: number, y2: number, live: boolean) => wires.push({ x1, y1, x2, y2, live });
  const info = (n: InterlockNode) => flow.byPath.get(n.path) ?? NO_FLOW;

  // Places a block with its top centre at (cx, y); returns whether permission leaves its bottom.
  const place = (b: Block, cx: number, y: number, live: boolean): boolean => {
    if (b.kind === "gate") {
      const f = info(b.node);
      const condition = byPath.get(b.node.path);
      const top = y + m.stub;
      wire(cx, y, cx, top, live);
      if (condition) gates.push({ condition, flow: f, x: cx - m.gateWidth / 2, y: top, w: m.gateWidth, h: m.gateHeight });
      wire(cx, top + m.gateHeight, cx, y + b.h, f.passes);
      return f.passes;
    }
    if (b.kind === "and") return b.kids.reduce((l, k, i) => place(k, cx, y + b.kids.slice(0, i).reduce((s, p) => s + p.h, 0), l), live);
    if (b.kind === "or") {
      const splitY = y + m.bar / 2;
      const joinY = y + b.h - m.bar / 2;
      let x = cx - b.w / 2;
      const cols = b.kids.map((k) => {
        const c = x + k.w / 2;
        x += k.w + m.gap;
        return c;
      });
      const lo = Math.min(cols[0] as number, cx);
      const hi = Math.max(cols[cols.length - 1] as number, cx);
      wire(cx, y, cx, splitY, live);
      wire(lo, splitY, hi, splitY, live);
      wire(lo, joinY, hi, joinY, false);
      let any = false;
      b.kids.forEach((k, i) => {
        const col = cols[i] as number;
        wire(col, splitY, col, y + m.bar, live);
        const out = place(k, col, y + m.bar, live);
        wire(col, y + m.bar + k.h, col, joinY, out);
        if (out) {
          // The part of the join bar this branch feeds.
          wire(col, joinY, cx, joinY, true);
          any = true;
        }
      });
      wire(cx, joinY, cx, y + b.h, any);
      return any;
    }
    const f = flow.byPath.get(b.node.path) ?? null;
    frames.push({ kind: b.kind, path: b.node.path, key: b.node.kind === "ref" ? b.node.ref : null, flow: f, x: cx - b.w / 2, y: y + 4, w: b.w, h: b.h - 8, cx });
    wire(cx, y, cx, y + m.frameTitle, live);
    const innerOut = place(b.inner, cx, y + m.frameTitle, live);
    // A shared interlock passes what its inside passes; a NOT group is a gate of its own.
    const out = b.kind === "ref" ? innerOut : (f?.passes ?? false);
    wire(cx, y + m.frameTitle + b.inner.h, cx, y + b.h, out);
    return out;
  };

  const root = tree ? measure(tree, m) : null;
  const bodyW = root?.w ?? m.gateWidth;
  const bodyH = root?.h ?? 0;
  const width = Math.max(bodyW + 16, 2 * m.labelRoom);
  const cx = width / 2;
  const start = { x: cx, y: 16 };
  wire(cx, start.y + 8, cx, m.top, true);
  const out = root ? place(root, cx, m.top, true) : false;
  const end = { x: cx, y: m.top + bodyH + 22, allowed: out };
  wire(cx, m.top + bodyH, cx, end.y - 14, out);
  return { width, height: m.top + bodyH + m.bottom, wires, gates, frames, start, end };
}
