import type { PointId } from "@khorde/hmi-core";
import { Sparkline, TrendChart, useI18n, useTrend } from "@khorde/hmi-react";

const OIL: PointId[] = ["vds.sub.tr1::oil_temp", "vds.sub.tr2::oil_temp"];
const FEEDERS: PointId[] = ["vds.sub.mv.a.f1::p_mw", "vds.sub.mv.a.f2::p_mw", "vds.sub.mv.b.f3::p_mw", "vds.sub.mv.b.f4::p_mw"];
const WINDOW = 10 * 60e3;

/** L4: trends of the values operators compare most. */
export function TrendsScreen() {
  const i18n = useI18n();
  const name = (id: PointId) => i18n.equipmentName(id.slice(0, id.lastIndexOf("::")));
  const oil = useTrend(OIL, "analogical", WINDOW, name);
  const feeders = useTrend(FEEDERS, "analogical", WINDOW, name);
  const message = (s: typeof oil) => (s.status === "loading" ? i18n.t("trend.loading") : s.status === "error" ? i18n.t("trend.failed") : null);

  return (
    <div className="page">
      <section className="page-panel page-wide">
        <h2 className="eyebrow">Transformer oil temperature · last 10 min</h2>
        <TrendChart series={oil.series} from={oil.from} to={oil.to} unit="°C" min={40} max={100} limits={[{ value: 75, label: "H 75" }, { value: 90, label: "HH 90" }]} label="Transformer oil temperature" message={message(oil)} />
      </section>
      <section className="page-panel page-wide">
        <h2 className="eyebrow">Feeder active power · last 10 min</h2>
        <TrendChart series={feeders.series} from={feeders.from} to={feeders.to} unit="MW" label="Feeder active power" message={message(feeders)} />
        <ul className="spark-list">
          {feeders.series.map((s) => (
            <li key={s.id}>
              <span>{s.label}</span>
              <Sparkline values={s.v.slice(-60)} label={`${s.label}, last minute`} />
              <span className="num">{s.v.at(-1) ?? "—"} MW</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
