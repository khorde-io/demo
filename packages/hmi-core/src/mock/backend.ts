/**
 * An in-memory `ScadaBackend` that behaves like the real one where the HMI can
 * tell: subscriptions deliver cached values first, interlocks are evaluated,
 * commands go through the request states, alarms keep instance ids. Used by the
 * tests and to run the demo without a hub.
 */

import type { ActiveAlarmChange, CommandRequest, HeartbeatKind, ScadaBackend, Sink } from "../backend.ts";
import type { ConnectionState } from "../graphql/transport.ts";
import { evaluate, expandRefs, type Expression } from "../interlocks.ts";
import {
  PRIORITY_BY_SEVERITY,
  parsePointId,
  pointId,
  pointPath,
  type Alarm,
  type AlarmJournalEntry,
  type AlarmJournalKind,
  type AlarmSeverity,
  type CommandKey,
  type Connectivity,
  type Heartbeat,
  type InterlockDetail,
  type InterlockState,
  type Measurement,
  type MeasurementType,
  type PointId,
  type PointRawValue,
  type Quality,
  type RequestState,
  type RequestUpdate,
} from "../model.ts";
import { matchAny, pathMatcher } from "../paths.ts";
import type { Page, PageRequest } from "../pages.ts";
import { writable } from "../store.ts";

export interface MockPoint {
  equipment: string;
  name: string;
  type: MeasurementType;
  value: PointRawValue;
  quality?: Quality;
  agent?: string;
  /** Keep history (like `store: true` in the agent config). Default true. */
  store?: boolean;
  tags?: string[];
}

export interface MockInterlock {
  description?: string;
  expression: Expression;
}

export interface MockCommand extends CommandKey {
  /** Key of the interlock that guards it. */
  interlock?: string;
}

export interface MockAlarmInput {
  name: string;
  area: string;
  condition?: string;
  severity: AlarmSeverity;
  value?: number;
}

export interface CommandContext {
  key: CommandKey;
  value: number | undefined;
  backend: MockBackend;
}

export interface MockBackendOptions {
  points?: readonly MockPoint[];
  commands?: readonly MockCommand[];
  interlocks?: Readonly<Record<string, MockInterlock>>;
  agents?: readonly string[];
  sites?: readonly string[];
  /** Delay between request states, in ms. */
  stepMs?: number;
  now?: () => Date;
  /**
   * Called when a command reaches the device. Return false to make it fail.
   * The default turns `<x>.open` / `<x>.close` into `<equipment>::<x>` = 0 / 1.
   */
  onCommand?(ctx: CommandContext): boolean | void;
  /**
   * Who acknowledges alarms and sends commands, as the hub records it from
   * the access token. Pass the signed-in user (`createStaticAuth`) so the
   * mock shows the same name the hub would.
   */
  actor?: () => { id: string; display: string } | null;
}

export interface MockBackend extends ScadaBackend {
  /** The active summary right now, for tests. */
  activeAlarms(): Alarm[];
  publish(id: PointId, value: PointRawValue, options?: { quality?: Quality; timestamp?: Date }): void;
  value(id: PointId): Measurement | undefined;
  setConnection(state: ConnectionState): void;
  raiseAlarm(input: MockAlarmInput): Alarm;
  resetAlarm(instanceId: string): Alarm | undefined;
  raiseEvent(input: MockAlarmInput): Alarm;
  setHeartbeat(kind: HeartbeatKind, id: string, status: Connectivity): void;
  /** Requests sent so far, newest last. */
  requests(): readonly { id: string; key: CommandKey; request: CommandRequest }[];
}

let seq = 0;
const uuid = () => {
  seq++;
  return `00000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`;
};

const defer = (fn: () => void) => queueMicrotask(fn);

/** One page of already-ordered rows; the cursor is an offset. */
function page<T>(rows: readonly T[], request: PageRequest): Page<T> {
  const start = request.after ? Number(request.after) : 0;
  const end = start + (request.first ?? 1_000);
  return { items: rows.slice(start, end), next: end < rows.length ? String(end) : null };
}

