/**
 * Interlocks: turning `commandInterlockDetail` into a tree the UI can draw, and
 * keeping it current while the points it depends on change.
 *
 * Expression format (agent config): logic nodes `{and: [...]}`, `{or: [...]}`,
 * `{not: expr}`; comparisons `{eq|ne|gt|ge|lt|le: [a, b]}` where each operand is
 * a point (`equipment::name`) or a number; `{ref: "key"}` uses another
 * interlock. In `commandInterlockDetail.graph` the hub expands each reference
 * to `{ref_group: {key, expression}}`.
 *
 * Node paths (`nodeStates[].path`), as the hub sends them: `$` is the root, a
 * child of `and`/`or` adds `.<op>.<index>` (`$.and.3.or.0`), and the expression
 * of a reference adds `.ref:<key>` (`$.and.0.ref:remote`). The hub's config has
 * no `not` yet; its child is assumed to add `.not`.
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
  | { ref: string }
  | { ref_group: { key: string; expression: Expression } }
  | { [op in CompareOp]?: [Operand, Operand] };

export const COMPARE_OPS: readonly CompareOp[] = ["eq", "ne", "gt", "ge", "lt", "le"];

/** The comparison that holds exactly when `op` does not. */
export const NEGATED: Readonly<Record<CompareOp, CompareOp>> = { eq: "ne", ne: "eq", gt: "le", le: "gt", lt: "ge", ge: "lt" };

export type InterlockNode =
  | { kind: "and" | "or" | "not"; path: string; state: NodeState | null; children: InterlockNode[] }
  | { kind: "compare"; path: string; state: NodeState | null; op: CompareOp; operands: [Operand, Operand]; children: [] }
  /** `children` holds the referenced expression when the graph carries it. */
  | { kind: "ref"; path: string; state: NodeState | null; ref: string; children: InterlockNode[] };

export type CompareNode = Extract<InterlockNode, { kind: "compare" }>;

export const ROOT_PATH = "$";
const childPath = (path: string, op: "and" | "or", i: number) => `${path}.${op}.${i}`;
const notPath = (path: string) => `${path}.not`;
const refPath = (path: string, key: string) => `${path}.ref:${key}`;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Builds the display tree for an expression, attaching each node's live state. */
export function buildTree(expr: unknown, states: ReadonlyMap<string, NodeState> = new Map(), path = ROOT_PATH): InterlockNode | null {
  if (!isObject(expr)) return null;
  const state = states.get(path) ?? null;
  const list = (items: unknown, op: "and" | "or") =>
    (Array.isArray(items) ? items : []).map((e, i) => buildTree(e, states, childPath(path, op, i))).filter((n): n is InterlockNode => n !== null);
  const one = (e: unknown, p: string) => {
    const n = buildTree(e, states, p);
    return n ? [n] : [];
  };

  if ("and" in expr) return { kind: "and", path, state, children: list(expr.and, "and") };
  if ("or" in expr) return { kind: "or", path, state, children: list(expr.or, "or") };
  if ("not" in expr) return { kind: "not", path, state, children: one(expr.not, notPath(path)) };
  if ("ref_group" in expr && isObject(expr.ref_group) && typeof expr.ref_group.key === "string") {
    const key = expr.ref_group.key;
    return { kind: "ref", path, state, ref: key, children: one(expr.ref_group.expression, refPath(path, key)) };
  }
  if ("ref" in expr && typeof expr.ref === "string") return { kind: "ref", path, state, ref: expr.ref, children: [] };
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
  return buildTree(graph, new Map(detail.nodeStates.map((n) => [n.path, n.state] as const)));
}

/** Every point an interlock tree reads. */
export function inputPoints(node: InterlockNode | null): PointId[] {
  if (!node) return [];
  const own = node.kind === "compare" ? node.operands.filter((o): o is PointId => typeof o === "string" && o.includes("::")) : [];
  return [...new Set([...own, ...node.children.flatMap(inputPoints)])];
}

// ── conditions and flow ───────────────────────────────────────────────────

/**
 * One condition an operator can act on, numbered in reading order. A `not`
 * around a single comparison is one condition with the comparison negated; a
 * reference whose expression the graph does not carry is one opaque condition.
 */
export interface Condition {
  n: number;
  /** Path of the node whose state this condition shows. */
  path: string;
  state: NodeState | null;
  /** The comparison as it must hold (already negated for `not`). */
  compare: { op: CompareOp; operands: [Operand, Operand] } | null;
  /** Set when the condition is a `not` folded into its comparison. */
  negated: boolean;
  /** Set for an opaque reference. */
  ref: string | null;
  /** Keys of the shared interlocks this condition sits in, outermost first. */
  within: string[];
}

/** A `not` whose only child is a comparison: shown as the negated comparison. */
export function foldedNot(node: InterlockNode): CompareNode | null {
  const child = node.kind === "not" ? node.children[0] : undefined;
  return child?.kind === "compare" && node.children.length === 1 ? child : null;
}

