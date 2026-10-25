/**
 * The HMI's view of Khorde data. The API speaks strings and JSON; these are the
 * normalized types the rest of the library works with.
 */

/** A point is identified by `equipment::name` (the agent-config form). */
export type PointId = `${string}::${string}`;

export interface PointKey {
  equipment: string;
  name: string;
}

export function pointId(equipment: string, name: string): PointId {
  return `${equipment}::${name}`;
}

export function parsePointId(id: string): PointKey {
  const at = id.lastIndexOf("::");
  if (at <= 0 || at === id.length - 2) throw new Error(`Not a point id (equipment::name): ${id}`);
  return { equipment: id.slice(0, at), name: id.slice(at + 2) };
}

/** Subscriptions and history address points as dotted paths: `equipment.name`. */
export function pointPath(id: PointId | PointKey): string {
  const key = typeof id === "string" ? parsePointId(id) : id;
  return `${key.equipment}.${key.name}`;
}

export type Quality = "good" | "bad";
export type MeasurementType = "discrete" | "analogical";
export type PointRawValue = number | boolean | string | null;

/** One measurement as delivered by a subscription or a history query. */
export interface Measurement {
  id: PointId;
  equipment: string;
  name: string;
  type: MeasurementType;
  value: PointRawValue;
  quality: Quality;
  timestamp: Date;
}

/** What a screen shows for a point right now. */
export interface PointValue {
  id: PointId;
  /** null until the first value arrives. */
  value: PointRawValue;
  type: MeasurementType | null;
  quality: Quality;
  timestamp: Date | null;
  /** True while the value cannot be trusted to be current (link or agent down). */
  stale: boolean;
}

export type AlarmState = "Set" | "Reset" | "Event";
export type AlarmSeverity = "high" | "medium" | "low";
export type AlarmPriority = 1 | 2 | 3;

export const PRIORITY_BY_SEVERITY: Record<AlarmSeverity, AlarmPriority> = { high: 1, medium: 2, low: 3 };

export interface Alarm {
  instanceId: string;
  name: string;
  area: string;
  condition: string;
  state: AlarmState;
  severity: AlarmSeverity;
  priority: AlarmPriority;
  value: number;
  timestamp: Date;
  acked: boolean;
  ackTimestamp: Date | null;
  actorId: string | null;
  actorDisplay: string | null;
}

export interface CommandKey {
  agent: string;
  equipment: string;
  name: string;
}

export type RequestState =
  | "FORWARDED_TO_AGENT"
  | "FORWARDED_TO_AGENT_INTERLOCK_BYPASSED"
  | "AGENT_RECEIVED"
  | "AGENT_SENT"
  | "REQUEST_SUCCESS"
  | "REQUEST_TIMEOUT"
  | "REQUEST_ERROR";

export const FINAL_REQUEST_STATES: ReadonlySet<RequestState> = new Set(["REQUEST_SUCCESS", "REQUEST_TIMEOUT", "REQUEST_ERROR"]);

export interface RequestUpdate {
  id: string;
  name: string;
  state: RequestState;
  msg: string;
  timestamp: Date;
  actorId: string | null;
  actorDisplay: string | null;
}

export type InterlockOutcome = "PERMIT" | "BLOCK";
export type NodeState = "PERMIT" | "BLOCK" | "BAD_QUALITY";

export interface InterlockState extends CommandKey {
  hasInterlock: boolean;
  outcome: InterlockOutcome;
}

export interface InterlockDetail extends InterlockState {
  key: string | null;
  description: string | null;
  /** The interlock expression as configured (see `interlocks.ts`). */
  graph: unknown;
  nodeStates: { path: string; state: NodeState }[];
}

export type Connectivity = "online" | "offline" | "unknown";

export interface Heartbeat {
  /** Agent name or site name. */
  id: string;
  status: Connectivity;
  lastSeenAt: Date | null;
}

export interface RegisteredMeasurement extends PointKey {
  agent: string;
  type: MeasurementType;
}

export type RegisteredCommand = CommandKey;
