/**
 * The Ventos da Serra (VDS) demo plant, described once.
 *
 * 4 collector feeders of `turbinesPerFeeder` 4.5 MW turbines, a 34.5 kV bus
 * split into A and B with a bus coupler, two 60 MVA 34.5/138 kV transformers
 * and one 138 kV line to the grid:
 *
 *                  Grid ── 138 kV line L1 (CB · DS · ES)
 *    ═══════════════════ 138 kV bus ═══════════════════
 *           │ CB · DS                      │ CB · DS
 *          TR1                            TR2
 *           │ incomer CB · DS              │ incomer CB · DS
 *    ═══ bus A ═══ ─[ coupler DS · CB · DS ]─ ═══ bus B ═══
 *      F1   F2   AUX                          F3   F4   spare
 *
 * Everything else (the agent config, the simulator, the HMI's equipment list
 * and names) is generated from this file, so the turbine count is a setting.
 * Point ids follow `<site>.<area>.<bay>.<device>::<name>`, because Khorde
 * subscriptions and alarm areas filter by dotted prefix.
 */

export const SITE = "vds";
export const AGENTS = { substation: "vds-substation", windfarm: "vds-windfarm" } as const;
export type AgentName = (typeof AGENTS)[keyof typeof AGENTS];

export const RATED_KW = 4500;
export const TR_RATED_MVA = 60;
export const FEEDERS = 4;

/** Discrete values. The HMI's dictionary gives them their labels. */
export const SWITCH = { open: 0, closed: 1, intermediate: 2, invalid: 3 } as const;
export const CONTROL = { local: 0, remote: 1 } as const;
export const TURBINE = { stopped: 0, producing: 1, waiting: 2, fault: 3, curtailed: 4 } as const;

export type BusId = "hv" | "a" | "b";
export type BayKind = "line" | "trHv" | "incomer" | "feeder" | "aux" | "coupler" | "spare";

export interface Bay {
  id: string;
  kind: BayKind;
  bus: BusId;
  label: string;
  cb: string;
  ds: string;
  /** Second disconnector (bus coupler only: `ds` is the bus A side). */
  dsB?: string;
  es?: string;
  transformer?: string;
}

export interface Transformer {
  id: string;
  label: string;
  hvBay: string;
  lvBay: string;
  ratedMva: number;
}

export interface Bus {
  id: string;
  bus: BusId;
  label: string;
  kv: number;
}

export interface Turbine {
  id: string;
  number: number;
  label: string;
  /** Feeder bay id. */
  feeder: string;
}

export type MeasType = "discrete" | "analogical";

export interface PointDef {
  agent: AgentName;
  equipment: string;
  name: string;
  type: MeasType;
  store: boolean;
  tags: string[];
  /** Value the simulator starts with. */
  initial: number;
}

/** An alarm in agent-config form, plus its agent. */
export interface AlarmDef {
  agent: AgentName;
  config: Record<string, unknown> & { name: string; area: string; meas: string };
}

export interface CommandDef {
  agent: AgentName;
  equipment: string;
  name: string;
  type: MeasType;
  /** Fixed value of a discrete command. */
  value?: number;
  interlock?: string;
}

export type Expr = Record<string, unknown>;

export interface InterlockDef {
  agent: AgentName;
  key: string;
  description: string;
  expression: Expr;
}

export interface Plant {
  site: string;
  agents: typeof AGENTS;
  turbinesPerFeeder: number;
  buses: Bus[];
  bays: Bay[];
  transformers: Transformer[];
  turbines: Turbine[];
  points: PointDef[];
  alarms: AlarmDef[];
  commands: CommandDef[];
  interlocks: InterlockDef[];
  /** English display names by equipment id. */
  labels: Record<string, string>;
}