export function conditions(tree: InterlockNode | null): Condition[] {
  const out: Condition[] = [];
  const visit = (node: InterlockNode, within: string[]) => {
    const add = (c: Omit<Condition, "n" | "within">) => out.push({ ...c, n: out.length + 1, within });
    if (node.kind === "compare") return add({ path: node.path, state: node.state, compare: { op: node.op, operands: node.operands }, negated: false, ref: null });
    const folded = foldedNot(node);
    if (folded) return add({ path: node.path, state: node.state, compare: { op: NEGATED[folded.op], operands: folded.operands }, negated: true, ref: null });
    if (node.kind === "ref" && node.children.length === 0) return add({ path: node.path, state: node.state, compare: null, negated: false, ref: node.ref });
    const inner = node.kind === "ref" ? [...within, node.ref] : within;
    for (const c of node.children) visit(c, inner);
  };
  if (tree) visit(tree, []);
  return out;
}

export interface FlowInfo {
  /** Permission from the request reaches this node. */
  reached: boolean;
  /** Permission leaves this node. */
  passes: boolean;
  /** False inside an OR branch that another branch already satisfies, or inside a NOT. */
  needed: boolean;
  /** Permission arrives here and stops: the conditions to clear first. */
  stops: boolean;
}

export interface InterlockFlow {
  /** An unbroken path joins the request to the end. */
  allowed: boolean;
  byPath: ReadonlyMap<string, FlowInfo>;
  /** Conditions where permission stops, in reading order. */
  stoppers: string[];
}

/**
 * Follows permission through the tree the way the ladder view draws it:
 * series for AND, parallel branches for OR. The backend decides whether a
 * command is permitted; this only explains its node states.
 */
export function analyzeFlow(tree: InterlockNode | null): InterlockFlow {
  const byPath = new Map<string, FlowInfo>();
  const stoppers: string[] = [];
  const permits = (n: InterlockNode) => n.state === "PERMIT";

  const gate = (node: InterlockNode, reached: boolean, needed: boolean) => {
    const passes = reached && permits(node);
    const stops = reached && !passes && needed;
    byPath.set(node.path, { reached, passes, needed, stops });
    if (stops) stoppers.push(node.path);
    return passes;
  };

  const flow = (node: InterlockNode, reached: boolean, needed: boolean): boolean => {
    if (node.kind === "compare" || foldedNot(node) || (node.kind === "ref" && node.children.length === 0)) return gate(node, reached, needed);
    let passes: boolean;
    if (node.kind === "and") {
      passes = node.children.reduce((live, c) => flow(c, live, needed), reached);
    } else if (node.kind === "or") {
      const branchNeeded = needed && !permits(node);
      passes = node.children.map((c) => flow(c, reached, branchNeeded)).some(Boolean);
    } else if (node.kind === "ref") {
      passes = node.children.reduce((live, c) => flow(c, live, needed), reached);
    } else {
      // A NOT around a group: the inside is shown for context; the NOT itself is the gate.
      for (const c of node.children) flow(c, reached, false);
      return gate(node, reached, needed);
    }
    byPath.set(node.path, { reached, passes, needed, stops: false });
    return passes;
  };

  const allowed = tree ? flow(tree, true, true) : false;
  return { allowed, byPath, stoppers };
}

// ── live watcher ──────────────────────────────────────────────────────────

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

// ── live state of many commands ───────────────────────────────────────────

/**
 * What a command button shows: `none` (no interlock), `permit`, `block`, or
 * `unknown` when the HMI cannot trust the answer (not loaded yet, the query
 * failed, or an input is stale because its agent or the link is down).
 */
export type CommandInterlockState = "none" | "permit" | "block" | "unknown";

export const commandId = (k: CommandKey) => `${k.agent}|${k.equipment}|${k.name}`;

export interface InterlockStatesWatcher extends Readable<ReadonlyMap<string, CommandInterlockState>> {
  start(): Promise<void>;
  stop(): void;
}

/**
 * Follows the interlock outcome of a set of commands, for marking command
 * buttons. One `interlockStates` call covers them all; each interlock's
 * input points are read once from its detail, and a change to any of them
 * asks again, in one call, after a short debounce.
 */
