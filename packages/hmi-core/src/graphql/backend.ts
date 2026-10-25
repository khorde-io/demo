/** `ScadaBackend` over the Khorde GraphQL API. */

import type { CommandRequest, HeartbeatKind, HistoryFilter, ScadaBackend, TimeRange } from "../backend.ts";
import { pointPath, type Measurement } from "../model.ts";
import { matchPath } from "../paths.ts";
import type {
  CommandKey,
  InterlockDetail,
  InterlockState,
  MeasurementType,
  RegisteredCommand,
  RegisteredMeasurement,
} from "../model.ts";
import * as doc from "./documents.ts";
import {
  toAlarm,
  toHeartbeat,
  toMeasurement,
  toRequestUpdate,
  type RawAlarm,
  type RawHeartbeat,
  type RawMeasurement,
  type RawRequestUpdate,
} from "./map.ts";
import type { Transport } from "./transport.ts";

const iso = (d: Date | undefined) => (d ? d.toISOString() : undefined);

function timestampFilter(range: TimeRange) {
  return { from: iso(range.from), to: iso(range.to) };
}

/**
 * The hub filters history by a regex on the point name only (`name ~ '…'`);
 * path wildcards are planned. Until then the name segment of the path becomes
 * an anchored regex and the equipment part is filtered here. When the backend
 * takes paths, only `history` below changes: it sends the path as is.
 */
export function historyNameFilter(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const name = path.split(".").at(-1) ?? "";
  if (name === "*" || name === ">" || name === "") return undefined;
  if (!/^[\w-]+$/.test(name)) throw new Error(`History path has an unsupported name segment: ${path}`);
  return `^${name}$`;
}

function keepPath(path: string | undefined) {
  return (m: Measurement) => !path || matchPath(path, pointPath(m.id));
}

const commandVars = (key: CommandKey) => ({ agent: key.agent, equipment: key.equipment, name: key.name });

export function createGraphQLBackend(transport: Transport): ScadaBackend {
  const { request, subscribe } = transport;

  return {
    connection: transport.connection,

    subscribeMeasurements(paths, sink) {
      return subscribe<{ measByPaths: RawMeasurement }>(doc.MEAS_BY_PATHS, { paths }, {
        next: (d) => sink.next(toMeasurement(d.measByPaths)),
        error: sink.error,
      });
    },

    subscribeMeasurementsByTag(tag, sink) {
      return subscribe<{ measByTag: RawMeasurement }>(doc.MEAS_BY_TAG, { tag }, {
        next: (d) => sink.next(toMeasurement(d.measByTag)),
        error: sink.error,
      });
    },

    async history(type: MeasurementType, filter: HistoryFilter) {
      const name = historyNameFilter(filter.path);
      const variables = { filter: { ...(name ? { name } : {}), timestamp: timestampFilter(filter) } };
      const raw =
        type === "analogical"
          ? (await request<{ histAnalogical: RawMeasurement[] }>(doc.HIST_ANALOGICAL, variables)).histAnalogical
          : (await request<{ histDiscrete: RawMeasurement[] }>(doc.HIST_DISCRETE, variables)).histDiscrete;
      return raw.map(toMeasurement).filter(keepPath(filter.path));
    },

    async activeAlarms(areas = []) {
      const d = await request<{ activeAlm: RawAlarm[] }>(doc.ACTIVE_ALARMS, { areas });
      return d.activeAlm.map(toAlarm);
    },

    async alarmHistory(range) {
      const d = await request<{ alm: RawAlarm[] }>(doc.ALARM_HISTORY, { filter: { timestamp: timestampFilter(range) } });
      return d.alm.map(toAlarm);
    },

    subscribeAlarms(areas, sink) {
      return subscribe<{ almSubscribe: RawAlarm }>(doc.ALARM_SUBSCRIBE, { areas }, {
        next: (d) => sink.next(toAlarm(d.almSubscribe)),
        error: sink.error,
      });
    },

    async ackAlarm(instanceId) {
      const d = await request<{ almAck: boolean }>(doc.ALARM_ACK, { instanceId });
      return d.almAck;
    },

    async sendCommand(key: CommandKey, req: CommandRequest) {
      if (req.value !== undefined) {
        const d = await request<{ analogicalCommandRequest: string }>(doc.ANALOGICAL_COMMAND, {
          ...commandVars(key),
          value: req.value,
          bypassInterlock: req.bypassInterlock,
        });
        return d.analogicalCommandRequest;
      }
      const d = await request<{ discreteCommandRequest: string }>(doc.DISCRETE_COMMAND, {
        ...commandVars(key),
        bypassInterlock: req.bypassInterlock,
      });
      return d.discreteCommandRequest;
    },

    async requestUpdates(requestId) {
      const d = await request<{ requestUpdate: RawRequestUpdate[] }>(doc.REQUEST_UPDATE, { requestId });
      return d.requestUpdate.map(toRequestUpdate);
    },

    async interlockStates(keys) {
      const d = await request<{ commandInterlockStates: InterlockState[] }>(doc.INTERLOCK_STATES, {
        commands: keys.map(commandVars),
      });
      return d.commandInterlockStates;
    },

    async interlockDetail(key) {
      const d = await request<{ commandInterlockDetail: InterlockDetail }>(doc.INTERLOCK_DETAIL, commandVars(key));
      return d.commandInterlockDetail;
    },

    async heartbeats(kind: HeartbeatKind, ids) {
      if (kind === "agent") {
        const d = await request<{ agentHeartbeats: RawHeartbeat[] }>(doc.AGENT_HEARTBEATS, { agents: ids });
        return d.agentHeartbeats.map(toHeartbeat);
      }
      const d = await request<{ siteHeartbeats: RawHeartbeat[] }>(doc.SITE_HEARTBEATS, { sites: ids });
      return d.siteHeartbeats.map(toHeartbeat);
    },

    subscribeHeartbeats(kind: HeartbeatKind, ids, sink) {
      if (kind === "agent") {
        return subscribe<{ agentHeartbeatSubscribe: RawHeartbeat }>(doc.AGENT_HEARTBEAT_SUBSCRIBE, { agents: ids }, {
          next: (d) => sink.next(toHeartbeat(d.agentHeartbeatSubscribe)),
          error: sink.error,
        });
      }
      return subscribe<{ siteHeartbeatSubscribe: RawHeartbeat }>(doc.SITE_HEARTBEAT_SUBSCRIBE, { sites: ids }, {
        next: (d) => sink.next(toHeartbeat(d.siteHeartbeatSubscribe)),
        error: sink.error,
      });
    },

    async registeredMeasurements(agents?: readonly string[]): Promise<RegisteredMeasurement[]> {
      const d = await request<{ registeredMeasurements: RegisteredMeasurement[] }>(doc.REGISTERED_MEASUREMENTS, {
        agents: agents ?? null,
      });
      return d.registeredMeasurements;
    },

    async registeredCommands(agents?: readonly string[]): Promise<RegisteredCommand[]> {
      const d = await request<{ registeredCommands: RegisteredCommand[] }>(doc.REGISTERED_COMMANDS, {
        agents: agents ?? null,
      });
      return d.registeredCommands;
    },
  };
}
