/**
 * A development bench for the performance target: N analog points, each
 * updating at a given rate with its own phase, drawn with the library's
 * widgets inside the real shell. It runs on its own mock backend and point
 * store, so it works the same with or without a hub, and reports frame rate,
 * frame gaps, long tasks and React render time.
 */

import { createPointStore, pointId, type PointId } from "@khorde/hmi-core";
import { createMockBackend } from "@khorde/hmi-core/mock";
import { AnalogBar, AnalogValue, HmiProvider, useHmi, usePoint } from "@khorde/hmi-react";
import { Profiler, memo, useEffect, useMemo, useRef, useState } from "react";

const SIZES = [500, 1000, 2000] as const;
const RUN_MS = 20_000;

interface Result {
  points: number;
  updatesPerS: number;
  fps: number;
  /** Frame-to-frame gaps, ms. */
  p95Gap: number;
  maxGap: number;
  longTasks: number;
  longTaskMs: number;
  /** React render time per second of wall time, ms. */
  renderMsPerS: number;
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

function Grid({ ids, onRender }: { ids: PointId[]; onRender: (ms: number) => void }) {
  return (
    <Profiler id="perf-grid" onRender={(_id, _phase, actual) => onRender(actual)}>
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

export function PerfBench() {
  const outer = useHmi();
  const [size, setSize] = useState<number>(1000);
  const [hz, setHz] = useState(1);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [left, setLeft] = useState(0);
  const renderMs = useRef(0);

  const ids = useMemo(() => Array.from({ length: size }, (_, i) => pointId(`perf.p${i}`, "v")), [size]);
  // The backend and store are private to the bench, so they need no disposing: they go with it.
  // (Disposing in an effect cleanup would break under React's development double mount.)
  const services = useMemo(() => {
    const backend = createMockBackend({ points: ids.map((id) => ({ equipment: id.split("::")[0] as string, name: "v", type: "analogical" as const, value: 50 })) });
    return { ...outer, backend, points: createPointStore(backend) };
  }, [ids, outer]);

  useEffect(() => {
    if (!running) return;
    const { backend } = services;
    const period = 1000 / hz;
    // Each point gets its own phase in the period, like field devices.
    const phase = ids.map(() => Math.random() * period);
    const level = ids.map(() => 20 + Math.random() * 60);
    const start = performance.now();
    let sent = 0;
    let lastTick = start;
    const gen = setInterval(() => {
      const now = performance.now();
      ids.forEach((id, i) => {
        const p = phase[i] as number;
        // Due if a phase moment of this point fell within (lastTick, now].
        const due = Math.floor((now - start - p) / period) > Math.floor((lastTick - start - p) / period);
        if (!due) return;
        level[i] = Math.max(0, Math.min(100, (level[i] as number) + (Math.random() - 0.5) * 4));
        backend.publish(id, Number((level[i] as number).toFixed(1)));
        sent++;
      });
      lastTick = now;
    }, 20);

    const gaps: number[] = [];
    let frames = 0;
    let prev = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      gaps.push(t - prev);
      prev = t;
      frames++;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    let longTasks = 0;
    let longTaskMs = 0;
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          longTasks++;
          longTaskMs += e.duration;
        }
      });
      observer.observe({ type: "longtask", buffered: false });
    } catch {
      observer = null; // not supported: reported as 0
    }

    renderMs.current = 0;
    const countdown = setInterval(() => setLeft(Math.max(0, Math.ceil((RUN_MS - (performance.now() - start)) / 1000))), 500);
    const stop = setTimeout(() => setRunning(false), RUN_MS);
    return () => {
      clearInterval(gen);
      clearInterval(countdown);
      clearTimeout(stop);
      cancelAnimationFrame(raf);
      observer?.disconnect();
      const s = (performance.now() - start) / 1000;
      // Skip the first second: mounting and the first fill are not steady state.
      const steady = gaps.slice(60);
      setResult({
        points: ids.length,
        updatesPerS: Math.round(sent / s),
        fps: Math.round(frames / s),
        p95Gap: Math.round(percentile(steady, 95) * 10) / 10,
        maxGap: Math.round(Math.max(0, ...steady) * 10) / 10,
        longTasks,
        longTaskMs: Math.round(longTaskMs),
        renderMsPerS: Math.round((renderMs.current / s) * 10) / 10,
      });
    };
  }, [running, hz, ids, services]);

  return (
    <div className="page">
      <section className="page-panel page-wide">
        <div className="events-bar">
          <h2 className="eyebrow">Performance bench</h2>
          <div className="kh-seg" role="group" aria-label="Points">
            {SIZES.map((n) => (
              <button key={n} type="button" aria-pressed={size === n} disabled={running} onClick={() => setSize(n)}>
                {n} points
              </button>
            ))}
          </div>
          <div className="kh-seg" role="group" aria-label="Rate">
            {[1, 2].map((r) => (
              <button key={r} type="button" aria-pressed={hz === r} disabled={running} onClick={() => setHz(r)}>
                {r} Hz
              </button>
            ))}
          </div>
          <button type="button" className="kh-btn kh-btn--primary" disabled={running} onClick={() => setRunning(true)}>
            {running ? `Running… ${left} s` : `Run ${RUN_MS / 1000} s`}
          </button>
        </div>
        {result && (
          <dl className="detail-facts perf-result" aria-live="polite">
            <dt>Points</dt>
            <dd className="num">{result.points}</dd>
            <dt>Updates</dt>
            <dd className="num">{result.updatesPerS} /s</dd>
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
        )}
        <p className="note">Each point updates at the chosen rate with its own phase, through the mock backend and a point store like the screens use.</p>
      </section>
      <HmiProvider hmi={services}>
        <Grid ids={ids} onRender={(ms) => (renderMs.current += ms)} />
      </HmiProvider>
    </div>
  );
}
