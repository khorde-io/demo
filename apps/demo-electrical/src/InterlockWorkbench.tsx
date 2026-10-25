/**
 * A development bench for the interlock view: pick a command of the demo
 * plant and see its interlock live. On the mock backend the field values it
 * reads can be changed here (the simulator overwrites the ones it drives on
 * its next step).
 */

import { inputPoints, type CommandKey, type PointId } from "@khorde/hmi-core";
import type { MockBackend } from "@khorde/hmi-core/mock";
import { InterlockPanel, useI18n, useInterlock, usePointValues } from "@khorde/hmi-react";
import { useState } from "react";

export interface BenchCommand {
  key: CommandKey;
  /** What the operator reads: "Close". */
  verb: string;
}

function FieldControl({ id, backend }: { id: PointId; backend: MockBackend }) {
  const i18n = useI18n();
  const v = usePointValues([id]).get(id);
  const options = [0, 1, 2, 3, 4].filter((n) => i18n.stateLabel(id, n) !== null);
  const bad = v?.quality === "bad";
  const current = typeof v?.value === "number" ? v.value : 0;
  const publish = (value: number, quality: "good" | "bad" = bad ? "bad" : "good") => backend.publish(id, value, { quality });
  const equipment = i18n.equipmentName(id.slice(0, id.lastIndexOf("::")));
  const name = i18n.pointName(id);
  const inputId = `f-${id.replace(/[^\w]/g, "_")}`;
  return (
    <div className="bench-field">
      <div className="bench-field-top">
        <strong>
          {equipment}
          {name ? ` · ${name}` : ""}
        </strong>
        <code>{id}</code>
        <label className="bench-quality">
          <input type="checkbox" checked={bad} onChange={(e) => publish(current, e.target.checked ? "bad" : "good")} /> Bad quality
        </label>
      </div>
      {options.length > 0 ? (
        <div className="bench-choices" role="group" aria-label={`${equipment} ${name ?? ""}`}>
          {options.map((o) => (
            <button key={o} type="button" className="bench-choice" aria-pressed={current === o} onClick={() => publish(o)}>
              {i18n.stateLabel(id, o)}
            </button>
          ))}
        </div>
      ) : (
        <div className="bench-analog">
          <input id={inputId} type="number" step="0.1" value={current} onChange={(e) => publish(Number(e.target.value))} />
          <label htmlFor={inputId}>{i18n.unit(id) ?? ""}</label>
        </div>
      )}
    </div>
  );
}

export function InterlockWorkbench({ commands, backend }: { commands: readonly BenchCommand[]; backend: MockBackend | null }) {
  const i18n = useI18n();
  const [index, setIndex] = useState(0);
  const cmd = commands[index] ?? commands[0];
  const view = useInterlock(cmd?.key ?? null);
  if (!cmd) return null;
  const equipment = i18n.equipmentName(cmd.key.equipment);
  return (
    <div className="bench">
      <section className="bench-faceplate" aria-labelledby="bench-title">
        <div className="bench-head">
          <span className="bench-eyebrow">{cmd.key.agent}</span>
          <h1 id="bench-title">{equipment}</h1>
          <code>{cmd.key.equipment}</code>
        </div>
        <label className="bench-select">
          Command
          <select value={index} onChange={(e) => setIndex(Number(e.target.value))}>
            {commands.map((c, i) => (
              <option key={`${c.key.equipment}|${c.key.name}`} value={i}>
                {c.verb} {i18n.equipmentName(c.key.equipment)} · {c.key.name}
              </option>
            ))}
          </select>
        </label>
        <InterlockPanel view={view} command={cmd.verb} />
      </section>
      <aside className="bench-fields" aria-label="Field values">
        <h2>Field values</h2>
        {backend ? (
          <>
            <p className="bench-note">Mock backend. Change a value and the interlock is evaluated again.</p>
            {inputPoints(view.tree).map((id) => (
              <FieldControl key={id} id={id} backend={backend} />
            ))}
          </>
        ) : (
          <p className="bench-note">Field values can only be changed on the mock backend.</p>
        )}
      </aside>
    </div>
  );
}
