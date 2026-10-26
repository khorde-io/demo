/**
 * Pieces the project faceplates share: a measurement row with its bar, a
 * status row, the list of commands with "Why?" for each, and a short trend.
 */

import type { CommandInterlockState, CommandKey, PointId } from "@khorde/hmi-core";
import {
  AnalogBar,
  AnalogValue,
  CommandButton,
  InterlockPanel,
  TrendChart,
  useI18n,
  useInterlock,
  usePoint,
  useTrend,
  type AnalogBarProps,
} from "@khorde/hmi-react";
import type { ReactNode } from "react";
import { AGENT_OF } from "../plant.ts";

const num = (v: { value: unknown } | undefined) => (typeof v?.value === "number" ? v.value : null);

export interface Range {
  min: number;
  max: number;
  normal?: [number, number];
  limits?: readonly number[];
}

/** One measurement: name, value, and a bar when a range is given. */
export function Measure({ id, decimals = 1, range, setpoint }: { id: PointId; decimals?: number; range?: Range; setpoint?: number | null }) {
  const i18n = useI18n();
  const v = usePoint(id);
  const name = i18n.pointName(id) ?? id;
  const bar: AnalogBarProps | null = range
    ? {
        value: num(v),
        min: range.min,
        max: range.max,
        label: name,
        quality: v?.quality ?? "bad",
        ...(range.normal ? { normal: range.normal } : {}),
        ...(range.limits ? { limits: range.limits } : {}),
        ...(setpoint !== undefined ? { setpoint } : {}),
      }
    : null;
  return (
    <div className="fp-measure">
      <span className="label">{name}</span>
      <AnalogValue value={num(v)} unit={i18n.unit(id) ?? ""} decimals={decimals} quality={v?.quality ?? "bad"} stale={v?.stale ?? false} size="md" />
      {bar && <AnalogBar {...bar} />}
    </div>
  );
}

/** A discrete point by its label: "Trip · Not tripped". `abnormal` values are emphasised. */
export function Status({ id, abnormal = [] }: { id: PointId; abnormal?: readonly number[] }) {
  const i18n = useI18n();
  const v = usePoint(id);
  const ok = v?.quality === "good" && v.value !== null;
  const text = ok ? (i18n.stateLabel(id, v.value) ?? String(v.value)) : "?";
  const bad = ok && typeof v.value === "number" && abnormal.includes(v.value);
  return (
    <div className={`fp-status${bad ? " fp-status--abnormal" : ""}${!ok ? " fp-status--bad" : ""}`}>
      <dt>{i18n.pointName(id) ?? id}</dt>
      <dd>{text}</dd>
    </div>
  );
}

export interface CommandSpec {
  equipment: string;
  name: string;
  /** "Open", "Start", "Raise". */
  verb: string;
  /** For analogical commands. */
  analog?: { min: number; max: number; unit?: string; step?: number; initial?: number };
}

export const commandKey = (c: Pick<CommandSpec, "equipment" | "name">): CommandKey => ({
  agent: AGENT_OF.get(c.equipment) ?? "",
  equipment: c.equipment,
  name: c.name,
});

export const sameCommand = (a: CommandKey | null, b: CommandKey) => !!a && a.equipment === b.equipment && a.name === b.name;

/** A row of command buttons, each showing its interlock state, with its "Why?" link. */
export function CommandButtons({
  commands,
  canOperate,
  explained,
  interlockOf,
  onCommand,
  onExplain,
}: {
  commands: readonly CommandSpec[];
  canOperate: boolean;
  explained: CommandKey | null;
  /** From one `useInterlockStates` call for the whole faceplate. */
  interlockOf: (key: CommandKey) => CommandInterlockState;
  onCommand: (c: CommandSpec) => void;
  onExplain: (key: CommandKey) => void;
}) {
  return (
    <span className="fp-device-actions">
      {commands.map((c) => {
        const key = commandKey(c);
        return (
          <CommandButton
            key={c.name}
            label={`${c.verb}…`}
            interlock={interlockOf(key)}
            disabled={!canOperate}
            onCommand={() => onCommand(c)}
            onExplain={() => onExplain(key)}
            explained={sameCommand(explained, key)}
          />
        );
      })}
    </span>
  );
}

/** The interlock of the command picked with "Why?", or a hint. */
export function Explained({ command, verb }: { command: CommandKey | null; verb: string }) {
  const view = useInterlock(command);
  return command ? <InterlockPanel view={view} command={verb} /> : <p className="note">Pick "Why?" next to a command to see what allows it.</p>;
}

/** A trend of the last minutes. */
export function ShortTrend({ ids, unit, label, minutes = 10, range }: { ids: PointId[]; unit: string; label: string; minutes?: number; range?: { min: number; max: number } }) {
  const i18n = useI18n();
  const t = useTrend(ids, "analogical", minutes * 60e3, (id) => i18n.pointName(id) ?? id);
  return (
    <TrendChart
      series={t.series}
      from={t.from}
      to={t.to}
      unit={unit}
      label={`${label}, last ${minutes} min`}
      width={560}
      height={220}
      message={t.status === "loading" ? i18n.t("trend.loading") : t.status === "error" ? i18n.t("trend.failed") : null}
      {...(range ? { min: range.min, max: range.max } : {})}
    />
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="fp-section">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}
