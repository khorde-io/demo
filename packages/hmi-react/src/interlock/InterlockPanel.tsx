import "./interlock.css";
import { useMemo, useState } from "react";
import { analyzeFlow, conditions as listConditions, inputPoints, type InterlockView, type PointId, type PointValue } from "@khorde/hmi-core";
import { useI18n, usePointValues } from "../context.tsx";
import { InterlockLadder } from "./InterlockLadder.tsx";
import { currentValueText, describeCondition } from "./labels.ts";
import { layoutLadder, type LadderMetrics } from "./layout.ts";

export interface InterlockPanelProps {
  /** From `useInterlock` (or `createInterlockWatcher`). */
  view: InterlockView;
  /** Command name as the operator reads it: "Close". */
  command: string;
  /**
   * Current values for the "now …" column. Defaults to the point store from
   * `<HmiProvider>`; pass them when rendering without one.
   */
  values?: ReadonlyMap<PointId, PointValue>;
  metrics?: Partial<LadderMetrics>;
}

/**
 * Explains a command's interlock: outcome, the ladder from request to "allowed",
 * and the numbered conditions with their current values. Hovering or focusing
 * a gate highlights its row and the other way round.
 */
export function InterlockPanel({ view, command, values, metrics }: InterlockPanelProps) {
  const i18n = useI18n();
  const [hl, setHl] = useState<number | null>(null);
  const { detail, tree } = view;

  const model = useMemo(() => {
    const flow = analyzeFlow(tree);
    const conds = listConditions(tree);
    // A shared interlock's heading goes above its first condition in the list.
    const groupStarts = conds.map((c, i) => {
      const g = c.within.at(-1) ?? "";
      return g !== "" && g !== (conds[i - 1]?.within.at(-1) ?? "") ? g : null;
    });
    return { flow, conds, groupStarts, ladder: layoutLadder(tree, flow, conds, metrics), texts: conds.map((c) => describeCondition(i18n, c)) };
  }, [tree, metrics, i18n]);

  const live = usePointValues(values ? [] : inputPoints(tree));
  const valueOf = (id: PointId | null) => (id ? (values ?? live).get(id) : undefined);

  if (!detail) {
    const msg = view.error ? "interlock.unavailable" : "interlock.loading";
    return (
      <section className="kh-ilk" aria-busy={!view.error}>
        <p className="kh-ilk-msg">{i18n.t(msg)}</p>
      </section>
    );
  }
  if (!detail.hasInterlock) {
    return (
      <section className="kh-ilk">
        <p className="kh-ilk-msg">{i18n.t("interlock.none")}</p>
      </section>
    );
  }

  const { flow, conds, groupStarts, ladder, texts } = model;
  const blocked = detail.outcome === "BLOCK";
  const stops = flow.stoppers.length;
  const pill = blocked
    ? `${i18n.t("interlock.state.BLOCK")}${stops > 0 ? ` · ${stops === 1 ? i18n.t("interlock.stopsOne") : i18n.t("interlock.stopsMany", { count: stops })}` : ""}`
    : i18n.t("interlock.state.PERMIT");

  return (
    <section className="kh-ilk" aria-label={`${i18n.t("interlock.title")} ${detail.key ?? ""}`}>
      <header className="kh-ilk-head">
        <div className="kh-ilk-keyline">
          <span className="kh-ilk-eyebrow">{i18n.t("interlock.title")}</span>
          <span className="kh-ilk-key">{detail.key}</span>
          <span className={blocked ? "kh-ilk-pill kh-ilk-pill--block" : "kh-ilk-pill kh-ilk-pill--permit"}>{pill}</span>
        </div>
        {detail.description && <p className="kh-ilk-desc">{detail.description}</p>}
      </header>

      <div className="kh-ilk-ladder-wrap">
        <InterlockLadder ladder={ladder} command={command} gateText={(n) => texts[n - 1]?.short ?? ""} highlighted={hl} onHighlight={setHl} />
      </div>

      <ol className="kh-ilk-conds" aria-label={i18n.t("interlock.conditions")}>
        {conds.map((c, i) => {
          const text = texts[i];
          const f = flow.byPath.get(c.path);
          const group = groupStarts[i];
          const status = c.state === "PERMIT"
            ? `✓ ${i18n.t("interlock.state.PERMIT")}`
            : f?.stops
              ? i18n.t("interlock.stopsHere")
              : f && !f.needed
                ? `${i18n.t(`interlock.state.${c.state ?? "BAD_QUALITY"}`)} · ${i18n.t("interlock.notNeeded")}`
                : i18n.t(`interlock.state.${c.state ?? "BAD_QUALITY"}`);
          const tone = c.state === "PERMIT" ? "permit" : c.state === "BLOCK" ? "block" : "unknown";
          return [
            group && (
              <li key={`g-${c.n}`} className="kh-ilk-group" aria-hidden="true">
                <span className="kh-ilk-eyebrow">{i18n.t("interlock.refTag")}</span> {i18n.t("interlock.shared", { key: group })}
              </li>
            ),
            <li
              key={c.path}
              data-n={c.n}
              className={["kh-ilk-cond", f?.stops ? "kh-ilk-cond--stops" : "", hl === c.n ? "kh-ilk-cond--hl" : ""].join(" ")}
              onPointerEnter={() => setHl(c.n)}
              onPointerLeave={() => setHl(null)}
            >
              <span className="kh-ilk-num" aria-hidden="true">{c.n}</span>
              <span className="kh-ilk-cond-txt">
                <span>{text?.full}</span>
                <span className="kh-ilk-expr">{text?.expression}</span>
              </span>
              <span className="kh-ilk-cond-right">
                <span className={`kh-ilk-status kh-ilk-status--${tone}`}>{status}</span>
                {text?.subject && <span className="kh-ilk-now">{i18n.t("interlock.now", { value: currentValueText(i18n, valueOf(text.subject)) })}</span>}
              </span>
            </li>,
          ];
        })}
      </ol>
    </section>
  );
}
