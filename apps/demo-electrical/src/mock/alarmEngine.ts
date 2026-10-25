/**
 * Evaluates agent-config alarm definitions against live values and raises and
 * resets them on the mock backend, as the hub does for the real agents.
 * Digital alarms follow `set` / `reset`, discrete ones their condition values,
 * and analog ones their limits with deadband. Bad quality holds the state.
 */

import type { AlarmSeverity, Measurement, PointId } from "@khorde/hmi-core";
import type { MockBackend } from "@khorde/hmi-core/mock";

type Limit = { value: number; severity: AlarmSeverity; deadband?: number };

export type AlarmConfig = Record<string, unknown> & { name: string; area: string; meas: string };

export interface AlarmEngine {
  evaluate(read: (id: PointId) => Measurement | undefined): void;
  /** Active condition per alarm name. */
  active(): ReadonlyMap<string, string>;
}

/** Limits from the most to the least severe, so the worst one wins. */
const LIMITS = [
  ["high_high", "high"],
  ["low_low", "low"],
  ["high", "high"],
  ["low", "low"],
] as const;

/** The analog condition now active, given the one active before (for the deadband). */
export function analogCondition(conditions: Partial<Record<string, Limit>>, value: number, before: string | null): string | null {
  for (const [id, side] of LIMITS) {
    const limit = conditions[id];
    if (!limit) continue;
    const db = before === id ? (limit.deadband ?? 0) : 0;
    if (side === "high" ? value >= limit.value - db : value <= limit.value + db) return id;
  }
  return null;
}

function evaluateOne(config: AlarmConfig, value: number, before: string | null): { condition: string; severity: AlarmSeverity } | null {
  switch (config.type) {
    case "digital": {
      if (value === config.set) return { condition: "set", severity: config.severity as AlarmSeverity };
      if (value === config.reset) return null;
      return before ? { condition: before, severity: config.severity as AlarmSeverity } : null;
    }
    case "discrete": {
      const hit = (config.conditions as { id: string; value: number; severity: AlarmSeverity }[]).find((c) => c.value === value);
      return hit ? { condition: hit.id, severity: hit.severity } : null;
    }
    case "analog": {
      const conditions = config.conditions as Partial<Record<string, Limit>>;
      const id = analogCondition(conditions, value, before);
      return id ? { condition: id, severity: (conditions[id] as Limit).severity } : null;
    }
    default:
      return null;
  }
}

export function createAlarmEngine(configs: readonly AlarmConfig[], backend: Pick<MockBackend, "raiseAlarm" | "resetAlarm">): AlarmEngine {
  const current = new Map<string, { condition: string; instanceId: string }>();
  return {
    evaluate(read) {
      for (const config of configs) {
        const m = read(config.meas as PointId);
        if (!m || m.quality !== "good" || typeof m.value !== "number") continue;
        const before = current.get(config.name) ?? null;
        const next = evaluateOne(config, m.value, before?.condition ?? null);
        if (next?.condition === before?.condition) continue;
        if (before) {
          backend.resetAlarm(before.instanceId);
          current.delete(config.name);
        }
        if (next) {
          const a = backend.raiseAlarm({ name: config.name, area: config.area, condition: next.condition, severity: next.severity, value: m.value });
          current.set(config.name, { condition: next.condition, instanceId: a.instanceId });
        }
      }
    },
    active: () => new Map([...current].map(([name, c]) => [name, c.condition])),
  };
}
