/**
 * Electrical symbols, ISA-101 style: grey, state by shape and fill. A closed
 * breaker is filled, an open one an outline; an energized conductor is bright
 * and thick, a dead one thin and grey, an unknown one dashed. Colour appears
 * only in alarm and interlock badges.
 */

import { useI18n } from "../context.tsx";
import { AlarmShape, LockBadge, SymbolGroup, TagBadge, UnknownMark } from "./parts.tsx";
import type { Energized, SwitchState, SymbolBase } from "./types.ts";

const wireClass = (e: Energized) => (e === null ? "kh-wire kh-wire--unknown" : e ? "kh-wire kh-wire--live" : "kh-wire");

interface SwitchProps extends SymbolBase {
  state: SwitchState;
  /** Is the side the supply comes from energized? Default true. */
  liveIn?: Energized;
  /** Defaults to "closed and liveIn". */
  liveOut?: Energized;
  interlocked?: boolean;
  local?: boolean;
}

/** Badges stacked down the top-right corner: alarm, interlock, local control. */
function Badges({ base, interlocked, local, x }: { base: SymbolBase; interlocked?: boolean | undefined; local?: boolean | undefined; x: number }) {
  const i18n = useI18n();
  let y = -32;
  const next = () => {
    const at = y;
    y += 20;
    return at;
  };
  return (
    <>
      {base.alarm && <AlarmShape priority={base.alarm.priority} indication={base.alarm.indication} x={x} y={next()} size={20} />}
      {interlocked && <LockBadge x={x + 3} y={next() + 2} />}
      {local && <TagBadge text={i18n.t("symbol.localTag")} x={x + 2} y={next() + 2} />}
    </>
  );
}

function switchName(i18n: ReturnType<typeof useI18n>, kind: string, p: SwitchProps): string {
  const parts = [p.label ?? i18n.t(kind), i18n.t(`symbol.switch.${p.state}`)];
  if (p.interlocked) parts.push(i18n.t("symbol.interlocked"));
  if (p.local) parts.push(i18n.t("symbol.local"));
  return parts.join(", ");
}

const outIsLive = (p: SwitchProps): Energized => {
  if (p.liveOut !== undefined) return p.liveOut;
  if (p.state === "unknown") return null;
  return p.state === "closed" ? (p.liveIn ?? true) : false;
};

/** Circuit breaker, 64 × 64. */
export function Breaker(props: SwitchProps) {
  const i18n = useI18n();
  const { state } = props;
  const liveIn = state === "unknown" ? null : (props.liveIn ?? true);
  const liveOut = outIsLive(props);
  return (
    <SymbolGroup base={props} name={switchName(i18n, "symbol.breaker", props)} className={`kh-breaker kh-breaker--${state}`}>
      <rect className="kh-sym-hit" x={-24} y={-32} width={48} height={64} />
      <line className={wireClass(liveIn)} x1={0} y1={-32} x2={0} y2={-16} />
      <line className={wireClass(liveOut)} x1={0} y1={16} x2={0} y2={32} />
      {state === "closed" ? (
        <rect className="kh-breaker-body kh-breaker-body--closed" x={-16} y={-16} width={32} height={32} />
      ) : (
        <rect className="kh-breaker-body" x={-14.5} y={-14.5} width={29} height={29} />
      )}
      {state === "intermediate" && <line className="kh-breaker-mark" x1={-14.5} y1={14.5} x2={14.5} y2={-14.5} />}
      {state === "invalid" && <path className="kh-breaker-mark" d="M-14.5 -14.5 L14.5 14.5 M14.5 -14.5 L-14.5 14.5" />}
      {state === "unknown" && <UnknownMark y={0} size={16} />}
      <Badges base={props} interlocked={props.interlocked} local={props.local} x={18} />
    </SymbolGroup>
  );
}

/** Disconnector, 48 × 64: contact at the top, blade pivoting at the bottom. */
export function Disconnector(props: SwitchProps) {
  const i18n = useI18n();
  const { state } = props;
  const liveIn = state === "unknown" ? null : (props.liveIn ?? true);
  const liveOut = outIsLive(props);
  const blade = state === "closed" ? "M0 16 V-16" : state === "open" ? "M0 16 L16 -10" : "M0 16 L8 -13";
  const bladeLive = state === "closed" ? liveOut : state === "unknown" ? null : false;
  return (
    <SymbolGroup base={props} name={switchName(i18n, "symbol.disconnector", props)} className={`kh-disconnector kh-disconnector--${state}`}>
      <rect className="kh-sym-hit" x={-20} y={-32} width={40} height={64} />
      <line className={wireClass(liveIn)} x1={0} y1={-32} x2={0} y2={-16} />
      <line className={wireClass(liveIn)} x1={-8} y1={-16} x2={8} y2={-16} />
      <path className={wireClass(bladeLive)} d={blade} />
      {state === "invalid" && <path className="kh-breaker-mark" d="M4 -6 L14 4 M14 -6 L4 4" />}
      <line className={wireClass(liveOut)} x1={0} y1={16} x2={0} y2={32} />
      <circle className={`kh-pivot${liveOut ? " kh-pivot--live" : ""}`} cx={0} cy={16} r={3.5} />
      {state === "unknown" && <UnknownMark x={13} y={-2} size={14} />}
      <Badges base={props} interlocked={props.interlocked} local={props.local} x={14} />
    </SymbolGroup>
  );
}

