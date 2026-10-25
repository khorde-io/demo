/**
 * L1: the site at a glance, with no control. What the plant exports against
 * what it could, the grid connection, the wind, alarms by area, and the day's
 * production. Each panel leads to the screen that explains it.
 */

import { matchPath, pointId, type AlarmPriority, type PointId } from "@khorde/hmi-core";
import { RATED_KW } from "@khorde/demo-plant";
import { powerCurve } from "@khorde/demo-plant/sim";
import {
  AlarmIndicator,
  AnalogBar,
  BoundBreaker,
  SymbolSvg,
  TrendChart,
  WindIndicator,
  turbineStateOf,
  useAlarms,
  useI18n,
  usePointValues,
  useTrend,
  type TurbineState,
} from "@khorde/hmi-react";
import type { ReactNode } from "react";
import type { PageId } from "../navigation.ts";
import { plant, turbinesOf } from "../plant.ts";

const LINE = "vds.sub.hv.l1";
const FEEDERS = plant.bays.filter((b) => b.kind === "feeder");
const POINTS: PointId[] = [
  ...plant.turbines.flatMap((t) => (["state", "p_kw", "wind_ms", "avail"] as const).map((n) => pointId(t.id, n))),
  ...FEEDERS.map((f) => pointId(f.id, "p_mw")),
  ...plant.transformers.flatMap((t) => [pointId(t.lvBay, "p_mw"), pointId(t.id, "oil_temp")]),
  ...(["p_mw", "q_mvar", "v_kv", "f_hz"] as const).map((n) => pointId(LINE, n)),
  "vds.wf.met::wind_ms",
  "vds.wf.met::wind_dir",
];

const AREAS = [
  { label: "Substation", patterns: ["vds.sub.>"] },
  ...FEEDERS.map((_, i) => ({ label: `Turbines F${i + 1}`, patterns: [`vds.wf.f${i + 1}`, `vds.wf.f${i + 1}.>`] })),
];

const STATES: TurbineState[] = ["producing", "curtailed", "waiting", "stopped", "fault", "unknown"];

