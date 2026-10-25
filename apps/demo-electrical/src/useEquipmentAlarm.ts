import type { Alarm } from "@khorde/hmi-core";
import { alarmIndication, useAlarms, type SymbolAlarm } from "@khorde/hmi-react";
import { useMemo } from "react";
import { alarmPrefix } from "./plant.ts";

/** The alarm to show on a symbol: the most urgent, unacknowledged before acknowledged. */
export function worstAlarm(alarms: readonly Alarm[]): SymbolAlarm | null {
  let worst: Alarm | null = null;
  for (const a of alarms) {
    if (!worst || a.priority < worst.priority || (a.priority === worst.priority && !a.acked && worst.acked)) worst = a;
  }
  return worst ? { priority: worst.priority, indication: alarmIndication(worst) } : null;
}

/** For each equipment id, the alarm its symbol shows (its own alarms and those of what it contains). */
export function useEquipmentAlarms(): (equipment: string) => SymbolAlarm | null {
  const { alarms } = useAlarms();
  return useMemo(() => {
    // Index every alarm under each leading part of its name: `sub_mv_a_f1_cb_trip` under `sub`, `sub_mv`, … `sub_mv_a_f1_cb`.
    const byPrefix = new Map<string, Alarm[]>();
    for (const a of alarms) {
      const parts = a.name.split("_");
      for (let n = 1; n < parts.length; n++) {
        const key = `${parts.slice(0, n).join("_")}_`;
        byPrefix.set(key, [...(byPrefix.get(key) ?? []), a]);
      }
    }
    const worst = new Map([...byPrefix].map(([k, list]) => [k, worstAlarm(list)] as const));
    return (equipment: string) => worst.get(alarmPrefix(equipment)) ?? null;
  }, [alarms]);
}
