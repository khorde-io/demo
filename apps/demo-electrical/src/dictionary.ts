/**
 * The project dictionary for Ventos da Serra: equipment names, state labels,
 * point names and units. Equipment names come from the plant description,
 * shortened the way operators write them (CB, DS, ES), so they fit gates and
 * symbols.
 */

import type { Catalog } from "@khorde/hmi-core";
import type { Plant } from "@khorde/demo-plant";

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

export function projectCatalog(plant: Plant): Catalog {
  return {
    equipment: Object.fromEntries(Object.entries(plant.labels).map(([id, label]) => [id, shortName(label)])),
    states: {
      "**::pos": { "0": "Open", "1": "Closed", "2": "Intermediate", "3": "Invalid" },
      "**::remote_local": { "0": "Local", "1": "Remote" },
      "**::trip": { "0": "Not tripped", "1": "Tripped" },
      "**::sf6_low": { "0": "Normal", "1": "Low" },
      "**::buchholz": { "0": "Normal", "1": "Tripped" },
      "**::prv": { "0": "Normal", "1": "Tripped" },
      "**::comm": { "0": "Lost", "1": "OK" },
      "vds.wf.**::state": { "0": "Stopped", "1": "Producing", "2": "Waiting", "3": "Fault", "4": "Curtailed" },
    },
    points: {
      "**::remote_local": "Control",
      "**::trip": "Trip",
      "**::v_kv": "Voltage",
      "**::p_mw": "Active power",
      "**::p_kw": "Active power",
      "**::i_a": "Current",
      "**::oil_temp": "Oil temperature",
      "**::tap": "Tap",
      "vds.wf.**::state": "State",
    },
    units: {
      "**::v_kv": "kV",
      "**::p_mw": "MW",
      "**::p_kw": "kW",
      "**::q_mvar": "Mvar",
      "**::i_a": "A",
      "**::oil_temp": "°C",
      "**::wdg_temp": "°C",
      "**::wind_ms": "m/s",
    },
  };
}
