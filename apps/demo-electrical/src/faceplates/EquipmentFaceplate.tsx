/**
 * The faceplate for whatever is in focus: a bay (with its switching devices),
 * a transformer or a turbine. Built on the library's `Faceplate` frame and
 * `CommandDialog`; this file only decides what each one shows.
 */

import { pointId, type CommandKey, type PointId } from "@khorde/hmi-core";
import { RATED_KW, type Bay } from "@khorde/demo-plant";
import {
  BoundBreaker,
  BoundDisconnector,
  BoundEarthingSwitch,
  CommandDialog,
  Faceplate,
  SymbolSvg,
  useHmi,
  useI18n,
  useInterlockStates,
  usePoint,
  type FaceplateTab,
} from "@khorde/hmi-react";
import { useState } from "react";
import type { Focus } from "../navigation.ts";
import { bayById, plant } from "../plant.ts";
import { CommandButtons, Explained, Measure, Section, ShortTrend, Status, commandKey, type CommandSpec, type Range } from "./parts.tsx";
import { PowerCurve } from "./PowerCurve.tsx";

interface Dialog {
  spec: CommandSpec;
  title: string;
}

/** Ranges for the bars, by bay kind. */
function bayRanges(bay: Bay): Partial<Record<string, Range>> {
  const kv = bay.bus === "hv" ? 138 : 34.5;
  const v: Range = { min: kv * 0.8, max: kv * 1.2, normal: [kv * 0.95, kv * 1.05], limits: [kv * 0.9, kv * 1.1] };
  switch (bay.kind) {
    case "line":
      return { p_mw: { min: 0, max: 120 }, i_a: { min: 0, max: 600 }, v_kv: v, f_hz: { min: 59, max: 61, normal: [59.8, 60.2], limits: [59.5, 60.5] } };
    case "incomer":
      return { p_mw: { min: 0, max: 60, normal: [0, 54] }, i_a: { min: 0, max: 1200 } };
    case "coupler":
      return { p_mw: { min: -60, max: 60 }, i_a: { min: 0, max: 1200 } };
    case "aux":
      return { p_mw: { min: 0, max: 1 }, i_a: { min: 0, max: 30 } };
    default:
      return { p_mw: { min: 0, max: 30, normal: [0, 27] }, i_a: { min: 0, max: 600 }, v_kv: v };
  }
}

const BAY_MEASURES = ["p_mw", "q_mvar", "i_a", "v_kv", "f_hz"] as const;
const DECIMALS: Record<string, number> = { p_mw: 2, q_mvar: 2, i_a: 0, v_kv: 2, f_hz: 3 };

function devicesOf(bay: Bay) {
  return [
    { equipment: bay.cb, kind: "cb" as const },
    { equipment: bay.ds, kind: "ds" as const },
    ...(bay.dsB ? [{ equipment: bay.dsB, kind: "ds" as const }] : []),
    ...(bay.es ? [{ equipment: bay.es, kind: "es" as const }] : []),
  ];
}

function DeviceSymbol({ equipment, kind }: { equipment: string; kind: "cb" | "ds" | "es" }) {
  const pos = pointId(equipment, "pos");
  return (
    <SymbolSvg width={56} height={68}>
      {kind === "cb" ? <BoundBreaker pos={pos} remoteLocal={pointId(equipment, "remote_local")} /> : kind === "ds" ? <BoundDisconnector pos={pos} /> : <BoundEarthingSwitch pos={pos} />}
    </SymbolSvg>
  );
}

function useCommandState(initial: CommandKey | null) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [explained, setExplained] = useState<CommandKey | null>(initial);
  return { dialog, setDialog, explained, setExplained };
}

type Commands = ReturnType<typeof useCommandState>;

