/**
 * The project dictionary for Ventos da Serra: equipment names, state labels,
 * point names, units and alarm texts. Equipment names come from the plant
 * description, shortened the way operators write them (CB, DS, ES), so they
 * fit gates and symbols. Alarm texts are built from the alarm definitions, so
 * every alarm in the agent config has one.
 */

import type { Catalog, Dictionary } from "@khorde/hmi-core";
import type { AlarmDef, Plant } from "@khorde/demo-plant";

const SHORT: [RegExp, string][] = [
  [/\bcircuit breaker\b/, "CB"],
  [/\bbreaker\b/, "CB"],
  [/\b(line )?earthing switch\b/, "ES"],
  [/\b(line )?disconnector\b/, "DS"],
  [/^Bus coupler\b/, "Coupler"],
  [/^Feeder (F\d)$/, "$1"],
];

export function shortName(label: string): string {
  return SHORT.reduce((s, [re, to]) => s.replace(re, to), label);
}

const LIMIT_WORD: Record<string, string> = { high_high: "very high", high: "high", low: "low", low_low: "very low" };

const WHAT: Record<string, string> = {
  v_kv: "voltage",
  f_hz: "frequency",
  oil_temp: "oil temperature",
  wdg_temp: "winding temperature",
  gbx_temp: "gearbox temperature",
  gen_temp: "generator temperature",
};

const DIGITAL: Record<string, string> = {
  trip: "trip",
  sf6_low: "SF6 pressure low",
  buchholz: "Buchholz trip",
  prv: "pressure relief trip",
  comm: "communication lost",
};

const DISCRETE: Record<string, string> = { invalid: "position invalid", fault: "fault" };

/** Text per alarm name and condition id (`_` for a digital alarm's single condition). */
export function alarmTexts(plant: Plant, alarms: readonly AlarmDef[] = plant.alarms): Dictionary {
  const subject = (equipment: string) =>
    plant.transformers.find((t) => t.id === equipment)?.label ??
    (equipment === "vds.sub.hv.l1" ? "Grid" : (plant.labels[equipment] ?? equipment));
  const out: Dictionary = {};
  for (const { config } of alarms) {
    const at = config.meas.lastIndexOf("::");
    const [equipment, name] = [config.meas.slice(0, at), config.meas.slice(at + 2)];
    const who = subject(equipment);
    const texts: Record<string, string> = {};
    if (config.type === "digital") texts._ = `${who} ${DIGITAL[name] ?? name}`;
    if (config.type === "discrete") {
      for (const c of config.conditions as { id: string }[]) texts[c.id] = `${who} ${DISCRETE[c.id] ?? c.id}`;
    }
    if (config.type === "analog") {
      for (const id of Object.keys(config.conditions as object)) texts[id] = `${who} ${WHAT[name] ?? name} ${LIMIT_WORD[id] ?? id}`;
    }
    out[config.name] = texts;
  }
  return out;
}

export function projectCatalog(plant: Plant): Catalog {
  return {
    messages: { alarms: alarmTexts(plant) },
    equipment: Object.fromEntries(Object.entries(plant.labels).map(([id, label]) => [id, shortName(label)])),
    states: {
      "**::pos": { "0": "Open", "1": "Closed", "2": "Intermediate", "3": "Invalid" },
      "**::remote_local": { "0": "Local", "1": "Remote" },
      "**::trip": { "0": "Not tripped", "1": "Tripped" },
      "**::sf6_low": { "0": "Normal", "1": "Low" },
      "**::buchholz": { "0": "Normal", "1": "Tripped" },
      "**::prv": { "0": "Normal", "1": "Tripped" },
      "**::comm": { "0": "Lost", "1": "OK" },
      "**::avail": { "0": "Unavailable", "1": "Available" },
      "vds.wf.**::state": { "0": "Stopped", "1": "Producing", "2": "Waiting", "3": "Fault", "4": "Curtailed" },
    },
    points: {
      "**::pos": "Position",
      "**::remote_local": "Control",
      "**::trip": "Trip",
      "**::sf6_low": "SF6 pressure",
      "**::v_kv": "Voltage",
      "**::f_hz": "Frequency",
      "**::p_mw": "Active power",
      "**::p_kw": "Active power",
      "**::q_mvar": "Reactive power",
      "**::q_kvar": "Reactive power",
      "**::i_a": "Current",
      "**::oil_temp": "Oil temperature",
      "**::wdg_temp": "Winding temperature",
      "**::tap": "Tap",
      "**::buchholz": "Buchholz",
      "**::prv": "Pressure relief",
      "**::wind_ms": "Wind speed",
      "**::wind_dir": "Wind direction",
      "**::rotor_rpm": "Rotor speed",
      "**::pitch_deg": "Pitch",
      "**::yaw_deg": "Yaw",
      "**::gen_temp": "Generator temperature",
      "**::gbx_temp": "Gearbox temperature",
      "**::curtail_sp": "Curtailment setpoint",
      "**::avail": "Availability",
      "**::comm": "Communication",
      "**::fault_code": "Fault code",
      "vds.wf.**::state": "State",
    },
    units: {
      "**::v_kv": "kV",
      "**::p_mw": "MW",
      "**::p_kw": "kW",
      "**::q_mvar": "Mvar",
      "**::q_kvar": "kvar",
      "**::f_hz": "Hz",
      "**::wind_dir": "°",
      "**::rotor_rpm": "rpm",
      "**::pitch_deg": "°",
      "**::yaw_deg": "°",
      "**::gen_temp": "°C",
      "**::gbx_temp": "°C",
      "**::curtail_sp": "kW",
      "**::i_a": "A",
      "**::oil_temp": "°C",
      "**::wdg_temp": "°C",
      "**::wind_ms": "m/s",
    },
  };
}
