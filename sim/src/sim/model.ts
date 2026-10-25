/**
 * A physics-lite model of the plant: wind → turbine power → feeder and
 * transformer flows → line export, switch positions and energization,
 * transformer thermal behaviour and protection trips. Good enough to make the
 * HMI react the way a real plant would, not an engineering-grade simulation.
 */

import { CONTROL, RATED_KW, SWITCH, TURBINE, driverPath, type Bay, type Plant, type Transformer, type Turbine } from "../plant.ts";

export interface Sample {
  /** Driver path (the REST agent's join key). */
  addr: string;
  value: number;
  quality: boolean;
  type: "discrete" | "analogical";
}

export interface CommandRequest {
  equipment: string;
  name: string;
  /** Setpoint of an analogical command; null for discrete ones. */
  value: number | null;
}

export type CommandOutcome = { ok: true } | { ok: false; status: 404 | 409; message: string };

export const SCENARIOS = [
  "showcase",
  "normal",
  "tr1-trip",
  "oil-excursion",
  "feeder-trip",
  "turbine-fault",
  "comms-loss",
  "comms-restore",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface SimulationOptions {
  /** Seed for the random generator (reproducible runs). */
  seed?: number;
  /** Speeds up thermal time constants (e.g. 10 = ten times faster). */
  thermalSpeed?: number;
  /** Seconds a switch spends in "intermediate" while moving. */
  travelS?: number;
}

export interface Simulation {
  step(dtS: number): void;
  samples(): Sample[];
  command(req: CommandRequest): CommandOutcome;
  scenario(name: Scenario): void;
  /** Current value of a point (`equipment::name`). */
  get(id: string): number;
  /** Simulation time in seconds. */
  time(): number;
}

/** Deterministic PRNG (mulberry32) so tests and demos can be reproduced. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Reference power curve of the 4.5 MW turbine, in kW. */
export function powerCurve(windMs: number): number {
  if (windMs < 3 || windMs >= 25) return 0;
  if (windMs >= 10.2) return RATED_KW;
  return RATED_KW * ((windMs - 3) / 7.2) ** 1.8;
}

/** Thermal time constants of the transformers, seconds of plant time (before `thermalSpeed`). */
export const OIL_TAU_S = 1800;
export const WINDING_TAU_S = 300;

const SQRT3 = Math.sqrt(3);
const amps = (mw: number, kv: number) => (kv > 1 ? (Math.abs(mw) * 1000) / (SQRT3 * kv) : 0);

export function createSimulation(plant: Plant, options: SimulationOptions = {}): Simulation {
  const random = rng(options.seed ?? 42);
  const gauss = () => {
    const u = 1 - random();
    const v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const thermalSpeed = options.thermalSpeed ?? 1;
  const travelS = options.travelS ?? 0.5;

  const values = new Map<string, number>();
  const bad = new Set<string>();
  const types = new Map<string, "discrete" | "analogical">();
  for (const p of plant.points) {
    const id = `${p.equipment}::${p.name}`;
    values.set(id, p.initial);
    types.set(id, p.type);
  }

  const get = (id: string) => values.get(id) ?? 0;
  const set = (id: string, v: number) => {
    if (values.has(id)) values.set(id, v);
  };
  const closed = (sw: string | undefined) => !!sw && get(`${sw}::pos`) === SWITCH.closed;

  const bay = (id: string) => plant.bays.find((b) => b.id === id) as Bay;
  const line = plant.bays.find((b) => b.kind === "line") as Bay;
  const coupler = plant.bays.find((b) => b.kind === "coupler") as Bay;
  const aux = plant.bays.find((b) => b.kind === "aux") as Bay;
  const feeders = plant.bays.filter((b) => b.kind === "feeder");
  const switches = new Set(plant.bays.flatMap((b) => [b.cb, b.ds, b.dsB, b.es].filter((s): s is string => !!s)));
  const breakers = new Set(plant.bays.map((b) => b.cb));

  let t = 0;
  const pending: { at: number; run: () => void }[] = [];
  const wind = { mean: 9.4, speed: 9.2, dir: 135 };
  const turbineOffset = new Map(plant.turbines.map((tb) => [tb.id, (random() - 0.5) * 0.12] as const));
  const commsLost = new Set<string>();
  const extraHeat = new Map<string, number>(plant.transformers.map((tr) => [tr.id, 0] as const));
  const overloadS = new Map<string, number>(plant.transformers.map((tr) => [tr.id, 0] as const));

  const trip = (cb: string) => {
    set(`${cb}::pos`, SWITCH.open);
    set(`${cb}::trip`, 1);
  };

  const transformerLive = (tr: Transformer, hvLive: boolean) => {
    const hv = bay(tr.hvBay);
    return hvLive && closed(hv.cb) && closed(hv.ds) && get(`${tr.id}::buchholz`) === 0 && get(`${tr.id}::prv`) === 0;
  };

  // Protection: a gas or pressure-relief trip opens both sides of the transformer.
  const protect = (tr: Transformer) => {
    if (get(`${tr.id}::buchholz`) === 1 || get(`${tr.id}::prv`) === 1) {
      const hv = bay(tr.hvBay);
      const lv = bay(tr.lvBay);
      if (closed(hv.cb)) trip(hv.cb);
      if (closed(lv.cb)) trip(lv.cb);
    }
  };

  const turbineStep = (tb: Turbine, live: boolean, dt: number) => {
    const p = (n: string) => `${tb.id}::${n}`;
    if (commsLost.has(tb.id)) return; // values freeze; quality goes bad
    const local = Math.max(0, wind.speed * (1 + (turbineOffset.get(tb.id) ?? 0)) + gauss() * 0.3);
    let state = get(p("state"));
    if (state === TURBINE.waiting || state === TURBINE.producing || state === TURBINE.curtailed) {
      state = live && local >= 3 && local < 25 ? TURBINE.producing : TURBINE.waiting;
    }
    let kw = 0;
    if (state === TURBINE.producing) {
      kw = powerCurve(local) * (0.97 + random() * 0.03);
      const sp = get(p("curtail_sp"));
      if (sp < RATED_KW && kw > sp) {
        kw = sp;
        state = TURBINE.curtailed;
      }
    }
    set(p("state"), state);
    set(p("avail"), state === TURBINE.fault || state === TURBINE.stopped ? 0 : 1);
    set(p("p_kw"), +kw.toFixed(0));
    set(p("q_kvar"), +(kw * 0.05).toFixed(0));
    set(p("wind_ms"), +local.toFixed(1));
    set(p("wind_dir"), +((wind.dir + gauss() * 2 + 360) % 360).toFixed(0));
    set(p("yaw_deg"), +((wind.dir + gauss() * 1.5 + 360) % 360).toFixed(0));
    set(p("rotor_rpm"), +(kw > 0 ? 5 + 7 * Math.sqrt(kw / RATED_KW) : 0).toFixed(1));
    set(p("pitch_deg"), +(local > 10.2 && kw > 0 ? Math.min(25, (local - 10.2) * 2.4) : kw > 0 ? 0 : 88).toFixed(1));
    const load = kw / RATED_KW;
    const k = Math.min(1, dt / 120) * thermalSpeed;
    set(p("gen_temp"), +(get(p("gen_temp")) + (60 + 70 * load - get(p("gen_temp"))) * Math.min(1, k)).toFixed(1));
    set(p("gbx_temp"), +(get(p("gbx_temp")) + (52 + 26 * load - get(p("gbx_temp"))) * Math.min(1, k)).toFixed(1));
    return kw;
  };

  const step = (dt: number) => {
    t += dt;
    for (const job of pending.filter((j) => j.at <= t)) job.run();
    pending.splice(0, pending.length, ...pending.filter((j) => j.at > t));

    // Wind: slow drifting mean, mean-reverting speed with gusts, wandering direction.
    wind.mean = 9.4 + 1.8 * Math.sin((t / 3600) * 2 * Math.PI);
    wind.speed = Math.max(0, wind.speed + 0.05 * (wind.mean - wind.speed) * dt + 0.25 * Math.sqrt(dt) * gauss());
    wind.dir = (wind.dir + 0.2 * Math.sqrt(dt) * gauss() + 360) % 360;
    set("vds.wf.met::wind_ms", +wind.speed.toFixed(1));
    set("vds.wf.met::wind_dir", +wind.dir.toFixed(0));

    // Earthing a live circuit is a fault: its breaker trips.
    for (const f of [...feeders, line]) if (closed(f.es) && closed(f.cb)) trip(f.cb);
    for (const tr of plant.transformers) protect(tr);

    // Energization.
    const grid = closed(line.cb) && closed(line.ds) && !closed(line.es);
    const [tr1, tr2] = plant.transformers as [Transformer, Transformer];
    const live1 = transformerLive(tr1, grid);
    const live2 = transformerLive(tr2, grid);
    const in1 = live1 && closed(bay(tr1.lvBay).cb) && closed(bay(tr1.lvBay).ds);
    const in2 = live2 && closed(bay(tr2.lvBay).cb) && closed(bay(tr2.lvBay).ds);
    const tied = closed(coupler.cb) && closed(coupler.ds) && closed(coupler.dsB);
    const busLive = { hv: grid, a: in1 || (tied && in2), b: in2 || (tied && in1) };

    // Turbines and feeders.
    const feederMw = new Map<string, number>();
    for (const f of feeders) {
      const live = busLive[f.bus as "a" | "b"] && closed(f.cb) && closed(f.ds) && !closed(f.es);
      let kw = 0;
      for (const tb of plant.turbines.filter((x) => x.feeder === f.id)) kw += turbineStep(tb, live, dt) ?? 0;
      feederMw.set(f.id, live ? (kw / 1000) * 0.99 : 0);
    }
    const auxLive = busLive.a && closed(aux.cb) && closed(aux.ds);
    const auxMw = auxLive ? 0.3 + random() * 0.02 : 0;
    const exported = {
      a: feeders.filter((f) => f.bus === "a").reduce((s, f) => s + (feederMw.get(f.id) ?? 0), 0) - auxMw,
      b: feeders.filter((f) => f.bus === "b").reduce((s, f) => s + (feederMw.get(f.id) ?? 0), 0),
    };

    // Flows through the transformers.
    let trMw = [in1 ? exported.a : 0, in2 ? exported.b : 0];
    let couplerMw = 0;
    if (tied) {
      const total = (busLive.a ? exported.a : 0) + (busLive.b ? exported.b : 0);
      if (in1 && in2) trMw = [total / 2, total / 2];
      else if (in1) [trMw, couplerMw] = [[total, 0], exported.b];
      else if (in2) [trMw, couplerMw] = [[0, total], -exported.a];
      else trMw = [0, 0];
    }

    const busKv = (b: "a" | "b", tr: Transformer) =>
      busLive[b] ? 34.5 + (get(`${tr.id}::tap`) - 9) * 0.25 + 0.15 * (Math.abs(trMw[b === "a" ? 0 : 1] ?? 0) / 54) + gauss() * 0.03 : 0;
    const hvKv = grid ? 139.2 + gauss() * 0.1 : 0;
    const kv = { a: busKv("a", tied && !in1 ? tr2 : tr1), b: busKv("b", tied && !in2 ? tr1 : tr2) };
    set("vds.sub.hv.bus::v_kv", +hvKv.toFixed(1));
    set("vds.sub.mv.a::v_kv", +kv.a.toFixed(2));
    set("vds.sub.mv.b::v_kv", +kv.b.toFixed(2));

    for (const f of feeders) {
      const mw = feederMw.get(f.id) ?? 0;
      const v = busLive[f.bus as "a" | "b"] && closed(f.cb) && closed(f.ds) ? kv[f.bus as "a" | "b"] : 0;
      set(`${f.id}::p_mw`, +mw.toFixed(2));
      set(`${f.id}::q_mvar`, +(mw * 0.06).toFixed(2));
      set(`${f.id}::i_a`, +amps(mw, v).toFixed(0));
      set(`${f.id}::v_kv`, +v.toFixed(2));
    }
    set(`${aux.id}::p_mw`, +auxMw.toFixed(2));
    set(`${aux.id}::i_a`, +amps(auxMw, kv.a).toFixed(0));
    set(`${coupler.id}::p_mw`, +couplerMw.toFixed(2));
    set(`${coupler.id}::i_a`, +amps(couplerMw, (kv.a + kv.b) / 2).toFixed(0));

    plant.transformers.forEach((tr, i) => {
      const mw = trMw[i] ?? 0;
      const mva = Math.hypot(mw, mw * 0.06);
      const lv = bay(tr.lvBay);
      const hv = bay(tr.hvBay);
      set(`${lv.id}::p_mw`, +mw.toFixed(2));
      set(`${lv.id}::q_mvar`, +(mw * 0.06).toFixed(2));
      set(`${lv.id}::i_a`, +amps(mw, kv[lv.bus as "a" | "b"]).toFixed(0));
      set(`${hv.id}::i_a`, +amps(mw, hvKv).toFixed(0));

      // Thermal: first-order lags towards load-dependent targets. Oil is slow
      // (OIL_TAU_S), so gusts barely move it; the winding follows the load faster.
      const load = mva / tr.ratedMva;
      const target = 30 + 48 * load ** 2 + (extraHeat.get(tr.id) ?? 0);
      const lag = (tau: number) => Math.min(1, (dt / tau) * thermalSpeed);
      const oil = get(`${tr.id}::oil_temp`) + (target - get(`${tr.id}::oil_temp`)) * lag(OIL_TAU_S);
      const wdg = get(`${tr.id}::wdg_temp`) + (oil + 14 * load ** 1.6 - get(`${tr.id}::wdg_temp`)) * lag(WINDING_TAU_S);
      set(`${tr.id}::oil_temp`, +oil.toFixed(1));
      set(`${tr.id}::wdg_temp`, +wdg.toFixed(1));

      // Overload protection: above 110 % for 30 s trips the transformer.
      const over = load > 1.1 ? (overloadS.get(tr.id) ?? 0) + dt : 0;
      overloadS.set(tr.id, over);
      if (over >= 30) {
        if (closed(hv.cb)) trip(hv.cb);
        if (closed(lv.cb)) trip(lv.cb);
        overloadS.set(tr.id, 0);
      }
    });

    const lineMw = (trMw[0] ?? 0) + (trMw[1] ?? 0);
    set(`${line.id}::p_mw`, +(lineMw * 0.995).toFixed(2));
    set(`${line.id}::q_mvar`, +(-lineMw * 0.055).toFixed(2));
    set(`${line.id}::i_a`, +amps(lineMw, hvKv).toFixed(0));
    set(`${line.id}::v_kv`, +(139.2 + gauss() * 0.1).toFixed(1)); // line side: energized from the grid end
    set(`${line.id}::f_hz`, +(60 + gauss() * 0.01).toFixed(3));
  };

  const move = (sw: string, target: number) => {
    set(`${sw}::pos`, SWITCH.intermediate);
    pending.push({
      at: t + travelS,
      run: () => {
        set(`${sw}::pos`, target);
        if (breakers.has(sw) && target === SWITCH.closed) set(`${sw}::trip`, 0);
      },
    });
  };

  const command = (req: CommandRequest): CommandOutcome => {
    const { equipment, name } = req;
    const reject = (message: string): CommandOutcome => ({ ok: false, status: 409, message });

    if (switches.has(equipment) && (name === "pos.open" || name === "pos.close")) {
      const cb = plant.bays.find((b) => [b.cb, b.ds, b.dsB, b.es].includes(equipment))?.cb;
      if (cb && breakers.has(equipment) && get(`${cb}::remote_local`) !== CONTROL.remote) return reject("breaker in local control");
      const target = name === "pos.open" ? SWITCH.open : SWITCH.closed;
      if (get(`${equipment}::pos`) === target) return { ok: true };
      move(equipment, target);
      return { ok: true };
    }

    const tr = plant.transformers.find((x) => x.id === equipment);
    if (tr && (name === "tap.raise" || name === "tap.lower")) {
      const tap = get(`${tr.id}::tap`) + (name === "tap.raise" ? 1 : -1);
      if (tap < 1 || tap > 17) return reject("tap at end of range");
      set(`${tr.id}::tap`, tap);
      return { ok: true };
    }

    const tb = plant.turbines.find((x) => x.id === equipment);
    if (tb) {
      const p = (n: string) => `${tb.id}::${n}`;
      if (commsLost.has(tb.id)) return reject("no communication with turbine");
      switch (name) {
        case "start":
          if (get(p("state")) === TURBINE.fault) return reject("turbine in fault");
          set(p("state"), TURBINE.waiting);
          return { ok: true };
        case "stop":
          set(p("state"), TURBINE.stopped);
          return { ok: true };
        case "reset":
          if (get(p("state")) !== TURBINE.fault) return reject("turbine not in fault");
          set(p("state"), TURBINE.stopped);
          set(p("fault_code"), 0);
          return { ok: true };
        case "curtail.setpoint":
          if (req.value === null || !Number.isFinite(req.value)) return reject("setpoint missing");
          set(p("curtail_sp"), Math.max(0, Math.min(RATED_KW, req.value)));
          return { ok: true };
      }
    }
    return { ok: false, status: 404, message: `unknown command ${equipment} ${name}` };
  };

  const turbine = (n: number) => plant.turbines.find((x) => x.number === n);

  const scenario = (name: Scenario) => {
    switch (name) {
      case "showcase": {
        // The state shown in the mockups: one stopped, one faulted, one silent turbine, a warm TR2.
        const [stopped, faulted, silent] = [turbine(9), turbine(14), turbine(22)];
        if (stopped) set(`${stopped.id}::state`, TURBINE.stopped);
        if (faulted) {
          set(`${faulted.id}::state`, TURBINE.fault);
          set(`${faulted.id}::fault_code`, 1203);
        }
        if (silent) scenarioCommsLoss(silent.id);
        set("vds.sub.mv.a.f2.cb::sf6_low", 1);
        // TR2 runs warm (a cooling group out): oil 77–86 °C over the wind's hourly swing,
        // so its high alarm stays active, clear of the reset point and of high-high.
        extraHeat.set("vds.sub.tr2", 38);
        set("vds.sub.tr2::oil_temp", 80);
        break;
      }
      case "normal":
        for (const tb of plant.turbines) {
          commsLost.delete(tb.id);
          set(`${tb.id}::comm`, 1);
          set(`${tb.id}::fault_code`, 0);
          set(`${tb.id}::state`, TURBINE.waiting);
          set(`${tb.id}::curtail_sp`, RATED_KW);
        }
        bad.clear();
        for (const tr of plant.transformers) {
          extraHeat.set(tr.id, 0);
          set(`${tr.id}::buchholz`, 0);
          set(`${tr.id}::prv`, 0);
        }
        for (const b of plant.bays) {
          set(`${b.cb}::trip`, 0);
          set(`${b.cb}::sf6_low`, 0);
        }
        break;
      case "tr1-trip":
        set("vds.sub.tr1::buchholz", 1);
        break;
      case "oil-excursion":
        // Well past high-high (90 °C) within a few minutes.
        extraHeat.set("vds.sub.tr2", 58);
        break;
      case "feeder-trip": {
        const f3 = feeders.find((f) => f.id.endsWith(".f3"));
        if (f3 && closed(f3.cb)) trip(f3.cb);
        break;
      }
      case "turbine-fault": {
        const candidates = plant.turbines.filter((x) => get(`${x.id}::state`) === TURBINE.producing);
        const pick = candidates[Math.floor(random() * candidates.length)];
        if (pick) {
          set(`${pick.id}::state`, TURBINE.fault);
          set(`${pick.id}::fault_code`, 3100 + Math.floor(random() * 50));
        }
        break;
      }
      case "comms-loss": {
        const target = turbine(22) ?? plant.turbines.at(-1);
        if (target) scenarioCommsLoss(target.id);
        break;
      }
      case "comms-restore":
        for (const id of commsLost) {
          set(`${id}::comm`, 1);
          for (const k of [...bad]) if (k.startsWith(`${id}::`)) bad.delete(k);
        }
        commsLost.clear();
        break;
    }
  };

  function scenarioCommsLoss(turbineId: string) {
    commsLost.add(turbineId);
    set(`${turbineId}::comm`, 0);
    for (const p of plant.points) {
      const id = `${p.equipment}::${p.name}`;
      if (p.equipment === turbineId && p.name !== "comm") bad.add(id);
    }
  }

  return {
    step,
    command,
    scenario,
    get,
    time: () => t,
    samples: () =>
      [...values].map(([id, value]) => {
        const at = id.lastIndexOf("::");
        return {
          addr: driverPath(id.slice(0, at), id.slice(at + 2)),
          value,
          quality: !bad.has(id),
          type: types.get(id) ?? "analogical",
        };
      }),
  };
}
