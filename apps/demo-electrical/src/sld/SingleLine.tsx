/**
 * The substation single-line, drawn by hand on a 1800 × 1080 grid: the 138 kV
 * line at the top, both transformers, buses A and B with the coupler between
 * them, and the feeder, aux and spare bays below. Positions and energization
 * are live; every switching device and transformer opens its faceplate.
 */

import { pointId, sides, type Energized } from "@khorde/hmi-core";
import type { Bay } from "@khorde/demo-plant";
import {
  BoundBreaker,
  BoundDisconnector,
  BoundEarthingSwitch,
  Busbar,
  Line,
  Load,
  Transformer2W,
  useEnergization,
  useI18n,
  usePoint,
  type SymbolAlarm,
} from "@khorde/hmi-react";
import { bayById, plant, turbinesOf } from "../plant.ts";
import { useEquipmentAlarms } from "../useEquipmentAlarm.ts";
import { SvgValue } from "./SvgValue.tsx";
import { buildNetwork, mid, out } from "./topology.ts";

export const SLD_WIDTH = 1800;
export const SLD_HEIGHT = 1080;

const Y = {
  grid: 40,
  lineEs: 90,
  lineDs: 110,
  lineCb: 190,
  hvBus: 260,
  trDs: 322,
  trCb: 402,
  tr: 500,
  incCb: 598,
  incDs: 678,
  mvBus: 750,
  coupler: 830,
  bayDs: 812,
  bayCb: 892,
  bayEnd: 1010,
} as const;

const BAY_X: Record<string, number> = {
  "vds.sub.hv.l1": 900,
  "vds.sub.hv.tr1": 540,
  "vds.sub.hv.tr2": 1260,
  "vds.sub.mv.a.tr1": 540,
  "vds.sub.mv.b.tr2": 1260,
  "vds.sub.mv.a.f1": 200,
  "vds.sub.mv.a.f2": 360,
  "vds.sub.mv.a.aux": 700,
  "vds.sub.mv.b.f3": 1100,
  "vds.sub.mv.b.f4": 1420,
  "vds.sub.mv.b.spare": 1580,
};

const BUS_SPAN = {
  "vds.sub.hv.bus": [420, 1380],
  "vds.sub.mv.a": [120, 820],
  "vds.sub.mv.b": [980, 1680],
} as const;

const network = buildNetwork(plant);

export interface SingleLineProps {
  /** Equipment whose faceplate is open, highlighted in the drawing. */
  selected: string | null;
  onOpen: (equipment: string) => void;
}

interface Ctx {
  e: (node: string) => Energized;
  alarm: (equipment: string) => SymbolAlarm | null;
  name: (equipment: string) => string;
  selected: string | null;
  onOpen: (equipment: string) => void;
}

function Device({ ctx, device, kind, x, y, between, rotate }: { ctx: Ctx; device: string; kind: "cb" | "ds" | "es"; x: number; y: number; between?: [string, string] | undefined; rotate?: number }) {
  const pos = pointId(device, "pos");
  const common = {
    x,
    y,
    label: ctx.name(device),
    alarm: ctx.alarm(device),
    selected: ctx.selected === device,
    onActivate: () => ctx.onOpen(device),
    ...(rotate !== undefined ? { rotate } : {}),
  };
  const live = between ? { liveIn: ctx.e(between[0]), liveOut: ctx.e(between[1]) } : {};
  if (kind === "cb") return <BoundBreaker pos={pos} remoteLocal={pointId(device, "remote_local")} {...live} {...common} />;
  if (kind === "ds") return <BoundDisconnector pos={pos} {...live} {...common} />;
  return <BoundEarthingSwitch pos={pos} {...common} />;
}

const W = ({ ctx, node, pts }: { ctx: Ctx; node: string; pts: [number, number][] }) => <Line points={pts} energized={ctx.e(node)} />;