function BayControl({ bay, device, cmd }: { bay: Bay; device: string | null; cmd: Commands }) {
  const i18n = useI18n();
  const canOperate = useHmi().auth?.can("operate") ?? false;
  const devices = devicesOf(bay);
  const explainedVerb = cmd.explained?.name.endsWith("open") ? "Open" : "Close";
  const commandsOf = (equipment: string): CommandSpec[] => [
    { equipment, name: "pos.open", verb: "Open" },
    { equipment, name: "pos.close", verb: "Close" },
  ];
  // One watcher, and one hub query, for every command on the faceplate.
  const interlockOf = useInterlockStates(devices.flatMap((d) => commandsOf(d.equipment)).map(commandKey));
  return (
    <>
      <ul className="fp-devices">
        {devices.map((d) => {
          const name = i18n.equipmentName(d.equipment);
          const commands = commandsOf(d.equipment);
          return (
            <li key={d.equipment} className={device === d.equipment ? "fp-device--focus" : undefined}>
              <DeviceSymbol equipment={d.equipment} kind={d.kind} />
              <span className="fp-device-name">
                <strong>{name}</strong>
                <span className="mono label">{d.equipment}</span>
              </span>
              <CommandButtons
                commands={commands}
                canOperate={canOperate}
                explained={cmd.explained}
                interlockOf={interlockOf}
                onCommand={(c) => cmd.setDialog({ spec: c, title: `${c.verb} ${name}` })}
                onExplain={cmd.setExplained}
              />
            </li>
          );
        })}
      </ul>
      <Explained command={cmd.explained} verb={explainedVerb} />
    </>
  );
}

function BayOverview({ bay }: { bay: Bay }) {
  const ranges = bayRanges(bay);
  const present = new Set(plant.points.filter((p) => p.equipment === bay.id).map((p) => p.name));
  return (
    <>
      <div className="fp-values">
        {BAY_MEASURES.filter((m) => present.has(m)).map((m) => {
          const range = ranges[m];
          return <Measure key={m} id={pointId(bay.id, m)} decimals={DECIMALS[m] ?? 1} {...(range ? { range } : {})} />;
        })}
      </div>
      <Section title="Breaker">
        <dl className="fp-statuses">
          <Status id={pointId(bay.cb, "pos")} abnormal={[2, 3]} />
          <Status id={pointId(bay.cb, "remote_local")} abnormal={[0]} />
          <Status id={pointId(bay.cb, "trip")} abnormal={[1]} />
          <Status id={pointId(bay.cb, "sf6_low")} abnormal={[1]} />
        </dl>
      </Section>
    </>
  );
}

function TransformerOverview({ id }: { id: string }) {
  const tr = plant.transformers.find((t) => t.id === id);
  if (!tr) return null;
  return (
    <>
      <div className="fp-values">
        <Measure id={pointId(tr.id, "oil_temp")} range={{ min: 20, max: 110, normal: [20, 75], limits: [75, 90] }} />
        <Measure id={pointId(tr.id, "wdg_temp")} range={{ min: 20, max: 130, normal: [20, 95], limits: [95, 110] }} />
        <Measure id={pointId(tr.lvBay, "p_mw")} decimals={2} range={{ min: 0, max: tr.ratedMva, normal: [0, tr.ratedMva * 0.9] }} />
        <Measure id={pointId(tr.lvBay, "q_mvar")} decimals={2} />
      </div>
      <Section title="Tap changer and protection">
        <dl className="fp-statuses">
          <Status id={pointId(tr.id, "tap")} />
          <Status id={pointId(tr.id, "buchholz")} abnormal={[1]} />
          <Status id={pointId(tr.id, "prv")} abnormal={[1]} />
        </dl>
      </Section>
    </>
  );
}

function TransformerControl({ id, cmd }: { id: string; cmd: Commands }) {
  const i18n = useI18n();
  const canOperate = useHmi().auth?.can("operate") ?? false;
  const name = i18n.equipmentName(id);
  const commands: CommandSpec[] = [
    { equipment: id, name: "tap.raise", verb: "Raise" },
    { equipment: id, name: "tap.lower", verb: "Lower" },
  ];
  const interlockOf = useInterlockStates(commands.map(commandKey));
  return (
    <>
      <div className="fp-row">
        <span className="label">Tap position</span>
        <TapValue id={pointId(id, "tap")} />
        <CommandButtons
          commands={commands}
          canOperate={canOperate}
          explained={cmd.explained}
          interlockOf={interlockOf}
          onCommand={(c) => cmd.setDialog({ spec: c, title: `${c.verb} the ${name.split(" ·")[0]} tap` })}
          onExplain={cmd.setExplained}
        />
      </div>
      <Explained command={cmd.explained} verb={cmd.explained?.name === "tap.lower" ? "Lower" : "Raise"} />
    </>
  );
}

