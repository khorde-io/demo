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

### Alarm floods

The bench can add alarms to a run: each is raised and returned in turn, changing
state every 2 s, and nobody acknowledges them, so the active list keeps growing
as it does in a real flood. UI only, production build, headless Chrome, on
2026-11-04:

| Values | Alarms | Alarm changes | Listed at the end | Frame rate | Frame gap p95 / max | Long tasks | Alarm latency p50 / p95 / max |
|---|---|---|---|---|---|---|---|
| none | 50 | 25/s | 250 | 60 fps | 16.7 / 16.8 ms | 0 | 128 / 244 / 259 ms |
| none | 200 | 100/s | 1,000 | 60 fps | 16.7 / 16.8 ms | 0 | 131 / 245 / 257 ms |
| none | 500 | 250/s | 2,500 | 60 fps | 16.8 / 16.8 ms | 0 | 130 / 244 / 258 ms |
| 1,000 × 1 Hz | 200 | 100/s | 1,000 | 60 fps | 16.7 / 16.8 ms | 0 | 126 / 239 / 271 ms |
| 1,000 × 1 Hz | 500 | 250/s | 2,500 | 60 fps | 16.8 / 100 ms | 0 | 125 / 238 / 258 ms |

The target holds in a flood, and values updating alongside keep their 18 ms
median. Alarm latency is about 125 ms at the median by design: lists are
published at most every 250 ms. Before the list was paged and batched, 500
alarms gave 9 fps and 124 long tasks, and 1,000 × 1 Hz with 200 alarms gave
16 fps. Not yet measured through the hub.

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
- **The alarm list is drawn for a person.** However many alarms are active, it
  draws one page of 20, and the store publishes at most four lists a second
  (the first change after a quiet moment at once), merging what changed into
  the sorted list. Nobody can read a list that moves faster, so the operator
  loses nothing, and neither do the alarms: they're all in memory, and on the
  next pages, or first when sorted by urgency. While the pointer or keyboard is on the list, its rows don't
  move, so an Ack lands on the alarm being read.
- **History is reduced before drawing.** A trend fetches all its points in
  one paged query (5,000 rows a page, 200,000 at most, newest first) and
  reduces each series to about 600 points while keeping peaks.

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

The perf config also holds 500 digital alarms on `perfalarm.a0000::v` …
`perfalarm.a0499::v`. A hub run with alarms leaves its mark: the points aren't
stored, but **every raise, return and acknowledgement is a row in the hub's
alarm journal**, so a run adds to what the alarm history shows. When a run ends
the simulator returns its alarms to normal and the bench acknowledges them, so
the user needs the right to acknowledge; if they don't have it, the bench says
how many are left in the list. Latency uses the alarm's `stateAt`, so it only
covers the whole chain if the hub carries over the time the value was produced.

## Running the bench

1. `npm run dev` (or `dev:mock`), sign in, and open **Performance bench** in
   the footer.
2. Pick **UI only** or **Through the hub** (hub runs need the perf config
   above and the simulator from `sim/`), the number of points, the rate and
   the number of alarms, then press **Run 20 s**. **No values** with some
   alarms measures alarms alone. The first 1.5 s are left out of the statistics.
   Keep the page in view: a hidden page gets almost no frames, and the bench
   flags such a run.
3. For real numbers, use a production build. `npm run release` builds the hub
   app and serves it on 5173, the registered redirect URI, so both modes work.
   For UI only without a hub, build the mock app and serve it on port 4174:

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
- Don't draw every alarm: give a custom list pages too, and batch what it
  redraws. A flood is exactly when the screen has to keep working.
- Keep alarm-driven lookups indexed (`useEquipmentAlarms` builds its index
  once per alarm change, not per symbol).
- Watch the bench's long-task count when you add widgets: any long task is a
  visible stutter on an operator display.
