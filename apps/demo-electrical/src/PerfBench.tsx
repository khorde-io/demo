/**
 * A development bench for the performance target: N analog points, each
 * updating at a given rate with its own phase, drawn with the library's
 * widgets inside the real shell. Two modes:
 *
 * - **UI only**: the values come from a private mock backend in the page, so
 *   this measures the point store, React and the widgets, nothing else.
 * - **Through the hub**: the simulator's perf generator posts the values to
 *   the REST agent, and they reach the page through the hub's GraphQL
 *   subscription like any screen's. Needs the perf variant of the agent
 *   config uploaded (`sim/site-config/vds-agents.perf.yaml`).
 *
 * Either mode can add an alarm flood: alarms raised and returned in turn, shown
 * in the real alarm list, unacknowledged until the run ends.
 *
 * It reports frame rate, frame gaps, long tasks, updates that reached the
 * screen, and the latency from each value's timestamp to the frame it was
 * drawn in, and the same for alarm changes.
 */

import { createAlarmStore, createPointStore, pointId, type PointId } from "@khorde/hmi-core";
import { createMockBackend } from "@khorde/hmi-core/mock";
import { createPerfGenerator, perfEquipment, PERF_ALARM_PERIOD_MS, PERF_ALARMS, PERF_POINTS } from "@khorde/demo-plant/perf";
import { AlarmList, AnalogBar, AnalogValue, HmiProvider, useHmi, usePoint } from "@khorde/hmi-react";
import { Profiler, memo, useEffect, useMemo, useRef, useState } from "react";
import { ackPerfAlarms, createAlarmFeed, createAlarmTally, isPerfAlarmAddr } from "./perfAlarms.ts";

const SIZES = [0, 500, 1000, 2000] as const;
const ALARM_COUNTS = [0, 50, 200, PERF_ALARMS] as const;
const RUN_MS = 20_000;
/** Left out of the statistics: mounting and the first fill are not steady state. */
const WARMUP_MS = 1_500;
/** Time for the last changes of a run to reach the list before they are acknowledged. */
const SETTLE_MS = 2_000;

export type BenchMode = "ui" | "hub";

interface Latency {
  p50: number;
  p95: number;
  max: number;
}

interface Result {
  mode: BenchMode;
  points: number;
  hz: number;
  alarms: number;
  /** Values the generator produced, per second (UI only; the simulator counts its own). */
  sentPerS: number | null;
  /** Point changes that reached the screen, per second. */
  shownPerS: number;
  fps: number;
  p95Gap: number;
  maxGap: number;
  longTasks: number;
  longTaskMs: number;
  /** Value timestamp → frame it was drawn in, ms. */
  latency: Latency | null;
  /** Alarm changes the run should produce, per second. */
  alarmChangesPerS: number;
  /** Alarm changes that reached the list, per second. */
  alarmShownPerS: number;
  /** Change timestamp → frame it was listed in, ms. */
  alarmLatency: Latency | null;
  /** The most bench alarms listed at once. */
  alarmsListed: number;
  renderMsPerS: number;
  problem: string | null;
}

const Cell = memo(function Cell({ id, n }: { id: PointId; n: number }) {
  const v = usePoint(id);
  const value = typeof v?.value === "number" ? v.value : null;
  return (
    <div className="perf-cell">
      <span className="perf-name">P{String(n).padStart(4, "0")}</span>
      <AnalogValue value={value} unit="MW" decimals={1} quality={v?.quality ?? "bad"} size="sm" />
      <AnalogBar value={value} min={0} max={100} normal={[10, 90]} label={`Point ${n}`} />
    </div>
  );
});

function Load({ ids, showAlarms, onRender }: { ids: PointId[]; showAlarms: boolean; onRender: (ms: number) => void }) {
  return (
    <Profiler id="perf-load" onRender={(_id, _phase, actual) => onRender(actual)}>
      {showAlarms && (
        <div className="perf-alarms">
          <AlarmList />
        </div>
      )}
      <div className="perf-grid">
        {ids.map((id, i) => (
          <Cell key={id} id={id} n={i + 1} />
        ))}
      </div>
    </Profiler>
  );
}