function TapValue({ id }: { id: PointId }) {
  const v = usePoint(id);
  return <strong className="fp-big num">{v?.quality === "good" ? String(v.value) : "?"}</strong>;
}

const TURBINE_COMMANDS = (id: string): CommandSpec[] => [
  { equipment: id, name: "start", verb: "Start" },
  { equipment: id, name: "stop", verb: "Stop" },
  { equipment: id, name: "reset", verb: "Reset" },
];

function TurbineOverview({ id }: { id: string }) {
  const sp = usePoint(pointId(id, "curtail_sp"));
  const p = usePoint(pointId(id, "p_kw"));
  const wind = usePoint(pointId(id, "wind_ms"));
  const good = (v: typeof p) => (v?.quality === "good" && typeof v.value === "number" ? v.value : null);
  return (
    <>
      <dl className="fp-statuses">
        <Status id={pointId(id, "state")} abnormal={[3]} />
        <Status id={pointId(id, "avail")} abnormal={[0]} />
        <Status id={pointId(id, "comm")} abnormal={[0]} />
        <Status id={pointId(id, "fault_code")} />
      </dl>
      <div className="fp-values">
        <Measure id={pointId(id, "p_kw")} decimals={0} range={{ min: 0, max: RATED_KW }} setpoint={good(sp) !== null && (good(sp) as number) < RATED_KW ? good(sp) : null} />
        <Measure id={pointId(id, "wind_ms")} range={{ min: 0, max: 25, normal: [3, 25] }} />
      </div>
      <PowerCurve windMs={good(wind)} powerKw={good(p)} setpointKw={good(sp)} />
      <div className="fp-values fp-values--3">
        <Measure id={pointId(id, "rotor_rpm")} />
        <Measure id={pointId(id, "pitch_deg")} />
        <Measure id={pointId(id, "yaw_deg")} decimals={0} />
        <Measure id={pointId(id, "gen_temp")} range={{ min: 20, max: 160, normal: [20, 130], limits: [130, 150] }} />
        <Measure id={pointId(id, "gbx_temp")} range={{ min: 20, max: 100, normal: [20, 80], limits: [80] }} />
        <Measure id={pointId(id, "wind_dir")} decimals={0} />
      </div>
    </>
  );
}

function TurbineControl({ id, cmd }: { id: string; cmd: Commands }) {
  const i18n = useI18n();
  const canOperate = useHmi().auth?.can("operate") ?? false;
  const name = i18n.equipmentName(id);
  const sp = usePoint(pointId(id, "curtail_sp"));
  const current = typeof sp?.value === "number" ? sp.value : RATED_KW;
  const curtail: CommandSpec = { equipment: id, name: "curtail.setpoint", verb: "Set", analog: { min: 0, max: RATED_KW, unit: "kW", step: 100, initial: current } };
  const verbOf = (key: CommandKey | null) => TURBINE_COMMANDS(id).find((c) => c.name === key?.name)?.verb ?? "Set";
  const interlockOf = useInterlockStates(TURBINE_COMMANDS(id).map(commandKey));
  return (
    <>
      <div className="fp-row">
        <span className="label">Operation</span>
        <CommandButtons commands={TURBINE_COMMANDS(id)} canOperate={canOperate} explained={cmd.explained} interlockOf={interlockOf} onCommand={(c) => cmd.setDialog({ spec: c, title: `${c.verb} ${name}` })} onExplain={cmd.setExplained} />
      </div>
      <div className="fp-row">
        <span className="label">Curtailment setpoint</span>
        <Measure id={pointId(id, "curtail_sp")} decimals={0} />
        <button type="button" className="kh-btn kh-btn--sm" disabled={!canOperate} onClick={() => cmd.setDialog({ spec: curtail, title: `Curtail ${name}` })}>
          Change…
        </button>
      </div>
      <Explained command={cmd.explained} verb={verbOf(cmd.explained)} />
    </>
  );
}