export function createInterlockStatesWatcher(
  backend: ScadaBackend,
  points: PointStore,
  keys: readonly CommandKey[],
  options: { debounceMs?: number } = {},
): InterlockStatesWatcher {
  const debounceMs = options.debounceMs ?? 150;
  const unknownAll = () => new Map(keys.map((k) => [commandId(k), "unknown" as CommandInterlockState]));
  const state = writable<ReadonlyMap<string, CommandInterlockState>>(unknownAll());
  const inputsOf = new Map<string, PointId[]>();
  let outcomes = new Map<string, CommandInterlockState>();
  let cleanups: Unsubscribe[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  // An outcome computed from a stale input is not shown as if it were current.
  const publish = () => {
    const next = new Map<string, CommandInterlockState>();
    for (const k of keys) {
      const id = commandId(k);
      const o = outcomes.get(id) ?? "unknown";
      const stale = (inputsOf.get(id) ?? []).some((p) => {
        const v = points.get(p);
        return v.stale || v.value === null;
      });
      next.set(id, (o === "permit" || o === "block") && stale ? "unknown" : o);
    }
    state.set(next);
  };

  const query = async () => {
    if (!running) return;
    try {
      const list = await backend.interlockStates(keys);
      if (!running) return;
      outcomes = new Map(list.map((s) => [commandId(s), s.hasInterlock ? (s.outcome === "PERMIT" ? "permit" : "block") : "none"]));
    } catch {
      outcomes = new Map();
    }
    publish();
  };

  const onInput = () => {
    publish();
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => void query(), debounceMs);
  };

  return {
    get: state.get,
    subscribe: state.subscribe,
    async start() {
      if (running) return;
      running = true;
      await query();
      // Learn what each interlock reads, then follow those points.
      const interlocked = keys.filter((k) => outcomes.get(commandId(k)) !== "none");
      const details = await Promise.all(interlocked.map((k) => backend.interlockDetail(k).catch(() => null)));
      if (!running) return;
      details.forEach((d, i) => {
        if (d) inputsOf.set(commandId(interlocked[i] as CommandKey), inputPoints(treeFromDetail(d)));
      });
      const all = [...new Set([...inputsOf.values()].flat())];
      if (all.length) {
        cleanups.push(points.watch(all));
        for (const p of all) cleanups.push(points.subscribe(p, onInput));
      }
      publish();
    },
    stop() {
      running = false;
      if (timer !== null) clearTimeout(timer);
      for (const c of cleanups) c();
      cleanups = [];
    },
  };
}

// ── evaluation (mock backend and tests) ───────────────────────────────────

/** Replaces each `{ref}` with `{ref_group: {key, expression}}`, as the hub's `graph` does. */
export function expandRefs(expr: Expression, refs: Readonly<Record<string, Expression>>, seen: readonly string[] = []): Expression {
  if ("and" in expr && Array.isArray(expr.and)) return { and: expr.and.map((e) => expandRefs(e, refs, seen)) };
  if ("or" in expr && Array.isArray(expr.or)) return { or: expr.or.map((e) => expandRefs(e, refs, seen)) };
  if ("not" in expr && expr.not) return { not: expandRefs(expr.not as Expression, refs, seen) };
  if ("ref" in expr && typeof expr.ref === "string") {
    const target = refs[expr.ref];
    if (!target || seen.includes(expr.ref)) return expr;
    return { ref_group: { key: expr.ref, expression: expandRefs(target, refs, [...seen, expr.ref]) } };
  }
  return expr;
}

/**
 * Evaluates an expression against current values, producing node states in the
 * hub's path format. The HMI itself never decides whether a command is
 * permitted (the backend does); this exists for the mock backend and for tests.
 */
export function evaluate(
  expr: Expression,
  read: (id: string) => { value: number | null; good: boolean },
  refs: Readonly<Record<string, Expression>> = {},
  path = ROOT_PATH,
  out: { path: string; state: NodeState }[] = [],
): { state: NodeState; nodeStates: { path: string; state: NodeState }[] } {
  const record = (state: NodeState) => {
    out.push({ path, state });
    return { state, nodeStates: out };
  };
  const combine = (states: NodeState[], all: boolean): NodeState => {
    if (all) return states.includes("BLOCK") ? "BLOCK" : states.includes("BAD_QUALITY") ? "BAD_QUALITY" : "PERMIT";
    return states.includes("PERMIT") ? "PERMIT" : states.includes("BAD_QUALITY") ? "BAD_QUALITY" : "BLOCK";
  };

  if ("and" in expr && Array.isArray(expr.and)) {
    return record(combine(expr.and.map((e, i) => evaluate(e, read, refs, childPath(path, "and", i), out).state), true));
  }
  if ("or" in expr && Array.isArray(expr.or)) {
    return record(combine(expr.or.map((e, i) => evaluate(e, read, refs, childPath(path, "or", i), out).state), false));
  }
  if ("not" in expr && expr.not) {
    const s = evaluate(expr.not as Expression, read, refs, notPath(path), out).state;
    return record(s === "BAD_QUALITY" ? s : s === "PERMIT" ? "BLOCK" : "PERMIT");
  }
  if ("ref_group" in expr && isObject(expr.ref_group)) {
    const { key, expression } = expr.ref_group;
    return record(evaluate(expression, read, refs, refPath(path, key), out).state);
  }
  if ("ref" in expr && typeof expr.ref === "string") {
    const target = refs[expr.ref];
    if (!target) return record("BLOCK");
    return record(evaluate(target, read, refs, refPath(path, expr.ref), out).state);
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