const percentile = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number;
};
const round1 = (x: number) => Math.round(x * 10) / 10;
const latencyOf = (xs: readonly number[]): Latency | null => {
  if (xs.length === 0) return null;
  const list = [...xs];
  return { p50: Math.round(percentile(list, 50)), p95: Math.round(percentile(list, 95)), max: Math.round(list.reduce((a, b) => Math.max(a, b), 0)) };
};
const latencyText = (l: Latency | null) => (l ? `p50 ${l.p50} ms · p95 ${l.p95} ms · max ${l.max} ms` : "–");
/** The REST agent's driver path (`perf.p0001.v`) as a point id. */
const idOfAddr = (addr: string) => pointId(addr.slice(0, addr.lastIndexOf(".")), addr.slice(addr.lastIndexOf(".") + 1));

async function sim(simUrl: string, path: string, body: unknown) {
  const res = await fetch(`${simUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
}

export function PerfBench({ hubAvailable, simUrl }: { hubAvailable: boolean; simUrl: string }) {
  const outer = useHmi();
  const [mode, setMode] = useState<BenchMode>("ui");
  const [size, setSize] = useState<number>(1000);
  const [hz, setHz] = useState(1);
  const [alarmCount, setAlarmCount] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [left, setLeft] = useState(0);
  const renderMs = useRef(0);

  const ids = useMemo(() => Array.from({ length: size }, (_, i) => pointId(perfEquipment(i), "v")), [size]);
  // UI only: a backend and store private to the bench, which go with it (no disposing needed,
  // and disposing in an effect cleanup would break under React's development double mount).
  // Through the hub: the app's own services, so values take the screens' path.
  const local = useMemo(() => {
    const backend = createMockBackend({ points: ids.map((id) => ({ equipment: id.split("::")[0] as string, name: "v", type: "analogical" as const, value: 50 })) });
    return { backend, points: createPointStore(backend), alarms: createAlarmStore(backend) };
  }, [ids]);
  const services = useMemo(() => (mode === "hub" ? outer : { ...outer, ...local }), [mode, outer, local]);

  // Through the hub, one pattern covers every cell, so the store opens one small subscription.
  useEffect(() => (mode === "hub" ? outer.points?.watch(["perf.>"]) : undefined), [mode, outer]);

  // The app starts its own alarm store; the private one starts here.
  useEffect(() => {
    void local.alarms.start();
    return () => local.alarms.stop();
  }, [local]);

  useEffect(() => {
    if (!running) return;
    const points = services.points;
    const alarmStore = services.alarms;
    if (!points) return;
    const start = performance.now();
    const wallStart = Date.now();
    let problem: string | null = null;

    // The source: in the page, or the simulator through the REST agent and the hub.
    let sent: number | null = null;
    let gen: ReturnType<typeof setInterval> | null = null;
    const generator = createPerfGenerator({ max: PERF_POINTS });
    const feedAlarm = createAlarmFeed(local.backend);
    if (mode === "ui") {
      generator.start(ids.length, hz, alarmCount);
      gen = setInterval(() => {
        for (const r of generator.tick(Date.now())) {
          if (isPerfAlarmAddr(r.addr)) feedAlarm(r);
          else local.backend.publish(idOfAddr(r.addr), r.value, { timestamp: new Date(r.at) });
        }
        sent = generator.status()?.sent ?? 0;
      }, 20);
    } else {
      sim(simUrl, "/perf/start", { points: ids.length, hz, alarms: alarmCount }).catch((e: unknown) => {
        problem = `Could not start the simulator's perf generator at ${simUrl}: ${e instanceof Error ? e.message : String(e)}`;
      });
    }

    // What reaches the screen: every change the store hands to the cells, and how old it is.
    let shown = 0;
    const latencies: number[] = [];
    const offs = ids.map((id) =>
      points.subscribe(id, () => {
        const ts = points.get(id).timestamp;
        if (!ts || Date.now() - wallStart < WARMUP_MS) return;
        shown++;
        if (latencies.length < 200_000) latencies.push(Date.now() - ts.getTime());
      }),
    );

    // The list is drawn when a change arrives, so what it holds in a frame is what that frame shows.
    const tally = createAlarmTally();
    let lastList: unknown = null;

    const gaps: number[] = [];
    let frames = 0;
    let prev = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      if (t - start > WARMUP_MS) {
        gaps.push(t - prev);
        frames++;
      }
      const list = alarmCount > 0 ? alarmStore?.get().alarms : undefined;
      if (list && list !== lastList) {
        lastList = list;
        tally.observe(list, t - start > WARMUP_MS);
      }
      prev = t;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    let longTasks = 0;
    let longTaskMs = 0;
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.startTime - start < WARMUP_MS) continue;
          longTasks++;
          longTaskMs += e.duration;
        }
      });
      observer.observe({ type: "longtask", buffered: false });
    } catch {
      observer = null; // not supported: reported as 0
    }

    // A page in the background gets almost no frames: such a run measures the browser, not the HMI.
    let hidden = document.visibilityState === "hidden";
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hidden = true;
    };
    document.addEventListener("visibilitychange", onVisibility);

    renderMs.current = 0;
    const countdown = setInterval(() => setLeft(Math.max(0, Math.ceil((RUN_MS - (performance.now() - start)) / 1000))), 500);
    const stop = setTimeout(() => setRunning(false), RUN_MS);
    return () => {
      if (gen) clearInterval(gen);
      if (mode === "hub") void sim(simUrl, "/perf/stop", {}).catch(() => {});
      else {
        generator.stop();
        for (const r of generator.drain() ?? []) feedAlarm(r);
      }
      for (const off of offs) off();
      clearInterval(countdown);
      clearTimeout(stop);
      cancelAnimationFrame(raf);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      const elapsed = (performance.now() - start) / 1000;
      const steady = elapsed - WARMUP_MS / 1000;
      if (!problem && mode === "hub" && shown === 0) {
        problem = "No values arrived. Is the perf variant of the agent config uploaded, and is the simulator running?";
      }
      if (!problem && mode === "hub" && alarmCount > 0 && tally.shown === 0) {
        problem = "No alarm changes arrived. Is the current perf variant of the agent config uploaded, and is the simulator up to date? If the alarm list can't read the active alarms, the hub doesn't have the active alarm API.";
      }
      const fps = frames / steady;
      // Few frames with long tasks is the load itself, which is what the bench is there to show.
      if (hidden || (fps < 20 && longTaskMs < 1000)) {
        const note = "The browser drew few frames, so the page was probably hidden or behind another window: run it again with the page in view.";
        problem = problem ? `${problem} ${note}` : note;
      }
      setResult({
        mode,
        points: ids.length,
        hz,
        sentPerS: sent === null ? null : Math.round(sent / elapsed),
        shownPerS: Math.round(shown / steady),
        fps: Math.round(fps),
        p95Gap: round1(percentile(gaps, 95)),
        maxGap: round1(Math.max(0, ...gaps)),
        longTasks,
        longTaskMs: Math.round(longTaskMs),
        latency: latencyOf(latencies),
        alarms: alarmCount,
        alarmChangesPerS: Math.round((alarmCount * 1000) / PERF_ALARM_PERIOD_MS),
        alarmShownPerS: Math.round(tally.shown / steady),
        alarmLatency: latencyOf(tally.latencies),
        alarmsListed: tally.peak,
        renderMsPerS: round1(renderMs.current / steady),
        problem,
      });

      // Leave the alarm list as the run found it. The hub keeps the journal rows.
      if (alarmCount > 0 && alarmStore) {
        setClearing(true);
        setTimeout(() => {
            void ackPerfAlarms(alarmStore)
              .then((refused) => {
                if (refused === 0) return;
                const note = `${refused} bench alarms could not be acknowledged. They stay in the alarm list until someone allowed to acknowledge does.`;
                setResult((r) => r && { ...r, problem: r.problem ? `${r.problem} ${note}` : note });
              })
              .finally(() => setClearing(false));
        }, SETTLE_MS);
      }
    };
  }, [running, mode, hz, alarmCount, ids, services, local, simUrl]);

  const busy = running || clearing;
  const seg = <T,>(label: string, options: readonly { id: T; text: string; disabled?: boolean }[], value: T, set: (v: T) => void) => (
    <div className="kh-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" aria-pressed={value === o.id} disabled={busy || o.disabled} onClick={() => set(o.id)}>
          {o.text}
        </button>
      ))}
    </div>
  );

  return (
    <div className="page">
      <section className="page-panel page-wide">
        <div className="events-bar">
          <h2 className="eyebrow">Performance bench</h2>
          {seg<BenchMode>("Source", [{ id: "ui", text: "UI only" }, { id: "hub", text: "Through the hub", disabled: !hubAvailable }], mode, setMode)}
          {seg<number>("Points", SIZES.map((n) => ({ id: n, text: n === 0 ? "No values" : `${n} points` })), size, setSize)}
          {seg<number>("Rate", [{ id: 1, text: "1 Hz" }, { id: 2, text: "2 Hz" }], hz, setHz)}
          {seg<number>("Alarms", ALARM_COUNTS.map((n) => ({ id: n, text: n === 0 ? "No alarms" : `${n} alarms` })), alarmCount, setAlarmCount)}
          <button type="button" className="kh-btn kh-btn--primary" disabled={busy || size + alarmCount === 0} onClick={() => setRunning(true)}>
            {running ? `Running… ${left} s` : clearing ? "Clearing alarms…" : `Run ${RUN_MS / 1000} s`}
          </button>
        </div>
        {result && (
          <>
            {result.problem && (
              <p className="note perf-problem" role="alert">
                {result.problem}
              </p>
            )}
            <dl className="detail-facts perf-result" aria-live="polite">
              <dt>Run</dt>
              <dd className="num">
                {result.points} × {result.hz} Hz{result.alarms > 0 ? `, ${result.alarms} alarms` : ""}, {result.mode === "ui" ? "UI only" : "through the hub"}
              </dd>
              <dt>Updates</dt>
              <dd className="num">
                {result.sentPerS !== null ? `${result.sentPerS} /s sent · ` : ""}
                {result.shownPerS} /s shown
              </dd>
              <dt>Latency</dt>
              <dd className="num">{latencyText(result.latency)}</dd>
              {result.alarms > 0 && (
                <>
                  <dt>Alarm changes</dt>
                  <dd className="num">
                    {result.alarmChangesPerS} /s expected · {result.alarmShownPerS} /s shown
                  </dd>
                  <dt>Alarm latency</dt>
                  <dd className="num">{latencyText(result.alarmLatency)}</dd>
                  <dt>Alarms listed</dt>
                  <dd className="num">{result.alarmsListed} at the peak</dd>
                </>
              )}
              <dt>Frame rate</dt>
              <dd className="num">{result.fps} fps</dd>
              <dt>Frame gap</dt>
              <dd className="num">
                p95 {result.p95Gap} ms · max {result.maxGap} ms
              </dd>
              <dt>Long tasks</dt>
              <dd className="num">
                {result.longTasks} ({result.longTaskMs} ms)
              </dd>
              <dt>React render</dt>
              <dd className="num">{import.meta.env.PROD ? "not measured in a production build" : `${result.renderMsPerS} ms per second`}</dd>
            </dl>
          </>
        )}
        <p className="note">
          {mode === "ui"
            ? "UI only: values come from a mock backend in this page, through a point store like the screens use."
            : `Through the hub: the simulator (${simUrl}) posts the values to the wind farm REST agent; they arrive over the hub's GraphQL subscription. Needs sim/site-config/vds-agents.perf.yaml uploaded.`}{" "}
          Latency runs from each value's timestamp to the frame that drew it. A change shown counts once per frame, however many values arrived.
          {alarmCount > 0 && ` Each alarm changes state every ${PERF_ALARM_PERIOD_MS / 1000} s and nobody acknowledges them during the run, so the list keeps growing; they are acknowledged when it ends.`}
        </p>
      </section>
      <HmiProvider hmi={services}>
        <Load ids={ids} showAlarms={alarmCount > 0} onRender={(ms) => (renderMs.current += ms)} />
      </HmiProvider>
    </div>
  );
}