export function defaultOnCommand({ key, value, backend }: CommandContext): boolean {
  const m = /^(.+)\.(open|close)$/.exec(key.name);
  if (m) {
    backend.publish(pointId(key.equipment, m[1] as string), m[2] === "open" ? 0 : 1);
    return true;
  }
  if (value !== undefined) {
    backend.publish(pointId(key.equipment, key.name.replace(/\.set(point)?$/, "")), value);
    return true;
  }
  return true;
}

const DEFAULT_ACTOR = { id: "mock-user", display: "Mock operator" };

export function createMockBackend(options: MockBackendOptions = {}): MockBackend {
  const now = options.now ?? (() => new Date());
  const actor = () => options.actor?.() ?? DEFAULT_ACTOR;
  const stepMs = options.stepMs ?? 50;
  const connection = writable<ConnectionState>("online");

  const meta = new Map<PointId, MockPoint>();
  const current = new Map<PointId, Measurement>();
  const stored: Measurement[] = [];
  const measSubs = new Set<{ match: (m: Measurement) => boolean; sink: Sink<Measurement> }>();

  const active = new Map<string, Alarm>();
  const journal: AlarmJournalEntry[] = [];
  const alarmSubs = new Set<{ areas: readonly string[]; sink: Sink<ActiveAlarmChange> }>();

  const commands = options.commands ?? [];
  const interlocks = options.interlocks ?? {};
  const refs = Object.fromEntries(Object.entries(interlocks).map(([k, v]) => [k, v.expression]));
  const updates = new Map<string, RequestUpdate[]>();
  const sent: { id: string; key: CommandKey; request: CommandRequest }[] = [];

  const beats: Record<HeartbeatKind, Map<string, Heartbeat>> = { agent: new Map(), site: new Map() };
  for (const a of options.agents ?? []) beats.agent.set(a, { id: a, status: "online", lastSeenAt: now() });
  for (const s of options.sites ?? []) beats.site.set(s, { id: s, status: "online", lastSeenAt: now() });
  const beatSubs = new Set<{ kind: HeartbeatKind; ids: readonly string[]; sink: Sink<Heartbeat> }>();

  const online = () => connection.get() === "online";

  const emitMeasurement = (m: Measurement) => {
    if (!online()) return;
    for (const s of [...measSubs]) if (s.match(m)) defer(() => measSubs.has(s) && s.sink.next(m));
  };

  const emitAlarmChange = (area: string, change: ActiveAlarmChange) => {
    if (!online()) return;
    for (const s of [...alarmSubs]) {
      if (s.areas.length === 0 || matchAny(s.areas, area)) defer(() => alarmSubs.has(s) && s.sink.next(change));
    }
  };

  /** What a new subscription gets first: every active alarm, then `synced`. */
  const sendSummary = (s: { areas: readonly string[]; sink: Sink<ActiveAlarmChange> }) => {
    for (const alarm of active.values()) {
      if (s.areas.length === 0 || matchAny(s.areas, alarm.area)) defer(() => alarmSubs.has(s) && s.sink.next({ kind: "upsert", alarm }));
    }
    defer(() => alarmSubs.has(s) && s.sink.next({ kind: "synced" }));
  };

  const publish: MockBackend["publish"] = (id, value, opts = {}) => {
    const { equipment, name } = parsePointId(id);
    const info = meta.get(id);
    const m: Measurement = {
      id,
      equipment,
      name,
      type: info?.type ?? (typeof value === "number" && !Number.isInteger(value) ? "analogical" : "discrete"),
      value,
      quality: opts.quality ?? "good",
      timestamp: opts.timestamp ?? now(),
    };
    current.set(id, m);
    if (info?.store !== false) stored.push(m);
    emitMeasurement(m);
  };

  for (const p of options.points ?? []) {
    const id = pointId(p.equipment, p.name);
    meta.set(id, p);
    publish(id, p.value, { quality: p.quality ?? "good" });
  }

  const read = (id: string) => {
    const m = current.get(id as PointId);
    const v = m?.value;
    const num = typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : null;
    return { value: num, good: !!m && m.quality === "good" };
  };

  const commandOf = (key: CommandKey) =>
    commands.find((c) => c.agent === key.agent && c.equipment === key.equipment && c.name === key.name);

  const interlockFor = (key: CommandKey): { state: InterlockState; detail: InterlockDetail } => {
    const cmd = commandOf(key);
    const lock = cmd?.interlock ? interlocks[cmd.interlock] : undefined;
    if (!cmd?.interlock || !lock) {
      const state: InterlockState = { ...key, hasInterlock: false, outcome: "PERMIT" };
      return { state, detail: { ...state, key: null, description: null, graph: null, nodeStates: [] } };
    }
    // The hub sends the graph with references expanded; evaluating that graph gives its paths.
    const graph = expandRefs(lock.expression, refs);
    const result = evaluate(graph, read, refs);
    const state: InterlockState = { ...key, hasInterlock: true, outcome: result.state === "PERMIT" ? "PERMIT" : "BLOCK" };
    return {
      state,
      detail: { ...state, key: cmd.interlock, description: lock.description ?? null, graph, nodeStates: result.nodeStates },
    };
  };

  const makeAlarm = (input: MockAlarmInput, state: Alarm["state"]): Alarm => {
    const condition = input.condition ?? "set";
    const at = now();
    return {
      key: `${input.name}/${condition}`,
      instanceId: uuid(),
      origin: "mock",
      name: input.name,
      area: input.area,
      condition,
      state,
      severity: input.severity,
      priority: PRIORITY_BY_SEVERITY[input.severity],
      value: input.value ?? 1,
      setAt: at,
      stateAt: at,
      acked: false,
      ackPending: false,
      ackedAt: null,
      ackedBy: null,
      originOnline: true,
    };
  };

  /** Writes the journal row and applies the hub's rule: listed until returned and acknowledged. */
  const record = (kind: AlarmJournalKind, a: Alarm) => {
    const { name, area, condition, instanceId, origin, state, severity, priority, value, acked, ackedAt, ackedBy } = a;
    journal.push({ timestamp: kind === "ACK" ? (ackedAt ?? now()) : a.stateAt, kind, origin, name, area, condition, instanceId, state, severity, priority, value, acked, ackedAt, ackedBy });
    if (a.state === "Set" || !a.acked) {
      active.set(instanceId, a);
      emitAlarmChange(area, { kind: "upsert", alarm: a });
    } else {
      active.delete(instanceId);
      emitAlarmChange(area, { kind: "remove", instanceId });
    }
    return a;
  };

  const backend: MockBackend = {
    connection,

    subscribeMeasurements(paths, sink) {
      const matches = pathMatcher(paths);
      const s = { match: (m: Measurement) => matches(pointPath(m.id)), sink };
      measSubs.add(s);
      if (online()) for (const m of current.values()) if (s.match(m)) defer(() => measSubs.has(s) && sink.next(m));
      return () => measSubs.delete(s);
    },

    subscribeMeasurementsByTag(tag, sink) {
      const s = { match: (m: Measurement) => meta.get(m.id)?.tags?.includes(tag) ?? false, sink };
      measSubs.add(s);
      if (online()) for (const m of current.values()) if (s.match(m)) defer(() => measSubs.has(s) && sink.next(m));
      return () => measSubs.delete(s);
    },

    async history(type, query) {
      // Ordered like the hub: by timestamp, then equipment and name.
      const matches = pathMatcher(query.paths);
      const dir = query.order === "desc" ? -1 : 1;
      const rows = stored
        .filter(
          (m) =>
            m.type === type &&
            matches(pointPath(m.id)) &&
            (!query.from || m.timestamp >= query.from) &&
            (!query.to || m.timestamp <= query.to),
        )
        .sort((a, b) => dir * (a.timestamp.getTime() - b.timestamp.getTime()) || a.id.localeCompare(b.id));
      return page(rows, query);
    },

    activeAlarms: () => [...active.values()],

    subscribeActiveAlarms(areas, sink) {
      const s = { areas, sink };
      alarmSubs.add(s);
      if (online()) sendSummary(s);
      return () => alarmSubs.delete(s);
    },

    async alarmJournal(query) {
      // Ordered like the hub: by timestamp, then instance id.
      const dir = query.order === "desc" ? -1 : 1;
      const rows = journal
        .filter((e) => (!query.from || e.timestamp >= query.from) && (!query.to || e.timestamp <= query.to))
        .sort((a, b) => dir * (a.timestamp.getTime() - b.timestamp.getTime()) || a.instanceId.localeCompare(b.instanceId));
      return page(rows, query);
    },

    async ackAlarm(key, instanceId) {
      const a = active.get(instanceId);
      if (!a || a.key !== key) return "NOT_FOUND";
      if (a.acked) return "ALREADY_ACKED";
      record("ACK", { ...a, acked: true, ackedAt: now(), ackedBy: actor().display });
      return "ACKED";
    },

    async sendCommand(key, request) {
      if (!commandOf(key)) throw new Error(`Unknown command ${key.agent}/${key.equipment}/${key.name}`);
      const id = uuid();
      sent.push({ id, key, request });
      const blocked = !request.bypassInterlock && interlockFor(key).state.outcome === "BLOCK";
      const list: RequestUpdate[] = [];
      updates.set(id, list);
      const by = actor();
      const push = (state: RequestState, msg = "") =>
        list.push({ id, name: key.name, state, msg, timestamp: now(), actorId: by.id, actorDisplay: by.display });

      push(request.bypassInterlock ? "FORWARDED_TO_AGENT_INTERLOCK_BYPASSED" : "FORWARDED_TO_AGENT");
      if (blocked) {
        push("REQUEST_ERROR", "interlock blocked");
        return id;
      }
      const steps: (() => void)[] = [
        () => push("AGENT_RECEIVED"),
        () => push("AGENT_SENT"),
        () => {
          const ok = (options.onCommand ?? defaultOnCommand)({ key, value: request.value, backend }) !== false;
          push(ok ? "REQUEST_SUCCESS" : "REQUEST_ERROR", ok ? "" : "device rejected the command");
        },
      ];
      steps.forEach((step, i) => setTimeout(step, stepMs * (i + 1)));
      return id;
    },

    async requestUpdates(requestId) {
      return [...(updates.get(requestId) ?? [])];
    },

    async interlockStates(keys) {
      return keys.map((k) => interlockFor(k).state);
    },

    async interlockDetail(key) {
      return interlockFor(key).detail;
    },

    async heartbeats(kind, ids) {
      return ids.map((id) => beats[kind].get(id) ?? { id, status: "unknown", lastSeenAt: null });
    },

    subscribeHeartbeats(kind, ids, sink) {
      const s = { kind, ids, sink };
      beatSubs.add(s);
      return () => beatSubs.delete(s);
    },

    async registeredMeasurements(agents) {
      return [...meta.values()]
        .filter((p) => !agents || agents.includes(p.agent ?? "mock-agent"))
        .map((p) => ({ agent: p.agent ?? "mock-agent", equipment: p.equipment, name: p.name, type: p.type }));
    },

    async registeredCommands(agents) {
      return commands
        .filter((c) => !agents || agents.includes(c.agent))
        .map((c) => ({ agent: c.agent, equipment: c.equipment, name: c.name }));
    },

    publish,
    value: (id) => current.get(id),

    setConnection(state) {
      const was = online();
      connection.set(state);
      // Like graphql-ws after a reconnect: subscriptions resume and the server
      // re-sends cached values.
      if (!was && online()) {
        for (const s of measSubs) for (const m of current.values()) if (s.match(m)) defer(() => s.sink.next(m));
        for (const s of alarmSubs) sendSummary(s);
      }
    },

    raiseAlarm: (input) => record("SET", makeAlarm(input, "Set")),
    raiseEvent: (input) => record("EVENT", makeAlarm(input, "Event")),

    resetAlarm(instanceId) {
      const a = active.get(instanceId);
      if (!a) return undefined;
      return record("RESET", { ...a, state: "Reset", stateAt: now() });
    },

    setHeartbeat(kind, id, status) {
      const hb: Heartbeat = { id, status, lastSeenAt: status === "online" ? now() : (beats[kind].get(id)?.lastSeenAt ?? null) };
      beats[kind].set(id, hb);
      for (const s of beatSubs) if (s.kind === kind && s.ids.includes(id)) defer(() => s.sink.next(hb));
    },

    requests: () => sent,
  };

  return backend;
}
