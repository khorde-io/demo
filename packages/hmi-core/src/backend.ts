/**
 * The operations the HMI needs from Khorde, in HMI types. The GraphQL backend
 * implements it against the real API; the mock backend implements it in memory.
 * Every store in this library talks only to this interface.
 */

import type { ConnectionState, Sink } from "./graphql/transport.ts";
import type {
  Alarm,
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
import type { Readable, Unsubscribe } from "./store.ts";

export type { ConnectionState, Sink };

export interface TimeRange {
  from?: Date;
  to?: Date;
}

export interface HistoryFilter extends TimeRange {
  /** `equipment.name` path; may use `*` and `>` wildcards. */
  path?: string;
}

export interface CommandRequest {
  /** Set for analogical commands, omitted for discrete ones. */
  value?: number;
  bypassInterlock: boolean;
}

export type HeartbeatKind = "agent" | "site";

export interface ScadaBackend {
  /** State of the live link (the subscription socket for the real backend). */
  readonly connection: Readable<ConnectionState>;

  /** Sends the cached current value of every matching point, then every change. */
  subscribeMeasurements(paths: readonly string[], sink: Sink<Measurement>): Unsubscribe;
  subscribeMeasurementsByTag(tag: string, sink: Sink<Measurement>): Unsubscribe;
  history(type: MeasurementType, filter: HistoryFilter): Promise<Measurement[]>;

  activeAlarms(areas?: readonly string[]): Promise<Alarm[]>;
  alarmHistory(range: TimeRange): Promise<Alarm[]>;
  subscribeAlarms(areas: readonly string[], sink: Sink<Alarm>): Unsubscribe;
  ackAlarm(instanceId: string): Promise<boolean>;

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