export interface PlantOptions {
  turbinesPerFeeder?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** `vds.sub.mv.a.f1.cb` + `trip` → `sub_mv_a_f1_cb_trip` (alarm names and interlock keys). */
const slug = (equipment: string, suffix: string) => `${equipment.replace(/^vds\./, "").replace(/\./g, "_")}_${suffix}`;
const id = (equipment: string, name: string) => `${equipment}::${name}`;
const eq = (point: string, v: number): Expr => ({ eq: [point, v] });

export function buildPlant(options: PlantOptions = {}): Plant {
  const turbinesPerFeeder = options.turbinesPerFeeder ?? 6;
  if (!Number.isInteger(turbinesPerFeeder) || turbinesPerFeeder < 1 || turbinesPerFeeder > 15) {
    throw new Error("turbinesPerFeeder must be an integer from 1 to 15");
  }

  const plant: Plant = {
    site: SITE,
    agents: AGENTS,
    turbinesPerFeeder,
    buses: [],
    bays: [],
    transformers: [],
    turbines: [],
    points: [],
    alarms: [],
    commands: [],
    interlocks: [],
    labels: {},
  };

  const sub = AGENTS.substation;
  const wf = AGENTS.windfarm;

  const point = (agent: AgentName, equipment: string, name: string, type: MeasType, initial: number, tags: string[] = []) =>
    plant.points.push({ agent, equipment, name, type, store: true, tags, initial });
  const alarm = (agent: AgentName, config: AlarmDef["config"]) => plant.alarms.push({ agent, config });
  const interlock = (agent: AgentName, key: string, description: string, expression: Expr) => {
    plant.interlocks.push({ agent, key, description, expression });
    return key;
  };
  const command = (c: CommandDef) => plant.commands.push(c);
  const label = (equipment: string, text: string) => (plant.labels[equipment] = text);

  const limitAlarm = (agent: AgentName, equipment: string, name: string, area: string, conditions: Record<string, unknown>) =>
    alarm(agent, { type: "analog", name: slug(equipment, name), area, meas: id(equipment, name), conditions });

  // ── switchgear ────────────────────────────────────────────────────────────
  const breaker = (cb: string, area: string, text: string, pos: number, close: { extra?: Expr[]; description: string }) => {
    label(cb, text);
    point(sub, cb, "pos", "discrete", pos, ["switch", "breaker"]);
    point(sub, cb, "trip", "discrete", 0, ["protection"]);
    point(sub, cb, "sf6_low", "discrete", 0, ["condition"]);
    point(sub, cb, "remote_local", "discrete", CONTROL.remote, ["control"]);
    alarm(sub, { type: "digital", name: slug(cb, "trip"), area, meas: id(cb, "trip"), set: 1, reset: 0, severity: "high" });
    alarm(sub, { type: "digital", name: slug(cb, "sf6_low"), area, meas: id(cb, "sf6_low"), set: 1, reset: 0, severity: "low" });
    alarm(sub, {
      type: "discrete",
      name: slug(cb, "pos"),
      area,
      meas: id(cb, "pos"),
      conditions: [{ id: "invalid", value: SWITCH.invalid, state: "Set", severity: "medium" }],
    });
    const remote = interlock(sub, slug(cb, "remote"), `${text} is in remote control`, eq(id(cb, "remote_local"), CONTROL.remote));
    command({ agent: sub, equipment: cb, name: "pos.open", type: "discrete", value: SWITCH.open, interlock: remote });
    const closeKey = interlock(
      sub,
      slug(cb, "close"),
      close.description,
      close.extra?.length ? { and: [{ ref: remote }, ...close.extra] } : { ref: remote },
    );
    command({ agent: sub, equipment: cb, name: "pos.close", type: "discrete", value: SWITCH.closed, interlock: closeKey });
  };

  const disconnector = (ds: string, cb: string, area: string, text: string, pos: number) => {
    label(ds, text);
    point(sub, ds, "pos", "discrete", pos, ["switch", "disconnector"]);
    alarm(sub, {
      type: "discrete",
      name: slug(ds, "pos"),
      area,
      meas: id(ds, "pos"),
      conditions: [{ id: "invalid", value: SWITCH.invalid, state: "Set", severity: "medium" }],
    });
    const key = interlock(sub, slug(ds, "operate"), `Operate ${text.toLowerCase()} only with its breaker open`, eq(id(cb, "pos"), SWITCH.open));
    command({ agent: sub, equipment: ds, name: "pos.open", type: "discrete", value: SWITCH.open, interlock: key });
    command({ agent: sub, equipment: ds, name: "pos.close", type: "discrete", value: SWITCH.closed, interlock: key });
  };

  const earthing = (es: string, cb: string, ds: string, voltage: string, text: string) => {
    label(es, text);
    point(sub, es, "pos", "discrete", SWITCH.open, ["switch", "earthing"]);
    const key = interlock(sub, slug(es, "close"), `Close ${text.toLowerCase()} only when the circuit is isolated and dead`, {
      and: [eq(id(cb, "pos"), SWITCH.open), eq(id(ds, "pos"), SWITCH.open), { lt: [voltage, 1] }],
    });
    command({ agent: sub, equipment: es, name: "pos.close", type: "discrete", value: SWITCH.closed, interlock: key });
    command({ agent: sub, equipment: es, name: "pos.open", type: "discrete", value: SWITCH.open });
  };

  const bayMeasurements = (bay: string, names: string[]) => {
    const initial: Record<string, number> = { p_mw: 0, q_mvar: 0, i_a: 0, v_kv: 0, f_hz: 60 };
    for (const n of names) point(sub, bay, n, "analogical", initial[n] ?? 0, ["electrical"]);
  };

  // ── buses ─────────────────────────────────────────────────────────────────
  const buses: Bus[] = [
    { id: "vds.sub.hv.bus", bus: "hv", label: "138 kV bus", kv: 138 },
    { id: "vds.sub.mv.a", bus: "a", label: "34.5 kV bus A", kv: 34.5 },
    { id: "vds.sub.mv.b", bus: "b", label: "34.5 kV bus B", kv: 34.5 },
  ];
  for (const b of buses) {
    plant.buses.push(b);
    label(b.id, b.label);
    point(sub, b.id, "v_kv", "analogical", b.kv, ["electrical"]);
    limitAlarm(sub, b.id, "v_kv", b.id, {
      low_low: { value: +(b.kv * 0.85).toFixed(2), severity: "high", deadband: +(b.kv * 0.01).toFixed(2) },
      low: { value: +(b.kv * 0.9).toFixed(2), severity: "medium", deadband: +(b.kv * 0.01).toFixed(2) },
      high: { value: +(b.kv * 1.1).toFixed(2), severity: "medium", deadband: +(b.kv * 0.01).toFixed(2) },
      high_high: { value: +(b.kv * 1.15).toFixed(2), severity: "high", deadband: +(b.kv * 0.01).toFixed(2) },
    });
  }

  // ── 138 kV line bay ───────────────────────────────────────────────────────
  {
    const bay = "vds.sub.hv.l1";
    const b: Bay = { id: bay, kind: "line", bus: "hv", label: "Line L1 · grid 138 kV", cb: `${bay}.cb`, ds: `${bay}.ds`, es: `${bay}.es` };
    plant.bays.push(b);
    label(bay, b.label);
    bayMeasurements(bay, ["p_mw", "q_mvar", "i_a", "v_kv", "f_hz"]);
    limitAlarm(sub, bay, "f_hz", bay, {
      low_low: { value: 59, severity: "high", deadband: 0.05 },
      low: { value: 59.5, severity: "medium", deadband: 0.05 },
      high: { value: 60.5, severity: "medium", deadband: 0.05 },
      high_high: { value: 61, severity: "high", deadband: 0.05 },
    });
    breaker(b.cb, bay, "L1 circuit breaker", SWITCH.closed, {
      description: "Close the L1 breaker only in remote with the line earthing switch open",
      extra: [eq(id(b.es as string, "pos"), SWITCH.open)],
    });
    disconnector(b.ds, b.cb, bay, "L1 line disconnector", SWITCH.closed);
    earthing(b.es as string, b.cb, b.ds, id(bay, "v_kv"), "L1 line earthing switch");
  }

  // ── transformers ──────────────────────────────────────────────────────────
  for (const [n, lvBus] of [[1, "a"], [2, "b"]] as const) {
    const tr = `vds.sub.tr${n}`;
    const hv = `vds.sub.hv.tr${n}`;
    const lv = `vds.sub.mv.${lvBus}.tr${n}`;
    plant.transformers.push({ id: tr, label: `TR${n}`, hvBay: hv, lvBay: lv, ratedMva: TR_RATED_MVA });
    label(tr, `TR${n} · ${TR_RATED_MVA} MVA 34.5/138 kV`);

    point(sub, tr, "oil_temp", "analogical", 55, ["thermal"]);
    point(sub, tr, "wdg_temp", "analogical", 62, ["thermal"]);
    point(sub, tr, "tap", "discrete", 9, ["tap"]);
    point(sub, tr, "buchholz", "discrete", 0, ["protection"]);
    point(sub, tr, "prv", "discrete", 0, ["protection"]);
    // Thermal alarms reset 5 °C below their limit, as is usual for transformers.
    limitAlarm(sub, tr, "oil_temp", tr, {
      high: { value: 75, severity: "medium", deadband: 5 },
      high_high: { value: 90, severity: "high", deadband: 5 },
    });
    limitAlarm(sub, tr, "wdg_temp", tr, {
      high: { value: 95, severity: "medium", deadband: 5 },
      high_high: { value: 110, severity: "high", deadband: 5 },
    });
    alarm(sub, { type: "digital", name: slug(tr, "buchholz"), area: tr, meas: id(tr, "buchholz"), set: 1, reset: 0, severity: "high" });
    alarm(sub, { type: "digital", name: slug(tr, "prv"), area: tr, meas: id(tr, "prv"), set: 1, reset: 0, severity: "high" });
    command({ agent: sub, equipment: tr, name: "tap.raise", type: "discrete", value: 1, interlock: interlock(sub, slug(tr, "tap_raise"), `TR${n} is below its top tap`, { lt: [id(tr, "tap"), 17] }) });
    command({ agent: sub, equipment: tr, name: "tap.lower", type: "discrete", value: 2, interlock: interlock(sub, slug(tr, "tap_lower"), `TR${n} is above its bottom tap`, { gt: [id(tr, "tap"), 1] }) });

    const hvBay: Bay = { id: hv, kind: "trHv", bus: "hv", label: `TR${n} 138 kV bay`, cb: `${hv}.cb`, ds: `${hv}.ds`, transformer: tr };
    plant.bays.push(hvBay);
    label(hv, hvBay.label);
    bayMeasurements(hv, ["i_a"]);
    breaker(hvBay.cb, hv, `TR${n} 138 kV breaker`, SWITCH.closed, { description: `Close the TR${n} 138 kV breaker only in remote` });
    disconnector(hvBay.ds, hvBay.cb, hv, `TR${n} 138 kV disconnector`, SWITCH.closed);

    const lvBay: Bay = { id: lv, kind: "incomer", bus: lvBus, label: `TR${n} incomer`, cb: `${lv}.cb`, ds: `${lv}.ds`, transformer: tr };
    plant.bays.push(lvBay);
    label(lv, lvBay.label);
    bayMeasurements(lv, ["p_mw", "q_mvar", "i_a"]);
    breaker(lvBay.cb, lv, `TR${n} incomer breaker`, SWITCH.closed, {
      description: `Close the TR${n} incomer only in remote with TR${n} energized from 138 kV`,
      extra: [eq(id(hvBay.cb, "pos"), SWITCH.closed)],
    });
    disconnector(lvBay.ds, lvBay.cb, lv, `TR${n} incomer disconnector`, SWITCH.closed);
  }

  // ── bus coupler ───────────────────────────────────────────────────────────
  {
    const bay = "vds.sub.mv.bc";
    const b: Bay = { id: bay, kind: "coupler", bus: "a", label: "Bus coupler", cb: `${bay}.cb`, ds: `${bay}.ds_a`, dsB: `${bay}.ds_b` };
    plant.bays.push(b);
    label(bay, b.label);
    bayMeasurements(bay, ["p_mw", "i_a"]);
    breaker(b.cb, bay, "Bus coupler breaker", SWITCH.open, {
      description: "Close the bus coupler only with both disconnectors closed and one incomer open (no transformer paralleling)",
      extra: [
        eq(id(b.ds, "pos"), SWITCH.closed),
        eq(id(b.dsB as string, "pos"), SWITCH.closed),
        { or: [eq(id("vds.sub.mv.a.tr1.cb", "pos"), SWITCH.open), eq(id("vds.sub.mv.b.tr2.cb", "pos"), SWITCH.open)] },
      ],
    });
    disconnector(b.ds, b.cb, bay, "Bus coupler disconnector A", SWITCH.closed);
    disconnector(b.dsB as string, b.cb, bay, "Bus coupler disconnector B", SWITCH.closed);
  }

  // ── feeders, aux, spare ───────────────────────────────────────────────────
  for (let f = 1; f <= FEEDERS; f++) {
    const bus: BusId = f <= 2 ? "a" : "b";
    const bay = `vds.sub.mv.${bus}.f${f}`;
    const b: Bay = { id: bay, kind: "feeder", bus, label: `Feeder F${f}`, cb: `${bay}.cb`, ds: `${bay}.ds`, es: `${bay}.es` };
    plant.bays.push(b);
    label(bay, b.label);
    bayMeasurements(bay, ["p_mw", "q_mvar", "i_a", "v_kv"]);
    breaker(b.cb, bay, `F${f} circuit breaker`, SWITCH.closed, {
      description: `Close the F${f} breaker only in remote with its earthing switch open`,
      extra: [eq(id(b.es as string, "pos"), SWITCH.open)],
    });
    disconnector(b.ds, b.cb, bay, `F${f} disconnector`, SWITCH.closed);
    earthing(b.es as string, b.cb, b.ds, id(bay, "v_kv"), `F${f} earthing switch`);
  }
  {
    const bay = "vds.sub.mv.a.aux";
    const b: Bay = { id: bay, kind: "aux", bus: "a", label: "Auxiliary transformer 34.5/0.38 kV", cb: `${bay}.cb`, ds: `${bay}.ds` };
    plant.bays.push(b);
    label(bay, b.label);
    bayMeasurements(bay, ["p_mw", "i_a"]);
    breaker(b.cb, bay, "Aux breaker", SWITCH.closed, { description: "Close the aux breaker only in remote" });
    disconnector(b.ds, b.cb, bay, "Aux disconnector", SWITCH.closed);
  }
  {
    const bay = "vds.sub.mv.b.spare";
    const b: Bay = { id: bay, kind: "spare", bus: "b", label: "Spare bay", cb: `${bay}.cb`, ds: `${bay}.ds` };
    plant.bays.push(b);
    label(bay, b.label);
    breaker(b.cb, bay, "Spare breaker", SWITCH.open, { description: "Close the spare breaker only in remote" });
    disconnector(b.ds, b.cb, bay, "Spare disconnector", SWITCH.open);
  }

  // ── wind farm ─────────────────────────────────────────────────────────────
  point(wf, "vds.wf.met", "wind_ms", "analogical", 9, ["wind"]);
  point(wf, "vds.wf.met", "wind_dir", "analogical", 135, ["wind"]);
  label("vds.wf.met", "Met mast");
  for (let f = 1; f <= FEEDERS; f++) {
    const area = `vds.wf.f${f}`;
    label(area, `Feeder F${f} turbines`);
    for (let k = 1; k <= turbinesPerFeeder; k++) {
      const number = (f - 1) * turbinesPerFeeder + k;
      const t = `${area}.t${pad(number)}`;
      const feeder = `vds.sub.mv.${f <= 2 ? "a" : "b"}.f${f}`;
      plant.turbines.push({ id: t, number, label: `WTG ${pad(number)}`, feeder });
      label(t, `WTG ${pad(number)}`);

      point(wf, t, "state", "discrete", TURBINE.producing, ["turbine"]);
      point(wf, t, "avail", "discrete", 1, ["turbine"]);
      point(wf, t, "comm", "discrete", 1, ["turbine", "comms"]);
      point(wf, t, "fault_code", "discrete", 0, ["turbine"]);
      for (const [name, init] of [
        ["p_kw", 0], ["q_kvar", 0], ["wind_ms", 9], ["wind_dir", 135], ["rotor_rpm", 0], ["pitch_deg", 0],
        ["yaw_deg", 135], ["gen_temp", 70], ["gbx_temp", 60], ["curtail_sp", RATED_KW],
      ] as const) {
        point(wf, t, name, "analogical", init, ["turbine"]);
      }

      alarm(wf, {
        type: "discrete",
        name: slug(t, "state"),
        area,
        meas: id(t, "state"),
        conditions: [{ id: "fault", value: TURBINE.fault, state: "Set", severity: "high" }],
      });
      alarm(wf, { type: "digital", name: slug(t, "comm"), area, meas: id(t, "comm"), set: 0, reset: 1, severity: "low" });
      limitAlarm(wf, t, "gbx_temp", area, { high: { value: 80, severity: "low", deadband: 3 } });
      limitAlarm(wf, t, "gen_temp", area, {
        high: { value: 130, severity: "medium", deadband: 3 },
        high_high: { value: 150, severity: "high", deadband: 3 },
      });

      const notFault = interlock(wf, slug(t, "start"), `Start WTG ${pad(number)} only when it is not in fault`, { ne: [id(t, "state"), TURBINE.fault] });
      const inFault = interlock(wf, slug(t, "reset"), `Reset WTG ${pad(number)} only when it is in fault`, eq(id(t, "state"), TURBINE.fault));
      command({ agent: wf, equipment: t, name: "start", type: "discrete", value: 1, interlock: notFault });
      command({ agent: wf, equipment: t, name: "stop", type: "discrete", value: 0 });
      command({ agent: wf, equipment: t, name: "reset", type: "discrete", value: 1, interlock: inFault });
      command({ agent: wf, equipment: t, name: "curtail.setpoint", type: "analogical" });
    }
  }

  return plant;
}

/** Driver path of a measurement or command: also its `/addr/{path}` on the REST agent. */
export function driverPath(equipment: string, name: string): string {
  return `${equipment}.${name}`;
}
