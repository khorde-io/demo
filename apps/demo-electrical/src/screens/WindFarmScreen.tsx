import { pointId, type PointId } from "@khorde/hmi-core";
import { RATED_KW } from "@khorde/demo-plant";
import { BoundBreaker, SymbolSvg, TurbineTile, WindIndicator, turbineStateOf, useI18n, usePointValues } from "@khorde/hmi-react";
import { EquipmentFaceplate } from "../faceplates/EquipmentFaceplate.tsx";
import { focusOf } from "../navigation.ts";
import { bayById, plant, turbinesOf } from "../plant.ts";
import { useEquipmentAlarms } from "../useEquipmentAlarm.ts";

const FEEDERS = plant.bays.filter((b) => b.kind === "feeder");
const POINTS: PointId[] = [
  ...plant.turbines.flatMap((t) => (["state", "p_kw", "curtail_sp"] as const).map((n) => pointId(t.id, n))),
  ...FEEDERS.map((f) => pointId(f.id, "p_mw")),
  "vds.wf.met::wind_ms",
  "vds.wf.met::wind_dir",
];

const numberOf = (v: { value: unknown; quality: string } | undefined) => (v?.quality === "good" && typeof v.value === "number" ? v.value : null);

/**
 * L2: the turbines by collector feeder, laid out from the plant description,
 * so a different turbine count needs no change here.
 */
export function WindFarmScreen({ focus, onFocus }: { focus: string | null; onFocus: (id: string | null) => void }) {
  const i18n = useI18n();
  const values = usePointValues(POINTS);
  const alarm = useEquipmentAlarms();
  const f = focus ? focusOf(focus) : null;
  const fmt = (n: number | null, d = 1) => (n === null ? "?" : i18n.formatNumber(n, { minimumFractionDigits: d, maximumFractionDigits: d }));
  return (
    <div className="stage">
      <div className={`farm${f ? " stage-drawing--with-panel" : ""}`}>
        <header className="farm-head">
          <WindIndicator speed={numberOf(values.get("vds.wf.met::wind_ms"))} direction={numberOf(values.get("vds.wf.met::wind_dir"))} size={72} label="Met mast wind" />
          <div>
            <span className="eyebrow">Met mast</span>
            <p className="farm-wind num">
              {fmt(numberOf(values.get("vds.wf.met::wind_ms")))} <span className="label">m/s</span> · {fmt(numberOf(values.get("vds.wf.met::wind_dir")), 0)}
              <span className="label">°</span>
            </p>
          </div>
        </header>
        {FEEDERS.map((feeder) => {
          const turbines = turbinesOf(feeder.id);
          const producing = turbines.filter((t) => turbineStateOf(values.get(pointId(t.id, "state"))) === "producing").length;
          return (
            <section key={feeder.id} className="farm-feeder" aria-label={i18n.equipmentName(feeder.id)}>
              <header className="farm-feeder-head">
                <button type="button" className="farm-feeder-cb" onClick={() => onFocus(feeder.cb)}>
                  <SymbolSvg width={28} height={34}>
                    <BoundBreaker pos={pointId(feeder.cb, "pos")} scale={0.45} alarm={alarm(feeder.cb)} label={i18n.equipmentName(feeder.cb)} />
                  </SymbolSvg>
                  <span className="kh-sr-only">, open the bay</span>
                </button>
                <strong>{i18n.equipmentName(feeder.id)}</strong>
                <span className="label">{i18n.equipmentName(bayById.get(feeder.id)?.bus === "a" ? "vds.sub.mv.a" : "vds.sub.mv.b")}</span>
                <span className="farm-feeder-p num">
                  {fmt(numberOf(values.get(pointId(feeder.id, "p_mw"))), 1)} <span className="label">MW</span>
                </span>
                <span className="label">
                  {producing}/{turbines.length} producing
                </span>
              </header>
              <div className="farm-tiles">
                {turbines.map((t) => (
                  <TurbineTile
                    key={t.id}
                    name={t.label}
                    state={turbineStateOf(values.get(pointId(t.id, "state")))}
                    powerKw={numberOf(values.get(pointId(t.id, "p_kw")))}
                    ratedKw={RATED_KW}
                    setpointKw={numberOf(values.get(pointId(t.id, "curtail_sp")))}
                    alarm={alarm(t.id)}
                    onActivate={() => onFocus(t.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {f && <EquipmentFaceplate key={focus} focus={f} onClose={() => onFocus(null)} />}
    </div>
  );
}
