/**
 * A feeder bay with its faceplate open: the frame, live values and bars, the
 * switching devices with their commands, the interlock view and a trend.
 * The plant screens of phase 6 open this from the single-line.
 */

import type { CommandKey, PointId } from "@khorde/hmi-core";
import {
  AnalogBar,
  AnalogValue,
  BoundBreaker,
  BoundDisconnector,
  BoundEarthingSwitch,
  CommandDialog,
  Faceplate,
  InterlockPanel,
  SymbolSvg,
  TrendChart,
  useI18n,
  useInterlock,
  usePoint,
  useTrend,
  Breaker,
} from "@khorde/hmi-react";
import { useState } from "react";

const AGENT = "vds-substation";
const BAY = "vds.sub.mv.a.f1";
const DEVICES = [
  { equipment: `${BAY}.cb`, kind: "breaker" as const },
  { equipment: `${BAY}.ds`, kind: "disconnector" as const },
  { equipment: `${BAY}.es`, kind: "earthing" as const },
];

function Values() {
  const i18n = useI18n();
  const p = usePoint(`${BAY}::p_mw`);
  const v = usePoint(`${BAY}::v_kv`);
  const num = (x: typeof p) => (typeof x?.value === "number" ? x.value : null);
  return (
    <div className="fp-values">
      <div>
        <span className="label">{i18n.pointName(`${BAY}::p_mw`)}</span>
        <AnalogValue value={num(p)} unit="MW" decimals={2} quality={p?.quality ?? "bad"} size="lg" />
        <AnalogBar value={num(p)} min={0} max={30} normal={[0, 27]} limits={[27]} label="F1 active power" />
      </div>
      <div>
        <span className="label">{i18n.pointName(`${BAY}::v_kv`)}</span>
        <AnalogValue value={num(v)} unit="kV" decimals={2} quality={v?.quality ?? "bad"} size="lg" />
        <AnalogBar value={num(v)} min={30} max={38} normal={[33.5, 35.5]} limits={[32.8, 36.2]} label="F1 voltage" />
      </div>
    </div>
  );
}

function Control({ onCommand, onExplain, explained }: { onCommand: (key: CommandKey, title: string, verb: string) => void; onExplain: (key: CommandKey) => void; explained: CommandKey | null }) {
  const i18n = useI18n();
  const view = useInterlock(explained);
  return (
    <>
      <ul className="fp-devices">
        {DEVICES.map((d) => {
          const pos = `${d.equipment}::pos` as PointId;
          const name = i18n.equipmentName(d.equipment);
          const symbol =
            d.kind === "breaker" ? (
              <BoundBreaker pos={pos} remoteLocal={`${d.equipment}::remote_local`} />
            ) : d.kind === "disconnector" ? (
              <BoundDisconnector pos={pos} />
            ) : (
              <BoundEarthingSwitch pos={pos} />
            );
          return (
            <li key={d.equipment}>
              <SymbolSvg width={56} height={68}>
                {symbol}
              </SymbolSvg>
              <span className="fp-device-name">
                <strong>{name}</strong>
                <span className="mono label">{d.equipment}</span>
              </span>
              <span className="fp-device-actions">
                {(["open", "close"] as const).map((verb) => {
                  const key = { agent: AGENT, equipment: d.equipment, name: `pos.${verb}` };
                  const title = `${verb === "open" ? "Open" : "Close"} ${name}`;
                  return (
                    <span key={verb} className="fp-cmd">
                      <button type="button" className="kh-btn kh-btn--sm" onClick={() => onCommand(key, title, verb)}>
                        {verb === "open" ? "Open…" : "Close…"}
                      </button>
                      <button type="button" className="kh-link" onClick={() => onExplain(key)}>
                        Why?
                      </button>
                    </span>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ul>
      {explained ? (
        <InterlockPanel view={view} command={explained.name.endsWith("open") ? "Open" : "Close"} />
      ) : (
        <p className="note">Pick "Why?" next to a command to see its interlock.</p>
      )}
    </>
  );
}

function Trend() {
  const i18n = useI18n();
  const t = useTrend([`${BAY}::p_mw`], "analogical", 10 * 60e3, () => i18n.pointName(`${BAY}::p_mw`) ?? "P");
  return <TrendChart series={t.series} from={t.from} to={t.to} unit="MW" label="F1 active power, last 10 min" width={560} height={220} message={t.status === "loading" ? i18n.t("trend.loading") : null} />;
}

export function FeederPage() {
  const [tab, setTab] = useState("control");
  const [open, setOpen] = useState(true);
  const [dialog, setDialog] = useState<{ key: CommandKey; title: string; verb: string } | null>(null);
  const [explained, setExplained] = useState<CommandKey | null>({ agent: AGENT, equipment: `${BAY}.es`, name: "pos.close" });

  return (
    <div className="feeder-stage">
      <div className="feeder-backdrop">
        <p className="note">The single-line of phase 6 goes here; the faceplate opens over it.</p>
        <button type="button" className="kh-btn" onClick={() => setOpen(true)} disabled={open}>
          <SymbolSvg width={24} height={30}>
            <Breaker state="closed" scale={0.4} />
          </SymbolSvg>
          Open the F1 faceplate
        </button>
      </div>
      {open && (
        <Faceplate
          eyebrow="Feeder bay · 34.5 kV bus A"
          title="F1 · WTG 01–06"
          subtitle={BAY}
          activeTab={tab}
          onTabChange={setTab}
          onClose={() => setOpen(false)}
          tabs={[
            { id: "overview", label: "Overview", content: <Values /> },
            { id: "control", label: "Control", content: <Control onCommand={(key, title, verb) => setDialog({ key, title, verb })} onExplain={setExplained} explained={explained} /> },
            { id: "trend", label: "Trend", content: <Trend /> },
          ]}
        />
      )}
      {dialog && <CommandDialog command={dialog.key} title={dialog.title} verb={dialog.verb} onClose={() => setDialog(null)} />}
    </div>
  );
}