function BusLabel({ id, x, y, anchor = "start" }: { id: keyof typeof BUS_SPAN; x: number; y: number; anchor?: "start" | "end" }) {
  const i18n = useI18n();
  return (
    <>
      <text className="sld-label" x={x} y={y} textAnchor={anchor}>
        {i18n.equipmentName(id)}
      </text>
      <SvgValue id={pointId(id, "v_kv")} x={x} y={y + 18} decimals={id === "vds.sub.hv.bus" ? 1 : 2} anchor={anchor} />
    </>
  );
}

function LineBay({ ctx, bay }: { ctx: Ctx; bay: Bay }) {
  const x = BAY_X[bay.id] as number;
  const id = (n: string) => pointId(bay.id, n);
  return (
    <g>
      <text className="sld-label sld-label--strong" x={x} y={Y.grid - 14} textAnchor="middle">
        Grid · 138 kV line L1
      </text>
      <W ctx={ctx} node={out(bay)} pts={[[x, Y.grid], [x, Y.lineDs - 32]]} />
      <W ctx={ctx} node={out(bay)} pts={[[x, 58], [x + 70, 58], [x + 70, Y.lineEs - 28]]} />
      <Device ctx={ctx} device={bay.es as string} kind="es" x={x + 70} y={Y.lineEs} />
      <Device ctx={ctx} device={bay.ds} kind="ds" x={x} y={Y.lineDs} between={sides(network, bay.ds)} />
      <W ctx={ctx} node={mid(bay)} pts={[[x, Y.lineDs + 32], [x, Y.lineCb - 32]]} />
      <Device ctx={ctx} device={bay.cb} kind="cb" x={x} y={Y.lineCb} between={sides(network, bay.cb)} />
      <W ctx={ctx} node="vds.sub.hv.bus" pts={[[x, Y.lineCb + 32], [x, Y.hvBus]]} />
      <SvgValue id={id("v_kv")} x={x - 34} y={Y.lineDs - 4} anchor="end" />
      <SvgValue id={id("f_hz")} x={x - 34} y={Y.lineDs + 14} decimals={2} anchor="end" />
      <SvgValue id={id("p_mw")} x={x - 34} y={Y.lineCb - 8} decimals={1} anchor="end" />
      <SvgValue id={id("q_mvar")} x={x - 34} y={Y.lineCb + 10} decimals={1} anchor="end" />
      <SvgValue id={id("i_a")} x={x - 34} y={Y.lineCb + 28} decimals={0} anchor="end" />
    </g>
  );
}

