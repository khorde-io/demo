/** Every symbol and widget state on one screen, for review against the mockups. */

import {
  AlarmIndicator,
  AnalogBar,
  AnalogValue,
  Breaker,
  Busbar,
  Disconnector,
  EarthingSwitch,
  Line,
  SymbolSvg,
  Transformer2W,
  TurbineTile,
  WindIndicator,
  WindTurbine,
  type SwitchState,
  type TurbineState,
} from "@khorde/hmi-react";
import type { ReactNode } from "react";

const SWITCHES: SwitchState[] = ["closed", "open", "intermediate", "invalid", "unknown"];
const TURBINES: TurbineState[] = ["producing", "waiting", "stopped", "fault", "curtailed", "unknown"];

function Cell({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="sheet-cell">
      {children}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function SymbolSheet() {
  return (
    <div className="sheet">
      <section className="sheet-panel">
        <h2>Circuit breaker</h2>
        <div className="sheet-row">
          {SWITCHES.map((s) => (
            <Cell key={s} caption={s}>
              <SymbolSvg width={80} height={72}>
                <Breaker state={s} />
              </SymbolSvg>
            </Cell>
          ))}
          <Cell caption="tripped, P1">
            <SymbolSvg width={80} height={72}>
              <Breaker state="open" alarm={{ priority: 1, indication: "active-unacked" }} />
            </SymbolSvg>
          </Cell>
          <Cell caption="interlocked">
            <SymbolSvg width={80} height={72}>
              <Breaker state="closed" interlocked />
            </SymbolSvg>
          </Cell>
          <Cell caption="local control">
            <SymbolSvg width={80} height={72}>
              <Breaker state="closed" local />
            </SymbolSvg>
          </Cell>
        </div>
      </section>

      <section className="sheet-panel">
        <h2>Disconnector · earthing switch</h2>
        <div className="sheet-row">
          {SWITCHES.map((s) => (
            <Cell key={s} caption={`DS ${s}`}>
              <SymbolSvg width={64} height={72}>
                <Disconnector state={s} />
              </SymbolSvg>
            </Cell>
          ))}
          {(["open", "closed", "unknown"] as const).map((s) => (
            <Cell key={s} caption={`ES ${s}`}>
              <SymbolSvg width={64} height={72}>
                <EarthingSwitch state={s} />
              </SymbolSvg>
            </Cell>
          ))}
        </div>
      </section>

      <section className="sheet-panel">
        <h2>Lines · bus · transformer</h2>
        <div className="sheet-row">
          {([true, false, null] as const).map((e) => (
            <Cell key={String(e)} caption={e === null ? "unknown" : e ? "energized" : "de-energized"}>
              <svg width={80} height={16}>
                <Line points={[[0, 8], [80, 8]]} energized={e} />
              </svg>
            </Cell>
          ))}
          <Cell caption="busbar live">
            <svg width={80} height={16}>
              <Busbar points={[[0, 8], [80, 8]]} energized />
            </svg>
          </Cell>
          <Cell caption="busbar dead">
            <svg width={80} height={16}>
              <Busbar points={[[0, 8], [80, 8]]} energized={false} />
            </svg>
          </Cell>
          <Cell caption="transformer, tap 9">
            <SymbolSvg width={140} height={104}>
              <Transformer2W hvLive lvLive tap={9} x={-20} />
            </SymbolSvg>
          </Cell>
          <Cell caption="LV side dead">
            <SymbolSvg width={80} height={104}>
              <Transformer2W hvLive lvLive={false} />
            </SymbolSvg>
          </Cell>
        </div>
      </section>

      <section className="sheet-panel">
        <h2>Alarm indicators</h2>
        <div className="sheet-row">
          {([1, 2, 3] as const).map((p) => (
            <Cell key={p} caption={`P${p} active`}>
              <AlarmIndicator priority={p} indication="active-acked" size={36} />
            </Cell>
          ))}
          <Cell caption="unacked (flashes)">
            <AlarmIndicator priority={1} indication="active-unacked" size={36} />
          </Cell>
          <Cell caption="returned, unacked">
            <AlarmIndicator priority={3} indication="returned-unacked" size={36} />
          </Cell>
        </div>
      </section>

      <section className="sheet-panel">
        <h2>Values · analog indicator</h2>
        <div className="sheet-row">
          <Cell caption="good">
            <AnalogValue value={34.6} unit="kV" />
          </Cell>
          <Cell caption="bad quality">
            <AnalogValue value={34.6} unit="kV" quality="bad" />
          </Cell>
          <Cell caption="stale">
            <AnalogValue value={34.6} unit="kV" stale />
          </Cell>
          <Cell caption="no value">
            <AnalogValue value={null} unit="kV" />
          </Cell>
          <Cell caption="with alarm">
            <AnalogValue value={92.4} unit="°C" alarm={{ priority: 2, indication: "active-acked" }} />
          </Cell>
        </div>
        <div className="sheet-bars">
          <Cell caption="normal">
            <AnalogBar value={42} min={0} max={100} normal={[20, 65]} limits={[65, 80]} label="normal" />
          </Cell>
          <Cell caption="above H">
            <AnalogBar value={70} min={0} max={100} normal={[20, 65]} limits={[65, 80]} label="above H" />
          </Cell>
          <Cell caption="bad quality">
            <AnalogBar value={42} min={0} max={100} quality="bad" label="bad" />
          </Cell>
        </div>
      </section>

      <section className="sheet-panel">
        <h2>Wind</h2>
        <div className="sheet-row">
          {TURBINES.map((s) => (
            <Cell key={s} caption={s}>
              <SymbolSvg width={64} height={72}>
                <WindTurbine state={s} {...(s === "fault" ? { alarm: { priority: 1, indication: "active-unacked" } as const } : {})} />
              </SymbolSvg>
            </Cell>
          ))}
          <Cell caption="wind">
            <WindIndicator speed={9.4} direction={135} />
          </Cell>
        </div>
        <div className="sheet-tiles">
          <TurbineTile name="WTG 01" state="producing" powerKw={3520} ratedKw={4500} />
          <TurbineTile name="WTG 09" state="stopped" powerKw={0} ratedKw={4500} />
          <TurbineTile name="WTG 14" state="fault" powerKw={0} ratedKw={4500} alarm={{ priority: 1, indication: "active-unacked" }} />
          <TurbineTile name="WTG 22" state="unknown" powerKw={null} ratedKw={4500} />
          <TurbineTile name="WTG 05" state="curtailed" powerKw={2000} ratedKw={4500} setpointKw={2000} />
        </div>
      </section>
    </div>
  );
}
