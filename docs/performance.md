# Performance

Target: **1,000+ points on one screen, each updating at 1 Hz, with no jank**
(steady 60 fps, no long tasks), on the demo's 1920 × 1080 display.

## Results

Measured with the performance bench (`#perf`, linked from the footer) in a
production build, in Chromium, on 2026-10-25. Each point updates at the chosen
rate with its own phase, through the mock backend and a point store exactly
as the screens use them. Each cell is an `AnalogValue` plus an `AnalogBar`.

| Points × rate | Updates | Frame rate | Frame gap p95 / max | Long tasks |
|---|---|---|---|---|
| 1,000 × 1 Hz | 1,000/s | 60 fps | 18.0 / 18.7 ms | 0 |
| 2,000 × 2 Hz | 4,000/s | 55 fps | 33.1 / 35.4 ms | 0 |

Through the hub (the simulator's perf generator → wind farm REST agent →
local hub → GraphQL subscription), production build, same machine:

| Points × rate | Shown | Frame rate | Frame gap p95 / max | Long tasks | Latency p50 / p95 / max |
|---|---|---|---|---|---|
| 1,000 × 1 Hz | 998/s | 60 fps | 17.4 / 17.8 ms | 0 | 25 / 38 / 61 ms |
| 2,000 × 2 Hz | 4,004/s | 41 fps | 34.0 / 50.2 ms | 0 | 58 / 76 / 126 ms |

Latency runs from the moment the generator produced a value to the frame that
drew it. UI only it is about 16 ms at the median (the generator's 20 ms tick
plus up to one frame), so the agent, the hub and the WebSocket add roughly
10 ms at the target load. At four times the load nothing is lost and there are
still no long tasks, but frames drop to 41 fps (55 UI only): handling several
thousand subscription messages a second takes main-thread time of its own.

The target holds with four times the load to spare in the UI, and end to end
with every update delivered. A development build (React
StrictMode, profiler on) is slower: 1,000 × 1 Hz holds 59 fps, with React
spending about 105 ms per second rendering.

## Why it holds

- **One subscription per screen.** The point store merges what every
  component watches into one `measByPaths` subscription, debounced when the
  set changes, and closes the old one only after the new one has opened, so
  there's no gap.
- **One notification per frame.** Incoming values are cached per point and
  listeners are told once per animation frame, so 1,000 messages a second
  cost about 60 render passes, not 1,000.
- **Per-point components.** `usePoint` subscribes a component to its point
  only, so a value change re-renders that value, not the screen.
- **Set lookups for paths.** Watching thousands of single points used to
  compare every message against every watched path, and compare every watched
  path with every other on each change. Both now look exact paths up in a set
  and compare against wildcard patterns only (`pathMatcher`,
  `reducePatterns`). That took 2,000 × 2 Hz from 2 fps to the numbers above.
- **History is reduced before drawing.** Trends fetch long ranges in chunks
  and reduce each series to about 600 points while keeping peaks.

## Two modes

| Mode | Path of a value | What it measures |
|---|---|---|
| **UI only** | a generator in the page → mock backend → point store → React → widgets | The HMI alone: the point store, rendering and widgets. Works without a hub. |
| **Through the hub** | the simulator's perf generator → wind farm REST agent → hub → GraphQL subscription over WebSocket → point store → React → widgets | The whole chain, as a screen gets its values. |

Both use the same generator (`sim/src/perf.ts`): every point has its own phase
in the period and carries the time it was produced. That gives the bench its
**latency**, from a value's timestamp to the frame that drew it. UI only is
the baseline for the in-page part (about 16 ms at the median: the generator's
20 ms tick plus up to one frame).

The hub mode needs the **perf variant of the agent config** uploaded:
`sim/site-config/vds-agents.perf.yaml`. It's the normal config plus 2,000
points `perf.p0000::v` … `perf.p1999::v` on the wind farm agent, not stored in
history, so a run doesn't write thousands of rows a second. Upload the normal
`vds-agents.yaml` again to remove them. The simulator sends the perf values
through a publisher of their own, so they never hold back plant values. If the
agent refuses them because the config isn't uploaded, the bench says no values
arrived, and the plant keeps running.

## Running the bench

1. `npm run dev` (or `dev:mock`), sign in, and open **Performance bench** in
   the footer.
2. Pick **UI only** or **Through the hub** (hub runs need the perf config
   above and the simulator from `sim/`), the number of points and the rate,
   then press **Run 20 s**. The first 1.5 s are left out of the statistics.
   Keep the page in view: a hidden page gets almost no frames, and the bench
   flags such a run.
3. For real numbers, use a production build. In `.claude/launch.json`,
   `demo-mock-prod` builds the mock app and serves it on port 4174 (UI only),
   and `demo-hub-prod` builds the hub app and serves it on 5173, the
   registered redirect URI, so both modes work. Or run:

```bash
cd apps/demo-electrical && VITE_HMI_BACKEND=mock npx vite build --outDir dist-mock && npx vite preview --outDir dist-mock --port 4174
```

React render time is only measured in development builds; production React
has the profiler compiled out.

## Guidance for your screens

- Bind each value in its own small component (`usePoint`). Reserve
  `usePointValues` for logic that needs a whole set at once, such as the
  single-line's energization or an overview total.
- Wrap repeated cells in `memo`, so a parent's re-render doesn't redraw them.
- Keep alarm-driven lookups indexed (`useEquipmentAlarms` builds its index
  once per alarm change, not per symbol).
- Watch the bench's long-task count when you add widgets: any long task is a
  visible stutter on an operator display.
