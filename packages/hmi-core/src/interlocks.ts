/**
 * Interlocks: turning `commandInterlockDetail` into a tree the UI can draw, and
 * keeping it current while the points it depends on change.
 *
 * Expression format (agent config): logic nodes `{and: [...]}`, `{or: [...]}`,
 * `{not: expr}`; comparisons `{eq|ne|gt|ge|lt|le: [a, b]}` where each operand is
 * a point (`equipment::name`) or a number; `{ref: "key"}` inlines another
 * interlock.
 *
 * ASSUMPTION (to confirm with the backend): `nodeStates[].path` addresses nodes
 * by child index from the root, dot-separated: "" is the root, "0" its first
 * child, "0.1" that child's second child. `graph` is the expression, optionally
 * wrapped as `{expression: ...}`; a `ref` node may carry the referenced
 * expression inline as `expression`.
 */

import type { ScadaBackend } from "./backend.ts";
import type { CommandKey, InterlockDetail, NodeState, PointId } from "./model.ts";
import type { PointStore } from "./points.ts";
import { writable, type Readable, type Unsubscribe } from "./store.ts";

export type CompareOp = "eq" | "ne" | "gt" | "ge" | "lt" | "le";
export type Operand = string | number;

export type Expression =
  | { and: Expression[] }
  | { or: Expression[] }
  | { not: Expression }
  | { ref: string; expression?: Expression }
  | { [op in CompareOp]?: [Operand, Operand] };

export const COMPARE_OPS: readonly CompareOp[] = ["eq", "ne", "gt", "ge", "lt", "le"];

export type InterlockNode =
  | { kind: "and" | "or" | "not"; path: string; state: NodeState | null; children: InterlockNode[] }
  | { kind: "compare"; path: string; state: NodeState | null; op: CompareOp; operands: [Operand, Operand]; children: [] }
  | { kind: "ref"; path: string; state: NodeState | null; ref: string; children: InterlockNode[] };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function normalizePath(path: string): string {
  return path.replace(/^(root|\$)[./]?/, "").replace(/\//g, ".");
}

/** Builds the display tree for an expression, attaching each node's live state. */
export function buildTree(expr: unknown, states: ReadonlyMap<string, NodeState> = new Map(), path = ""): InterlockNode | null {
  if (!isObject(expr)) return null;
  const state = states.get(path) ?? null;
  const child = (e: unknown, i: number) => buildTree(e, states, path === "" ? String(i) : `${path}.${i}`);
  const children = (list: unknown) =>
    (Array.isArray(list) ? list : []).map(child).filter((n): n is InterlockNode => n !== null);

  if ("and" in expr) return { kind: "and", path, state, children: children(expr.and) };
  if ("or" in expr) return { kind: "or", path, state, children: children(expr.or) };
  if ("not" in expr) return { kind: "not", path, state, children: children([expr.not]) };
  if ("ref" in expr && typeof expr.ref === "string") {
    return { kind: "ref", path, state, ref: expr.ref, children: expr.expression ? children([expr.expression]) : [] };
  }
  for (const op of COMPARE_OPS) {
    const operands = expr[op];
    if (Array.isArray(operands) && operands.length === 2) {
      return { kind: "compare", path, state, op, operands: operands as [Operand, Operand], children: [] };
    }
  }
  return null;
}

export function treeFromDetail(detail: InterlockDetail): InterlockNode | null {
  const graph = isObject(detail.graph) && "expression" in detail.graph ? detail.graph.expression : detail.graph;
  const states = new Map(detail.nodeStates.map((n) => [normalizePath(n.path), n.state] as const));
  return buildTree(graph, states);
}

/** Every point an interlock tree reads. */
export function inputPoints(node: InterlockNode | null): PointId[] {
  if (!node) return [];
  const own = node.kind === "compare" ? node.operands.filter((o): o is PointId => typeof o === "string" && o.includes("::")) : [];
  return [...new Set([...own, ...node.children.flatMap(inputPoints)])];
}

export interface InterlockView {
  detail: InterlockDetail | null;
  tree: InterlockNode | null;
  loading: boolean;
  error: unknown;
}

export interface InterlockWatcher extends Readable<InterlockView> {
  start(): Promise<void>;
  /** Re-queries the detail now. */
  refresh(): Promise<void>;
  stop(): void;
}

/**
 * Follows one command's interlock. The API does not stream interlock states, so
 * the watcher re-queries the detail whenever one of its input points changes.
 */
export function createInterlockWatcher(
  backend: ScadaBackend,
  points: PointStore,
  key: CommandKey,
  options: { debounceMs?: number } = {},
): InterlockWatcher {
  const debounceMs = options.debounceMs ?? 150;
  const state = writable<InterlockView>({ detail: null, tree: null, loading: false, error: null });
  let inputs: string[] = [];
  let cleanups: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const unwatch = () => {
    for (const c of cleanups) c();
    cleanups = [];
  };

  const rewatch = (ids: PointId[]) => {
    const same = ids.length === inputs.length && ids.every((id, i) => id === inputs[i]);
    if (same) return;
    unwatch();
    inputs = ids;
    if (ids.length === 0) return;
    cleanups.push(points.watch(ids));
    const onChange = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), debounceMs);
    };
    for (const id of ids) cleanups.push(points.subscribe(id, onChange));
  };

  const refresh = async () => {
    if (!running) return;
    state.set({ ...state.get(), loading: true });
    try {
      const detail = await backend.interlockDetail(key);
      if (!running) return;
      const tree = treeFromDetail(detail);
      state.set({ detail, tree, loading: false, error: null });
      rewatch(inputPoints(tree).sort());
    } catch (error) {
      if (running) state.set({ ...state.get(), loading: false, error });
    }
  };

  return {
    get: state.get,
    subscribe: state.subscribe,
    async start() {
      if (running) return;
      running = true;
      await refresh();
    },
    refresh,
    stop() {
      running = false;
      if (timer !== null) clearTimeout(timer);
      unwatch();
      inputs = [];
    },
  };
}

