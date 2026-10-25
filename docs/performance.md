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

The target holds with four times the load to spare. A development build (React
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

## Running the bench

1. `npm run dev` (or `dev:mock`), sign in, and open **Performance bench** in
   the footer.
2. Pick the number of points and the rate, then press **Run 20 s**. The first
   second is left out of the frame statistics.
3. For real numbers, use a production build. The `demo-mock-prod` preview in
   `.claude/launch.json` builds the mock app and serves it on port 4174, or run:

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
