/**
 * The operations the HMI needs from Khorde, in HMI types. The GraphQL backend
 * implements it against the real API; the mock backend implements it in memory.
 * Every store in this library talks only to this interface.
 */

import type { ConnectionState, Sink } from "./graphql/transport.ts";
import type {
  AckStatus,
  Alarm,
  AlarmJournalEntry,
  CommandKey,
  Heartbeat,
  InterlockDetail,
  InterlockState,
  Measurement,
  MeasurementType,
  RegisteredCommand,
  RegisteredMeasurement,
  RequestUpdate,
} from "./model.ts";
import type { Page, PageRequest } from "./pages.ts";
import type { Readable, Unsubscribe } from "./store.ts";

export type { ConnectionState, Sink };

export interface TimeRange {
  from?: Date;
  to?: Date;
}

export type HistoryOrder = "asc" | "desc";

/** One page of a time range, ordered by timestamp (default `asc`). */
export interface RangePageQuery extends TimeRange, PageRequest {
  order?: HistoryOrder;
}

export interface HistoryQuery extends RangePageQuery {
  /** `equipment.name` paths; `*` matches one segment, a trailing `>` one or more. */
  paths: readonly string[];
}

export interface CommandRequest {
  /** Set for analogical commands, omitted for discrete ones. */
  value?: number;
  bypassInterlock: boolean;
}

export type HeartbeatKind = "agent" | "site";

/** One change of the active alarm summary. `synced`: everything active at the start has been sent. */
export type ActiveAlarmChange =
  | { kind: "upsert"; alarm: Alarm }
  | { kind: "remove"; instanceId: string }
  | { kind: "synced" };

export interface ScadaBackend {
  /** State of the live link (the subscription socket for the real backend). */
  readonly connection: Readable<ConnectionState>;

  /** Sends the cached current value of every matching point, then every change. */
  subscribeMeasurements(paths: readonly string[], sink: Sink<Measurement>): Unsubscribe;
  subscribeMeasurementsByTag(tag: string, sink: Sink<Measurement>): Unsubscribe;
  history(type: MeasurementType, query: HistoryQuery): Promise<Page<Measurement>>;

  /** Sends every active alarm, then `synced`, then every change; again after a reconnect. */
  subscribeActiveAlarms(areas: readonly string[], sink: Sink<ActiveAlarmChange>): Unsubscribe;
  /** Every recorded alarm change in the range, ordered by timestamp, then instance id. */
  alarmJournal(query: RangePageQuery): Promise<Page<AlarmJournalEntry>>;
  /** The result of the ack shows up on `subscribeActiveAlarms`. */
  ackAlarm(key: string, instanceId: string): Promise<AckStatus>;

  /** Returns the request id to follow with `requestUpdates`. */
  sendCommand(key: CommandKey, request: CommandRequest): Promise<string>;
  requestUpdates(requestId: string): Promise<RequestUpdate[]>;
  interlockStates(keys: readonly CommandKey[]): Promise<InterlockState[]>;
  interlockDetail(key: CommandKey): Promise<InterlockDetail>;

  heartbeats(kind: HeartbeatKind, ids: readonly string[]): Promise<Heartbeat[]>;
  subscribeHeartbeats(kind: HeartbeatKind, ids: readonly string[], sink: Sink<Heartbeat>): Unsubscribe;

  registeredMeasurements(agents?: readonly string[]): Promise<RegisteredMeasurement[]>;
  registeredCommands(agents?: readonly string[]): Promise<RegisteredCommand[]>;
}