interface Content {
  eyebrow: string;
  title: string;
  subtitle: string;
  tabs: FaceplateTab[];
}

function content(focus: Focus, i18n: ReturnType<typeof useI18n>, cmd: Commands): Content {
  if (focus.kind === "turbine") {
    const t = plant.turbines.find((x) => x.id === focus.id);
    return {
      eyebrow: `Wind turbine · ${i18n.equipmentName(t?.feeder ?? "")}`,
      title: i18n.equipmentName(focus.id),
      subtitle: focus.id,
      tabs: [
        { id: "overview", label: "Overview", content: <TurbineOverview id={focus.id} /> },
        { id: "control", label: "Control", content: <TurbineControl id={focus.id} cmd={cmd} /> },
        {
          id: "trend",
          label: "Trend",
          content: (
            <>
              <ShortTrend ids={[pointId(focus.id, "p_kw")]} unit="kW" label="Active power" range={{ min: 0, max: RATED_KW }} />
              <ShortTrend ids={[pointId(focus.id, "wind_ms")]} unit="m/s" label="Wind speed" />
            </>
          ),
        },
      ],
    };
  }
  if (focus.kind === "transformer") {
    return {
      eyebrow: "Power transformer",
      title: i18n.equipmentName(focus.id),
      subtitle: focus.id,
      tabs: [
        { id: "overview", label: "Overview", content: <TransformerOverview id={focus.id} /> },
        { id: "control", label: "Control", content: <TransformerControl id={focus.id} cmd={cmd} /> },
        { id: "trend", label: "Trend", content: <ShortTrend ids={[pointId(focus.id, "oil_temp"), pointId(focus.id, "wdg_temp")]} unit="°C" label="Temperatures" /> },
      ],
    };
  }
  const bay = bayById.get(focus.id) as Bay;
  const trendPoint = plant.points.some((p) => p.equipment === bay.id && p.name === "p_mw") ? "p_mw" : "i_a";
  return {
    eyebrow: `${bay.kind === "line" ? "Line bay" : bay.kind === "coupler" ? "Coupler bay" : bay.kind === "trHv" ? "Transformer bay" : bay.kind === "incomer" ? "Incomer bay" : "Feeder bay"} · ${bay.bus === "hv" ? "138 kV" : `34.5 kV bus ${bay.bus.toUpperCase()}`}`,
    title: i18n.equipmentName(bay.id),
    subtitle: bay.id,
    tabs: [
      { id: "overview", label: "Overview", content: <BayOverview bay={bay} /> },
      { id: "control", label: "Control", content: <BayControl bay={bay} device={focus.device} cmd={cmd} /> },
      { id: "trend", label: "Trend", content: <ShortTrend ids={[pointId(bay.id, trendPoint)]} unit={trendPoint === "p_mw" ? "MW" : "A"} label={i18n.pointName(pointId(bay.id, trendPoint)) ?? trendPoint} /> },
    ],
  };
}

export function EquipmentFaceplate({ focus, onClose }: { focus: Focus; onClose: () => void }) {
  const i18n = useI18n();
  // A device in focus opens on its controls; anything else on the overview.
  const [tab, setTab] = useState(focus.kind === "bay" && focus.device ? "control" : "overview");
  const cmd = useCommandState(null);
  const c = content(focus, i18n, cmd);
  return (
    <>
      <Faceplate eyebrow={c.eyebrow} title={c.title} subtitle={c.subtitle} tabs={c.tabs} activeTab={tab} onTabChange={setTab} onClose={onClose} />
      {cmd.dialog && (
        <CommandDialog
          command={commandKey(cmd.dialog.spec)}
          title={cmd.dialog.title}
          verb={cmd.dialog.spec.verb.toLowerCase()}
          {...(cmd.dialog.spec.analog ? { analog: cmd.dialog.spec.analog } : {})}
          onClose={() => cmd.setDialog(null)}
        />
      )}
    </>
  );
}
