/**
 * Building blocks shared by the symbols: the positioned, optionally clickable
 * group, the alarm shape (◆1 ▲2 ■3, colour plus shape plus number), and the
 * interlock and local-control badges.
 */

import "./symbols.css";
import type { KeyboardEvent, ReactNode } from "react";
import type { AlarmPriority } from "@khorde/hmi-core";
import { useI18n } from "../context.tsx";
import type { AlarmIndication, SymbolBase } from "./types.ts";

/** Dictionary key of the text for each alarm indication. */
export const INDICATION_KEY: Record<AlarmIndication, string> = {
  "active-unacked": "alarmIndicator.activeUnacked",
  "active-acked": "alarmIndicator.activeAcked",
  "returned-unacked": "alarmIndicator.returnedUnacked",
};

export function SymbolGroup({
  base,
  name,
  className,
  children,
}: {
  base: SymbolBase;
  /** Full accessible name, state included. */
  name: string;
  className: string;
  children: ReactNode;
}) {
  const i18n = useI18n();
  const { x = 0, y = 0, rotate = 0, scale = 1, onActivate, selected } = base;
  // The badges are drawn, not read: the alarm goes into the name instead.
  const label = base.alarm ? `${name}, ${i18n.t(INDICATION_KEY[base.alarm.indication], { priority: base.alarm.priority })}` : name;
  const transform = `translate(${x} ${y})${rotate ? ` rotate(${rotate})` : ""}${scale !== 1 ? ` scale(${scale})` : ""}`;
  const onKeyDown = (e: KeyboardEvent) => {
    if (onActivate && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onActivate();
    }
  };
  const cls = `kh-sym ${className}${onActivate ? " kh-sym--active" : ""}${selected ? " kh-sym--selected" : ""}`;
  return onActivate ? (
    <g className={cls} transform={transform} role="button" tabIndex={0} aria-label={label} onClick={onActivate} onKeyDown={onKeyDown}>
      <title>{label}</title>
      {children}
    </g>
  ) : (
    <g className={cls} transform={transform} role="img" aria-label={label}>
      <title>{label}</title>
      {children}
    </g>
  );
}

/** The priority shape, `size` wide, with its top-left corner at (x, y). */
export function AlarmShape({ priority, indication = "active-acked", x = 0, y = 0, size = 20 }: { priority: AlarmPriority; indication?: AlarmIndication; x?: number; y?: number; size?: number }) {
  const s = size / 20;
  const outline = indication === "returned-unacked";
  const shape =
    priority === 1 ? (
      <polygon points="10,1 19,10 10,19 1,10" />
    ) : priority === 2 ? (
      <polygon points="10,1.5 19,18 1,18" />
    ) : (
      <rect x={2.5} y={2.5} width={15} height={15} />
    );
  return (
    <g
      aria-hidden="true"
      className={`kh-alarm-shape kh-alarm-shape--p${priority}${outline ? " kh-alarm-shape--outline" : ""}${indication === "active-unacked" ? " kh-alarm-shape--unacked" : ""}`}
      transform={`translate(${x} ${y}) scale(${s})`}
    >
      {indication === "active-unacked" && <circle className="kh-alarm-ring" cx={10} cy={priority === 2 ? 11.5 : 10} r={11.5} />}
      {shape}
      <text x={10} y={priority === 2 ? 16 : 14} textAnchor="middle">
        {priority}
      </text>
    </g>
  );
}

/** Padlock, 14 × 16, top-left at (x, y). */
export function LockBadge({ x = 0, y = 0 }: { x?: number; y?: number }) {
  return (
    <g className="kh-badge-lock" aria-hidden="true" transform={`translate(${x} ${y})`}>
      <rect x={1} y={7} width={12} height={8.5} rx={1.5} />
      <path d="M3.8 7 V5 a3.2 3.2 0 0 1 6.4 0 V7" />
    </g>
  );
}

/** A boxed letter (L for local control), 16 × 16, top-left at (x, y). */
export function TagBadge({ text, x = 0, y = 0 }: { text: string; x?: number; y?: number }) {
  return (
    <g className="kh-badge-tag" aria-hidden="true" transform={`translate(${x} ${y})`}>
      <rect x={0.75} y={0.75} width={14.5} height={14.5} rx={2} />
      <text x={8} y={12} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

/** The "?" drawn over a symbol whose state is unknown. */
export function UnknownMark({ x = 0, y = 0, size = 16 }: { x?: number; y?: number; size?: number }) {
  return (
    <text className="kh-sym-unknown-mark" aria-hidden="true" x={x} y={y + size * 0.35} textAnchor="middle" fontSize={size}>
      ?
    </text>
  );
}