function TransformerColumn({ ctx, tr }: { ctx: Ctx; tr: (typeof plant.transformers)[number] }) {
  const i18n = useI18n();
  const hv = bayById.get(tr.hvBay) as Bay;
  const lv = bayById.get(tr.lvBay) as Bay;
  const x = BAY_X[hv.id] as number;
  const tap = usePoint(pointId(tr.id, "tap"));
  const lvBus = lv.bus === "a" ? "vds.sub.mv.a" : "vds.sub.mv.b";
  return (
    <g>
      <W ctx={ctx} node="vds.sub.hv.bus" pts={[[x, Y.hvBus], [x, Y.trDs - 32]]} />
      <Device ctx={ctx} device={hv.ds} kind="ds" x={x} y={Y.trDs} between={sides(network, hv.ds)} />
      <W ctx={ctx} node={mid(hv)} pts={[[x, Y.trDs + 32], [x, Y.trCb - 32]]} />
      <Device ctx={ctx} device={hv.cb} kind="cb" x={x} y={Y.trCb} between={sides(network, hv.cb)} />
      <W ctx={ctx} node={out(hv)} pts={[[x, Y.trCb + 32], [x, Y.tr - 48]]} />
      <SvgValue id={pointId(hv.id, "i_a")} x={x - 34} y={Y.trCb + 4} decimals={0} anchor="end" />

      <Transformer2W
        x={x}
        y={Y.tr}
        hvLive={ctx.e(out(hv))}
        lvLive={ctx.e(out(lv))}
        tap={tap?.quality === "good" && typeof tap.value === "number" ? tap.value : null}
        label={i18n.equipmentName(tr.id)}
        alarm={ctx.alarm(tr.id)}
        selected={ctx.selected === tr.id}
        onActivate={() => ctx.onOpen(tr.id)}
      />
      <text className="sld-label sld-label--strong" x={x - 40} y={Y.tr - 4} textAnchor="end">
        {tr.label}
      </text>
      <text className="sld-label" x={x - 40} y={Y.tr + 14} textAnchor="end">
        {tr.ratedMva} MVA
      </text>
      <SvgValue id={pointId(tr.id, "oil_temp")} x={x + 32} y={Y.tr + 24} prefix="Oil" />

      <W ctx={ctx} node={out(lv)} pts={[[x, Y.tr + 48], [x, Y.incCb - 32]]} />
      <Device ctx={ctx} device={lv.cb} kind="cb" x={x} y={Y.incCb} between={sides(network, lv.cb)} />
      <W ctx={ctx} node={mid(lv)} pts={[[x, Y.incCb + 32], [x, Y.incDs - 32]]} />
      <Device ctx={ctx} device={lv.ds} kind="ds" x={x} y={Y.incDs} between={sides(network, lv.ds)} />
      <W ctx={ctx} node={lvBus} pts={[[x, Y.incDs + 32], [x, Y.mvBus]]} />
      <SvgValue id={pointId(lv.id, "p_mw")} x={x - 34} y={Y.incCb - 4} decimals={1} anchor="end" />
      <SvgValue id={pointId(lv.id, "i_a")} x={x - 34} y={Y.incCb + 14} decimals={0} anchor="end" />
    </g>
  );
}

function LowerBay({ ctx, bay }: { ctx: Ctx; bay: Bay }) {
  const i18n = useI18n();
  const x = BAY_X[bay.id] as number;
  const bus = bay.bus === "a" ? "vds.sub.mv.a" : "vds.sub.mv.b";
  const turbines = bay.kind === "feeder" ? turbinesOf(bay.id) : [];
  const caption =
    bay.kind === "feeder"
      ? `${i18n.equipmentName(bay.id)} · ${turbines[0]?.label ?? ""}–${turbines.at(-1)?.label.replace(/^WTG /, "") ?? ""}`
      : bay.kind === "aux"
        ? "Aux 0.38 kV"
        : "Spare";
  return (
    <g>
      <W ctx={ctx} node={bus} pts={[[x, Y.mvBus], [x, Y.bayDs - 32]]} />
      <Device ctx={ctx} device={bay.ds} kind="ds" x={x} y={Y.bayDs} between={sides(network, bay.ds)} />
      <W ctx={ctx} node={mid(bay)} pts={[[x, Y.bayDs + 32], [x, Y.bayCb - 32]]} />
      <Device ctx={ctx} device={bay.cb} kind="cb" x={x} y={Y.bayCb} between={sides(network, bay.cb)} />
      {bay.kind === "feeder" && (
        <>
          <W ctx={ctx} node={out(bay)} pts={[[x, Y.bayCb + 32], [x, Y.bayEnd]]} />
          <W ctx={ctx} node={out(bay)} pts={[[x, 950], [x + 44, 950], [x + 44, 954]]} />
          <Device ctx={ctx} device={bay.es as string} kind="es" x={x + 44} y={982} />
          <path className="sld-fan" d={`M${x - 18} ${Y.bayEnd + 8} L${x} ${Y.bayEnd} L${x + 18} ${Y.bayEnd + 8}`} />
        </>
      )}
      {bay.kind === "aux" && (
        <>
          <W ctx={ctx} node={out(bay)} pts={[[x, Y.bayCb + 32], [x, 940]]} />
          <Load x={x} y={960} energized={ctx.e(out(bay))} label="Auxiliary supply" />
        </>
      )}
      {bay.kind === "spare" && <W ctx={ctx} node={out(bay)} pts={[[x, Y.bayCb + 32], [x, 950]]} />}
      {bay.kind !== "spare" && (
        <>
          <SvgValue id={pointId(bay.id, "p_mw")} x={x - 30} y={Y.bayCb - 4} decimals={1} anchor="end" />
          <SvgValue id={pointId(bay.id, "i_a")} x={x - 30} y={Y.bayCb + 14} decimals={0} anchor="end" />
        </>
      )}
      <text className="sld-label sld-label--strong" x={x} y={1040} textAnchor="middle">
        {caption}
      </text>
    </g>
  );
}

