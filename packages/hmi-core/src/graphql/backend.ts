/** `ScadaBackend` over the Khorde GraphQL API. */

import type { CommandRequest, HeartbeatKind, HistoryQuery, RangePageQuery, ScadaBackend, TimeRange } from "../backend.ts";
import { PAGE_MAX, type Page } from "../pages.ts";
import type {
  AckStatus,
  CommandKey,
  InterlockDetail,
  InterlockState,
  MeasurementType,
  RegisteredCommand,
  RegisteredMeasurement,
} from "../model.ts";
import * as doc from "./documents.ts";
import {
  toAlarmChange,
  toHeartbeat,
  toJournalEntry,
  toMeasurement,
  toRequestUpdate,
  type RawAlarmChange,
  type RawHeartbeat,
  type RawJournalEntry,
  type RawMeasurement,
  type RawRequestUpdate,
} from "./map.ts";
import type { Transport } from "./transport.ts";

const iso = (d: Date | undefined) => (d ? d.toISOString() : undefined);

function timestampFilter(range: TimeRange) {
  return { from: iso(range.from), to: iso(range.to) };
}

const DEFAULT_PAGE = 1_000;

type RawPage<T> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] };

/** The paging arguments shared by `histAnalogical`, `histDiscrete` and `alarmJournal`. */
function pageVars(query: RangePageQuery) {
  return {
    order: query.order === "desc" ? "DESC" : "ASC",
    first: Math.min(PAGE_MAX, Math.max(1, query.first ?? DEFAULT_PAGE)),
    after: query.after,
  };
}

function toPage<R, T>(raw: RawPage<R>, map: (r: R) => T): Page<T> {
  return { items: raw.nodes.map(map), next: raw.pageInfo.hasNextPage ? raw.pageInfo.endCursor : null };
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

    async history(type: MeasurementType, query: HistoryQuery) {
      // The API returns no rows for no paths; skip the round trip.
      if (query.paths.length === 0) return { items: [], next: null };
      const variables = {
        paths: query.paths,
        timestamp: query.from || query.to ? timestampFilter(query) : undefined,
        ...pageVars(query),
      };
      const page =
        type === "analogical"
          ? (await request<{ histAnalogical: RawPage<RawMeasurement> }>(doc.HIST_ANALOGICAL, variables)).histAnalogical
          : (await request<{ histDiscrete: RawPage<RawMeasurement> }>(doc.HIST_DISCRETE, variables)).histDiscrete;
      return toPage(page, toMeasurement);
    },

    subscribeActiveAlarms(areas, sink) {
      return subscribe<{ activeAlarmChanges: RawAlarmChange }>(doc.ACTIVE_ALARM_CHANGES, { areas }, {
        next: (d) => {
          const change = toAlarmChange(d.activeAlarmChanges);
          if (change) sink.next(change);
        },
        error: sink.error,
      });
    },

    async alarmJournal(query) {
      const d = await request<{ alarmJournal: RawPage<RawJournalEntry> }>(doc.ALARM_JOURNAL, { filter: { timestamp: timestampFilter(query) }, ...pageVars(query) });
      return toPage(d.alarmJournal, toJournalEntry);
    },

    async ackAlarm(key, instanceId) {
      const d = await request<{ ackAlarm: { status: AckStatus } }>(doc.ACK_ALARM, { key, instanceId });
      return d.ackAlarm.status;
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
