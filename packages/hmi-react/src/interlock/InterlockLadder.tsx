import type { NodeState } from "@khorde/hmi-core";
import { useI18n } from "../context.tsx";
import type { GateBox, Ladder } from "./layout.ts";

export interface InterlockLadderProps {
  ladder: Ladder;
  /** Short text for each condition, by number. */
  gateText: (n: number) => string;
  /** Command name for the end node: "Close". */
  command: string;
  /** Condition number to emphasise (kept in sync with the list). */
  highlighted?: number | null;
  onHighlight?: (n: number | null) => void;
}

const stateClass = (s: NodeState | null) => (s === "PERMIT" ? "permit" : s === "BLOCK" ? "block" : "unknown");

/** Fits text into a gate; the full text stays in the gate's tooltip and in the list. */
function fit(text: string, width: number): string {
  const max = Math.floor(width / 6.8);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function GateIcon({ state, x, y }: { state: NodeState | null; x: number; y: number }) {
  if (state === "PERMIT") return <path className="kh-ilk-ico-permit" d={`M${x - 6} ${y} l4 4 l8 -8`} />;
  if (state === "BLOCK")
    return (
      <g className="kh-ilk-ico-block">
        <rect x={x - 6} y={y - 2} width={12} height={9} rx={1.5} />
        <path d={`M${x - 3.5} ${y - 2} v-2.5 a3.5 3.5 0 0 1 7 0 v2.5`} />
      </g>
    );
  return (
    <text className="kh-ilk-ico-unknown" x={x} y={y + 5} textAnchor="middle">
      ?
    </text>
  );
}

function Gate({ gate, text, hl, onHighlight }: { gate: GateBox; text: string; hl: boolean; onHighlight?: (n: number | null) => void }) {
  const i18n = useI18n();
  const { condition: c, flow } = gate;
  const cls = [
    "kh-ilk-gate",
    `kh-ilk-gate--${stateClass(c.state)}`,
    flow.stops ? "kh-ilk-gate--stops" : "",
    !flow.reached || !flow.needed ? "kh-ilk-gate--muted" : "",
    hl ? "kh-ilk-gate--hl" : "",
  ].join(" ");
  const cy = gate.y + gate.h / 2;
  const state = i18n.t(`interlock.state.${c.state ?? "BAD_QUALITY"}`);
  return (
    // Not a tab stop: the drawing is one image, and the condition list beside it
    // carries the same items for the keyboard. Hovering still pairs them up.
    <g className={cls} data-n={c.n} onPointerEnter={() => onHighlight?.(c.n)} onPointerLeave={() => onHighlight?.(null)}>
      <title>{`${c.n}. ${text}: ${flow.stops ? i18n.t("interlock.stopsHere") : state}`}</title>
      <rect className="kh-ilk-gate-box" x={gate.x} y={gate.y} width={gate.w} height={gate.h} rx={6} />
      <circle className="kh-ilk-badge" cx={gate.x + 18} cy={cy} r={10} />
      <text className="kh-ilk-badge-t" x={gate.x + 18} y={cy + 4} textAnchor="middle">
        {c.n}
      </text>
      <text className="kh-ilk-gate-t" x={gate.x + 36} y={cy + 4.5}>
        {fit(text, gate.w - 64)}
      </text>
      <GateIcon state={c.state} x={gate.x + gate.w - 20} y={cy} />
    </g>
  );
}

/** The ladder drawing. Use `InterlockPanel` for the whole view with its list. */
export function InterlockLadder({ ladder, gateText, command, highlighted = null, onHighlight }: InterlockLadderProps) {
  const i18n = useI18n();
  const { start, end } = ladder;
  const outcome = i18n.t(end.allowed ? "interlock.allowed" : "interlock.notAllowed", { command });
  return (
    <svg
      className="kh-ilk-ladder"
      viewBox={`0 0 ${ladder.width} ${ladder.height}`}
      width={ladder.width}
      height={ladder.height}
      role="img"
      aria-label={i18n.t("interlock.ladderLabel", { command, outcome })}
    >
      {ladder.frames.map((f) => (
        <g key={f.path} className={`kh-ilk-frame kh-ilk-frame--${f.kind}${f.kind === "not" && f.flow?.stops ? " kh-ilk-frame--stops" : ""}`}>
          <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={8} />
          <text className="kh-ilk-frame-tag" x={f.x + 10} y={f.y + 14}>
            {i18n.t(f.kind === "ref" ? "interlock.refTag" : "interlock.notTag")}
          </text>
          <text className="kh-ilk-frame-t" x={f.cx + 10} y={f.y + 14}>
            {f.kind === "ref" ? f.key : i18n.t("interlock.notGroup")}
          </text>
        </g>
      ))}
      {ladder.wires.map((w, i) => (
        <line key={i} className={w.live ? "kh-ilk-wire kh-ilk-wire--live" : "kh-ilk-wire"} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} />
      ))}
      <circle className="kh-ilk-start" cx={start.x} cy={start.y} r={8} />
      <text className="kh-ilk-node-t" x={start.x + 18} y={start.y + 4}>
        {i18n.t("interlock.request")}
      </text>
      {ladder.gates.map((g) => (
        <Gate key={g.condition.path} gate={g} text={gateText(g.condition.n)} hl={highlighted === g.condition.n} {...(onHighlight ? { onHighlight } : {})} />
      ))}
      <g className={end.allowed ? "kh-ilk-end kh-ilk-end--allowed" : "kh-ilk-end"}>
        <circle className="kh-ilk-end-ring" cx={end.x} cy={end.y} r={14} />
        <circle className="kh-ilk-end-dot" cx={end.x} cy={end.y} r={10} />
        {end.allowed && <path className="kh-ilk-end-check" d={`M${end.x - 5} ${end.y} l3.5 3.5 l6.5 -7`} />}
      </g>
      <text className="kh-ilk-node-t kh-ilk-node-t--strong" x={end.x + 24} y={end.y + 5}>
        {outcome}
      </text>
    </svg>
  );
}