function Coupler({ ctx, bay }: { ctx: Ctx; bay: Bay }) {
  const y = Y.coupler;
  return (
    <g>
      <W ctx={ctx} node="vds.sub.mv.a" pts={[[800, Y.mvBus], [800, y], [804, y]]} />
      <Device ctx={ctx} device={bay.ds} kind="ds" x={836} y={y} rotate={-90} between={sides(network, bay.ds)} />
      <Device ctx={ctx} device={bay.cb} kind="cb" x={900} y={y} rotate={-90} between={sides(network, bay.cb)} />
      <Device ctx={ctx} device={bay.dsB as string} kind="ds" x={964} y={y} rotate={-90} between={sides(network, bay.dsB as string)} />
      <W ctx={ctx} node="vds.sub.mv.b" pts={[[996, y], [1000, y], [1000, Y.mvBus]]} />
      <text className="sld-label sld-label--strong" x={900} y={y + 56} textAnchor="middle">
        Bus coupler
      </text>
      <SvgValue id={pointId(bay.id, "p_mw")} x={900} y={y + 74} decimals={1} anchor="middle" />
    </g>
  );
}

export function SingleLine({ selected, onOpen }: SingleLineProps) {
  const i18n = useI18n();
  const energized = useEnergization(network);
  const alarm = useEquipmentAlarms();
  const ctx: Ctx = {
    e: energized,
    alarm,
    name: (eq) => i18n.equipmentName(eq),
    selected,
    onOpen,
  };
  const bays = plant.bays;
  const lower = bays.filter((b) => b.kind === "feeder" || b.kind === "aux" || b.kind === "spare");
  return (
    <svg className="sld" viewBox={`0 0 ${SLD_WIDTH} ${SLD_HEIGHT}`} role="group" aria-label="Substation single-line diagram">
      {(Object.keys(BUS_SPAN) as (keyof typeof BUS_SPAN)[]).map((id) => (
        <Busbar key={id} points={[[BUS_SPAN[id][0], id === "vds.sub.hv.bus" ? Y.hvBus : Y.mvBus], [BUS_SPAN[id][1], id === "vds.sub.hv.bus" ? Y.hvBus : Y.mvBus]]} energized={ctx.e(id)} label={i18n.equipmentName(id)} />
      ))}
      <BusLabel id="vds.sub.hv.bus" x={420} y={Y.hvBus - 32} />
      <BusLabel id="vds.sub.mv.a" x={120} y={Y.mvBus - 32} />
      <BusLabel id="vds.sub.mv.b" x={1680} y={Y.mvBus - 32} anchor="end" />
      {bays.filter((b) => b.kind === "line").map((b) => <LineBay key={b.id} ctx={ctx} bay={b} />)}
      {plant.transformers.map((tr) => <TransformerColumn key={tr.id} ctx={ctx} tr={tr} />)}
      {bays.filter((b) => b.kind === "coupler").map((b) => <Coupler key={b.id} ctx={ctx} bay={b} />)}
      {lower.map((b) => <LowerBay key={b.id} ctx={ctx} bay={b} />)}
    </svg>
  );
}