function Kpi({ label, value, unit, note, onClick }: { label: string; value: string; unit: string; note?: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="eyebrow">{label}</span>
      <span className="kpi-value num">
        {value} <span className="kpi-unit">{unit}</span>
      </span>
      {note && <span className="note">{note}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="kpi" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="kpi">{body}</div>
  );
}

function ProductionTrend() {
  const i18n = useI18n();
  const t = useTrend([pointId(LINE, "p_mw")], "analogical", 24 * 3600e3, () => "Export to grid");
  return (
    <TrendChart
      series={t.series}
      from={t.from}
      to={t.to}
      unit="MW"
      min={0}
      max={120}
      label="Export to grid, last 24 h"
      width={1800}
      height={240}
      message={t.status === "loading" ? i18n.t("trend.loading") : t.status === "error" ? i18n.t("trend.failed") : null}
    />
  );
}

export function OverviewScreen({ onNavigate }: { onNavigate: (page: PageId, focus?: string) => void }) {
  const i18n = useI18n();
  const values = usePointValues(POINTS);
  const { alarms } = useAlarms();
  const n = (id: PointId) => {
    const v = values.get(id);
    return v?.quality === "good" && typeof v.value === "number" ? v.value : null;
  };
  const fmt = (x: number | null, d = 1) => (x === null ? "?" : i18n.formatNumber(x, { minimumFractionDigits: d, maximumFractionDigits: d }));

  let producedKw = 0;
  let possibleKw = 0;
  let available = 0;
  const byState = new Map<TurbineState, number>();
  for (const t of plant.turbines) {
    const state = turbineStateOf(values.get(pointId(t.id, "state")));
    byState.set(state, (byState.get(state) ?? 0) + 1);
    producedKw += n(pointId(t.id, "p_kw")) ?? 0;
    if (n(pointId(t.id, "avail")) === 1) {
      available++;
      possibleKw += powerCurve(n(pointId(t.id, "wind_ms")) ?? 0);
    }
  }
  const installedMw = (plant.turbines.length * RATED_KW) / 1000;
  const lostMw = Math.max(0, possibleKw - producedKw) / 1000;

  const counts = AREAS.map((area) => {
    const byP: Record<AlarmPriority, { total: number; unacked: number }> = { 1: { total: 0, unacked: 0 }, 2: { total: 0, unacked: 0 }, 3: { total: 0, unacked: 0 } };
    for (const a of alarms) {
      if (!area.patterns.some((p) => matchPath(p, a.area))) continue;
      byP[a.priority].total++;
      if (!a.acked) byP[a.priority].unacked++;
    }
    return { area, byP };
  });

  return (
    <div className="overview">
      <section className="kpis" aria-label="Production">
        <Kpi label="Export to grid" value={fmt(n(pointId(LINE, "p_mw")))} unit="MW" note={`of ${fmt(installedMw, 0)} MW installed`} onClick={() => onNavigate("substation", LINE)} />
        <Kpi label="Turbine production" value={fmt(producedKw / 1000)} unit="MW" note={`${fmt(possibleKw / 1000)} MW possible in this wind`} onClick={() => onNavigate("windfarm")} />
        <Kpi label="Lost production" value={fmt(lostMw)} unit="MW" note="curtailment, stops and faults" onClick={() => onNavigate("windfarm")} />
        <Kpi label="Available" value={`${available}`} unit={`of ${plant.turbines.length} WTG`} note={`${fmt((available * RATED_KW) / 1000, 0)} MW available capacity`} onClick={() => onNavigate("windfarm")} />
      </section>

      <section className="page-panel ov-grid" aria-label="Grid connection">
        <h2 className="eyebrow">Grid connection · line L1</h2>
        <div className="ov-grid-body">
          <button type="button" className="ov-symbol" onClick={() => onNavigate("substation", `${LINE}.cb`)}>
            <SymbolSvg width={56} height={68}>
              <BoundBreaker pos={pointId(`${LINE}.cb`, "pos")} remoteLocal={pointId(`${LINE}.cb`, "remote_local")} label={i18n.equipmentName(`${LINE}.cb`)} />
            </SymbolSvg>
            <span className="kh-sr-only">, open the line bay</span>
          </button>
          <dl className="detail-facts">
            <dt>Voltage</dt>
            <dd className="num">{fmt(n(pointId(LINE, "v_kv")))} kV</dd>
            <dt>Frequency</dt>
            <dd className="num">{fmt(n(pointId(LINE, "f_hz")), 3)} Hz</dd>
            <dt>Reactive power</dt>
            <dd className="num">{fmt(n(pointId(LINE, "q_mvar")))} Mvar</dd>
          </dl>
        </div>
      </section>

      <section className="page-panel ov-wind" aria-label="Wind">
        <h2 className="eyebrow">Wind · met mast</h2>
        <div className="ov-grid-body">
          <WindIndicator speed={n("vds.wf.met::wind_ms")} direction={n("vds.wf.met::wind_dir")} size={88} label="Met mast wind" />
          <span className="kpi-value num">
            {fmt(n("vds.wf.met::wind_ms"))} <span className="kpi-unit">m/s</span>
          </span>
        </div>
      </section>

      <section className="page-panel ov-states" aria-label="Turbine states">
        <h2 className="eyebrow">Turbines</h2>
        <ul className="ov-state-list">
          {STATES.map((s) => (
            <li key={s}>
              <span className={`ov-state-swatch kh-tile--${s}`} aria-hidden="true" />
              <span>{i18n.t(`symbol.turbine.${s}`)}</span>
              <strong className="num">{byState.get(s) ?? 0}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section className="page-panel ov-alarms" aria-label="Alarms by area">
        <h2 className="eyebrow">Alarms by area</h2>
        <table className="kh-table ov-alarm-table">
          <thead>
            <tr>
              <th scope="col">Area</th>
              {([1, 2, 3] as const).map((p) => (
                <th key={p} scope="col">
                  <AlarmIndicator priority={p} indication="active-acked" size={16} /> {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {counts.map(({ area, byP }) => (
              <tr key={area.label} onClick={() => onNavigate("alarms")} className="ov-alarm-row">
                <th scope="row">{area.label}</th>
                {([1, 2, 3] as const).map((p) => (
                  <td key={p} className={`num${byP[p].unacked ? " ov-unacked" : ""}`}>
                    {byP[p].total || "–"}
                    {byP[p].unacked ? <span className="label"> ({byP[p].unacked} new)</span> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="page-panel ov-feeders" aria-label="Feeders">
        <h2 className="eyebrow">Collector feeders</h2>
        {FEEDERS.map((f) => {
          const cap = (turbinesOf(f.id).length * RATED_KW) / 1000;
          return (
            <button key={f.id} type="button" className="ov-feeder" onClick={() => onNavigate("substation", f.id)}>
              <span className="ov-feeder-name">{i18n.equipmentName(f.id)}</span>
              <AnalogBar value={n(pointId(f.id, "p_mw"))} min={0} max={cap} label={`${i18n.equipmentName(f.id)} active power`} />
              <span className="num">{fmt(n(pointId(f.id, "p_mw")))} MW</span>
            </button>
          );
        })}
        <h2 className="eyebrow">Transformer loading</h2>
        {plant.transformers.map((t) => {
          const mw = n(pointId(t.lvBay, "p_mw"));
          return (
            <button key={t.id} type="button" className="ov-feeder" onClick={() => onNavigate("substation", t.id)}>
              <span className="ov-feeder-name">{t.label}</span>
              <AnalogBar value={mw === null ? null : (Math.abs(mw) / t.ratedMva) * 100} min={0} max={120} normal={[0, 90]} limits={[100]} label={`${t.label} loading`} />
              <span className="num">
                {mw === null ? "?" : fmt((Math.abs(mw) / t.ratedMva) * 100, 0)} % · oil {fmt(n(pointId(t.id, "oil_temp")), 0)} °C
              </span>
            </button>
          );
        })}
      </section>

      <section className="page-panel ov-trend" aria-label="Production today">
        <h2 className="eyebrow">Export to grid · last 24 h</h2>
        <ProductionTrend />
      </section>
    </div>
  );
}
