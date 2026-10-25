/**
 * Symbols bound to live points. The point ids are props because naming is the
 * project's business; the codings default to the usual ones and can be
 * replaced. Use the pure symbols directly to bind them any other way.
 */

import type { PointId } from "@khorde/hmi-core";
import type { ComponentProps } from "react";
import { usePoint } from "../context.tsx";
import { Breaker, Disconnector, EarthingSwitch } from "./electrical.tsx";
import { SWITCH_CODES, switchStateOf, type SwitchState } from "./types.ts";
import { TURBINE_CODES, WindTurbine, type TurbineState } from "./wind.tsx";

interface BoundSwitch {
  /** Position point (`equipment::pos`). */
  pos: PointId;
  codes?: Readonly<Record<number, SwitchState>>;
  /** Remote/local point; the symbol shows "L" while it reads `localCode`. */
  remoteLocal?: PointId;
  localCode?: number;
}

function useSwitch({ pos, codes = SWITCH_CODES, remoteLocal, localCode = 0 }: BoundSwitch) {
  const p = usePoint(pos);
  // Hooks run unconditionally; an absent remote/local point reads the position again.
  const rl = usePoint(remoteLocal ?? pos);
  const local = remoteLocal !== undefined && rl?.quality === "good" && rl.value === localCode;
  return { state: switchStateOf(p, codes), local };
}

type SwitchRest<T> = Omit<T, "state" | "local">;

export function BoundBreaker({ pos, codes, remoteLocal, localCode, ...rest }: BoundSwitch & SwitchRest<ComponentProps<typeof Breaker>>) {
  return <Breaker {...rest} {...useSwitch({ pos, codes, remoteLocal, localCode } as BoundSwitch)} />;
}

export function BoundDisconnector({ pos, codes, remoteLocal, localCode, ...rest }: BoundSwitch & SwitchRest<ComponentProps<typeof Disconnector>>) {
  return <Disconnector {...rest} {...useSwitch({ pos, codes, remoteLocal, localCode } as BoundSwitch)} />;
}

export function BoundEarthingSwitch({ pos, codes, remoteLocal, localCode, ...rest }: BoundSwitch & SwitchRest<ComponentProps<typeof EarthingSwitch>>) {
  return <EarthingSwitch {...rest} {...useSwitch({ pos, codes, remoteLocal, localCode } as BoundSwitch)} />;
}

export function turbineStateOf(
  state: { value: unknown; quality: string } | undefined,
  codes: Readonly<Record<number, TurbineState>> = TURBINE_CODES,
): TurbineState {
  if (!state || state.quality !== "good" || typeof state.value !== "number") return "unknown";
  return codes[state.value] ?? "unknown";
}

export function BoundWindTurbine({
  state,
  codes,
  ...rest
}: { state: PointId; codes?: Readonly<Record<number, TurbineState>> } & Omit<ComponentProps<typeof WindTurbine>, "state">) {
  return <WindTurbine {...rest} state={turbineStateOf(usePoint(state), codes)} />;
}
