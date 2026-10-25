/**
 * Communication health: agent and site heartbeats, the measurement/command
 * registry, and the link between them (points of an offline agent are stale).
 */

import type { HeartbeatKind, ScadaBackend } from "./backend.ts";
import { pointId, type CommandKey, type Heartbeat, type PointId, type RegisteredCommand, type RegisteredMeasurement } from "./model.ts";
import type { PointStore } from "./points.ts";
import { writable, type Readable, type Unsubscribe } from "./store.ts";

export type HeartbeatMap = ReadonlyMap<string, Heartbeat>;

export interface HeartbeatMonitor extends Readable<HeartbeatMap> {
  start(): Promise<void>;
  stop(): void;
}

export function createHeartbeatMonitor(
  backend: ScadaBackend,
  kind: HeartbeatKind,
  ids: readonly string[],
): HeartbeatMonitor {
  const state = writable<HeartbeatMap>(
    new Map(ids.map((id) => [id, { id, status: "unknown", lastSeenAt: null } satisfies Heartbeat])),
  );
  let stopSubscription: Unsubscribe | null = null;

  const apply = (hb: Heartbeat) => {
    const next = new Map(state.get());
    next.set(hb.id, hb);
    state.set(next);
  };

  return {
    get: state.get,
    subscribe: state.subscribe,
    async start() {
      if (stopSubscription || ids.length === 0) return;
      stopSubscription = backend.subscribeHeartbeats(kind, ids, { next: apply });
      for (const hb of await backend.heartbeats(kind, ids)) apply(hb);
    },
    stop() {
      stopSubscription?.();
      stopSubscription = null;
    },
  };
}

export interface Registry {
  measurements: ReadonlyMap<PointId, RegisteredMeasurement>;
  commands: readonly RegisteredCommand[];
  agentOf(id: PointId): string | undefined;
  /** The full command key for `equipment` + command `name`, if registered. */
  command(equipment: string, name: string): CommandKey | undefined;
  /** Ids from the list that no agent has registered (typos, missing config). */
  unknownPoints(ids: readonly PointId[]): PointId[];
}

export async function loadRegistry(backend: ScadaBackend, agents?: readonly string[]): Promise<Registry> {
  const [ms, commands] = await Promise.all([backend.registeredMeasurements(agents), backend.registeredCommands(agents)]);
  const measurements = new Map(ms.map((m) => [pointId(m.equipment, m.name), m] as const));
  return {
    measurements,
    commands,
    agentOf: (id) => measurements.get(id)?.agent,
    command: (equipment, name) => commands.find((c) => c.equipment === equipment && c.name === name),
    unknownPoints: (ids) => ids.filter((id) => !measurements.has(id)),
  };
}

/** Keeps points stale while the agent that publishes them is not online. */
export function linkAgentStaleness(points: PointStore, monitor: HeartbeatMonitor, registry: Registry): Unsubscribe {
  const sync = () => {
    for (const [agent, hb] of monitor.get()) {
      points.setStale((id) => registry.agentOf(id) === agent, hb.status === "offline");
    }
  };
  sync();
  return monitor.subscribe(sync);
}
