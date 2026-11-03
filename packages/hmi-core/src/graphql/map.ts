/** Converts raw GraphQL payloads into HMI model types. */

import type { ActiveAlarmChange } from "../backend.ts";
import {
  PRIORITY_BY_SEVERITY,
  pointId,
  type Alarm,
  type AlarmJournalEntry,
  type AlarmJournalKind,
  type AlarmSeverity,
  type AlarmState,
  type Connectivity,
  type Heartbeat,
  type Measurement,
  type MeasurementType,
  type PointRawValue,
  type Quality,
  type RequestState,
  type RequestUpdate,
} from "../model.ts";

export interface RawMeasurement {
  name: string;
  equipment: string;
  timestamp: string;
  type: MeasurementType;
  value: unknown;
  quality: string;
}

type RawAckStatus = "NOT_ACK" | "ACK" | "ACK_PENDING";

export interface RawAlarm {
  key: string;
  origin: string;
  name: string;
  area: string;
  condition: string;
  instanceId: string;
  state: AlarmState;
  severity: AlarmSeverity;
  value: number;
  setAt: string;
  stateAt: string;
  ack: RawAckStatus;
  ackedAt: string | null;
  ackedBy: string | null;
  originOnline: boolean;
}

export interface RawAlarmChange {
  kind: "UPSERT" | "REMOVE" | "SYNCED";
  instanceId: string | null;
  alarm: RawAlarm | null;
}

export interface RawJournalEntry {
  timestamp: string;
  kind: AlarmJournalKind;
  origin: string;
  name: string;
  area: string;
  condition: string;
  instanceId: string;
  state: AlarmState | null;
  value: number | null;
  severity: AlarmSeverity | null;
  ack: RawAckStatus;
  ackedAt: string | null;
  ackedBy: string | null;
}

export interface RawRequestUpdate {
  id: string;
  name: string;
  state: RequestState;
  msg: string;
  timestamp: string;
  actorId: string | null;
  actorDisplay: string | null;
}

export interface RawHeartbeat {
  agent?: string;
  site?: string;
  status: Connectivity;
  lastSeenAt: string | null;
}

/** Khorde sends `good` or `bad`; anything else is treated as bad. */
export function toQuality(raw: string): Quality {
  return raw.trim().toLowerCase() === "good" ? "good" : "bad";
}

export function toDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toValue(raw: unknown): PointRawValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") return raw;
  return JSON.stringify(raw);
}

export function toMeasurement(raw: RawMeasurement): Measurement {
  return {
    id: pointId(raw.equipment, raw.name),
    equipment: raw.equipment,
    name: raw.name,
    type: raw.type,
    value: toValue(raw.value),
    quality: toQuality(raw.quality),
    timestamp: toDate(raw.timestamp) ?? new Date(0),
  };
}

export function toAlarm(raw: RawAlarm): Alarm {
  return {
    key: raw.key,
    instanceId: raw.instanceId,
    origin: raw.origin,
    name: raw.name,
    area: raw.area,
    condition: raw.condition,
    state: raw.state,
    severity: raw.severity,
    priority: PRIORITY_BY_SEVERITY[raw.severity] ?? 3,
    value: raw.value,
    setAt: toDate(raw.setAt) ?? new Date(0),
    stateAt: toDate(raw.stateAt) ?? new Date(0),
    // A pending ack is an operator's ack: it just hasn't reached the owner site yet.
    acked: raw.ack !== "NOT_ACK",
    ackPending: raw.ack === "ACK_PENDING",
    ackedAt: toDate(raw.ackedAt),
    ackedBy: raw.ackedBy,
    originOnline: raw.originOnline,
  };
}

/** Null for a change that lacks what its kind promises. */
export function toAlarmChange(raw: RawAlarmChange): ActiveAlarmChange | null {
  if (raw.kind === "SYNCED") return { kind: "synced" };
  if (raw.kind === "UPSERT") return raw.alarm ? { kind: "upsert", alarm: toAlarm(raw.alarm) } : null;
  return raw.instanceId ? { kind: "remove", instanceId: raw.instanceId } : null;
}

export function toJournalEntry(raw: RawJournalEntry): AlarmJournalEntry {
  return {
    timestamp: toDate(raw.timestamp) ?? new Date(0),
    kind: raw.kind,
    origin: raw.origin,
    name: raw.name,
    area: raw.area,
    condition: raw.condition,
    instanceId: raw.instanceId,
    state: raw.state,
    severity: raw.severity,
    priority: raw.severity ? (PRIORITY_BY_SEVERITY[raw.severity] ?? 3) : null,
    value: raw.value,
    acked: raw.ack !== "NOT_ACK",
    ackedAt: toDate(raw.ackedAt),
    ackedBy: raw.ackedBy,
  };
}

export function toRequestUpdate(raw: RawRequestUpdate): RequestUpdate {
  return { ...raw, timestamp: toDate(raw.timestamp) ?? new Date(0) };
}

export function toHeartbeat(raw: RawHeartbeat): Heartbeat {
  return { id: raw.agent ?? raw.site ?? "", status: raw.status, lastSeenAt: toDate(raw.lastSeenAt) };
}