/** Earthing switch, 48 × 64: connection at the top, earth at the bottom. Closed means earthed. */
export function EarthingSwitch(props: Omit<SwitchProps, "liveIn" | "liveOut">) {
  const i18n = useI18n();
  const { state } = props;
  // An earthing switch is never "live"; closed draws it bright because it is a hazard to notice.
  const cls = state === "closed" ? "kh-wire kh-wire--live" : state === "unknown" ? "kh-wire kh-wire--unknown" : "kh-wire";
  const blade = state === "closed" ? "M0 -28 V8" : state === "open" ? "M0 -28 V-12 M0 8 L12 -10" : "M0 -28 V-12 M0 8 L7 -12";
  return (
    <SymbolGroup base={props} name={switchName(i18n, "symbol.earthingSwitch", props)} className={`kh-earthing kh-earthing--${state}`}>
      <rect className="kh-sym-hit" x={-20} y={-32} width={40} height={64} />
      <path className={cls} d={blade} />
      <path className={cls} d="M-10 8 H10 M-7 14 H7 M-4 20 H4" />
      {state === "invalid" && <path className="kh-breaker-mark" d="M3 -8 L13 2 M13 -8 L3 2" />}
      {state === "unknown" && <UnknownMark x={12} y={-6} size={14} />}
      <Badges base={props} interlocked={props.interlocked} local={props.local} x={14} />
    </SymbolGroup>
  );
}

export interface LineProps {
  /** Polyline points in the parent drawing: [[x, y], ...]. */
  points: readonly (readonly [number, number])[];
  energized: Energized;
}

/** A conductor between symbols. */
export function Line({ points, energized }: LineProps) {
  return <polyline className={wireClass(energized)} points={points.map((p) => p.join(",")).join(" ")} fill="none" />;
}

/** A busbar: a thick conductor. */
export function Busbar({ points, energized, label }: LineProps & { label?: string }) {
  const i18n = useI18n();
  const name = label ? `${label}, ${i18n.t(energized ? "symbol.energized" : "symbol.deEnergized")}` : undefined;
  return (
    <polyline
      className={`kh-bus${energized === null ? " kh-bus--unknown" : energized ? " kh-bus--live" : ""}`}
      points={points.map((p) => p.join(",")).join(" ")}
      fill="none"
      {...(name ? { role: "img", "aria-label": name } : {})}
    />
  );
}

export interface TransformerProps extends SymbolBase {
  /** High-voltage (top) and low-voltage (bottom) windings. */
  hvLive: Energized;
  lvLive: Energized;
  /** Tap position, written beside the symbol. */
  tap?: number | null;
}

/** Two-winding transformer, 60 × 96. */
export function Transformer2W(props: TransformerProps) {
  const i18n = useI18n();
  const { hvLive, lvLive, tap } = props;
  const name = [props.label ?? i18n.t("symbol.transformer"), tap !== undefined && tap !== null ? i18n.t("symbol.tap", { tap }) : null].filter(Boolean).join(", ");
  return (
    <SymbolGroup base={props} name={name} className="kh-transformer">
      <rect className="kh-sym-hit" x={-30} y={-48} width={60} height={96} />
      <line className={wireClass(hvLive)} x1={0} y1={-48} x2={0} y2={-36} />
      <circle className={`kh-winding ${wireClass(hvLive)}`} cx={0} cy={-12} r={24} />
      <circle className={`kh-winding ${wireClass(lvLive)}`} cx={0} cy={12} r={24} />
      <line className={wireClass(lvLive)} x1={0} y1={36} x2={0} y2={48} />
      {tap !== undefined && tap !== null && (
        <text className="kh-sym-text" x={32} y={4}>
          {i18n.t("symbol.tap", { tap })}
        </text>
      )}
      <Badges base={props} x={22} />
    </SymbolGroup>
  );
}

/** Generator, 48 × 48. */
export function Generator(props: SymbolBase & { energized: Energized }) {
  const i18n = useI18n();
  return (
    <SymbolGroup base={props} name={props.label ?? i18n.t("symbol.generator")} className="kh-generator">
      <circle className={wireClass(props.energized)} cx={0} cy={0} r={20} />
      <text className="kh-sym-text kh-sym-text--center" x={0} y={6} textAnchor="middle">
        G
      </text>
      <Badges base={props} x={14} />
    </SymbolGroup>
  );
}

/** Load (an arrow into the consumer), 32 × 40. */
export function Load(props: SymbolBase & { energized: Energized }) {
  const i18n = useI18n();
  return (
    <SymbolGroup base={props} name={props.label ?? i18n.t("symbol.load")} className="kh-load">
      <line className={wireClass(props.energized)} x1={0} y1={-20} x2={0} y2={6} />
      <path className={`kh-load-head${props.energized ? " kh-load-head--live" : ""}`} d="M-10 4 L10 4 L0 20 Z" />
    </SymbolGroup>
  );
}
