/** Converts raw GraphQL payloads into HMI model types. */

import {
  PRIORITY_BY_SEVERITY,
  pointId,
  type Alarm,
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

export interface RawAlarm {
  name: string;
  area: string;
  condition: string;
  instanceId: string;
  timestamp: string;
  state: AlarmState;
  value: number;
  severity: AlarmSeverity;
  ack: "Ack" | "NotAck";
  ackTimestamp: string | null;
  actorId: string | null;
  actorDisplay: string | null;
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
    instanceId: raw.instanceId,
    name: raw.name,
    area: raw.area,
    condition: raw.condition,
    state: raw.state,
    severity: raw.severity,
    priority: PRIORITY_BY_SEVERITY[raw.severity] ?? 3,
    value: raw.value,
    timestamp: toDate(raw.timestamp) ?? new Date(0),
    acked: raw.ack === "Ack",
    ackTimestamp: toDate(raw.ackTimestamp),
    actorId: raw.actorId,
    actorDisplay: raw.actorDisplay,
  };
}

export function toRequestUpdate(raw: RawRequestUpdate): RequestUpdate {
  return { ...raw, timestamp: toDate(raw.timestamp) ?? new Date(0) };
}

export function toHeartbeat(raw: RawHeartbeat): Heartbeat {
  return { id: raw.agent ?? raw.site ?? "", status: raw.status, lastSeenAt: toDate(raw.lastSeenAt) };
}