/**
 * Evaluates an expression against current values. The HMI itself never decides
 * whether a command is permitted (the backend does); this exists for the mock
 * backend and for tests.
 */
export function evaluate(
  expr: Expression,
  read: (id: string) => { value: number | null; good: boolean },
  refs: Readonly<Record<string, Expression>> = {},
  path = "",
  out: { path: string; state: NodeState }[] = [],
): { state: NodeState; nodeStates: { path: string; state: NodeState }[] } {
  const record = (state: NodeState) => {
    out.push({ path, state });
    return { state, nodeStates: out };
  };
  const childPath = (i: number) => (path === "" ? String(i) : `${path}.${i}`);
  const combine = (states: NodeState[], all: boolean): NodeState => {
    if (all) return states.every((s) => s === "PERMIT") ? "PERMIT" : states.includes("BAD_QUALITY") ? "BAD_QUALITY" : "BLOCK";
    return states.includes("PERMIT") ? "PERMIT" : states.includes("BAD_QUALITY") ? "BAD_QUALITY" : "BLOCK";
  };

  if ("and" in expr && Array.isArray(expr.and)) {
    return record(combine(expr.and.map((e, i) => evaluate(e, read, refs, childPath(i), out).state), true));
  }
  if ("or" in expr && Array.isArray(expr.or)) {
    return record(combine(expr.or.map((e, i) => evaluate(e, read, refs, childPath(i), out).state), false));
  }
  if ("not" in expr && expr.not) {
    const s = evaluate(expr.not as Expression, read, refs, childPath(0), out).state;
    return record(s === "BAD_QUALITY" ? s : s === "PERMIT" ? "BLOCK" : "PERMIT");
  }
  if ("ref" in expr && typeof expr.ref === "string") {
    const target = refs[expr.ref];
    if (!target) return record("BLOCK");
    return record(evaluate(target, read, refs, childPath(0), out).state);
  }
  for (const op of COMPARE_OPS) {
    const operands = (expr as Record<string, unknown>)[op];
    if (!Array.isArray(operands)) continue;
    const vals = operands.map((o) => (typeof o === "number" ? { value: o, good: true } : read(String(o))));
    if (vals.some((v) => !v.good || v.value === null)) return record("BAD_QUALITY");
    const [a, b] = vals.map((v) => v.value as number) as [number, number];
    const ok = { eq: a === b, ne: a !== b, gt: a > b, ge: a >= b, lt: a < b, le: a <= b }[op];
    return record(ok ? "PERMIT" : "BLOCK");
  }
  return record("BLOCK");
}
