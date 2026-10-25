import { AlarmHistoryList } from "@khorde/hmi-react";
import { useMemo, useState } from "react";

const RANGES = [
  { id: "1h", label: "Last hour", ms: 3600e3 },
  { id: "8h", label: "Last 8 h", ms: 8 * 3600e3 },
  { id: "24h", label: "Last 24 h", ms: 24 * 3600e3 },
] as const;

const AREAS = [
  { id: "all", label: "All areas", areas: undefined },
  { id: "sub", label: "Substation", areas: ["vds.sub.>"] },
  { id: "wf", label: "Wind farm", areas: ["vds.wf.>"] },
] as const;

/** L4: every alarm change in a time range, read-only. The range is fixed when picked, not sliding. */
export function EventsScreen() {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("1h");
  const [area, setArea] = useState<(typeof AREAS)[number]["id"]>("all");
  const [now, setNow] = useState(() => Date.now());
  const ms = RANGES.find((r) => r.id === range)?.ms ?? 3600e3;
  const span = useMemo(() => ({ from: new Date(now - ms), to: new Date(now + 60e3) }), [now, ms]);
  const filter = useMemo(() => {
    const areas = AREAS.find((a) => a.id === area)?.areas;
    return areas ? { areas: [...areas] } : {};
  }, [area]);
  const pick = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setNow(Date.now());
  };
  return (
    <div className="page">
      <section className="page-panel page-wide">
        <div className="events-bar">
          <h2 className="eyebrow">Event log</h2>
          <div className="kh-seg" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => pick(setRange)(r.id)}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="kh-seg" role="group" aria-label="Area">
            {AREAS.map((a) => (
              <button key={a.id} type="button" aria-pressed={area === a.id} onClick={() => pick(setArea)(a.id)}>
                {a.label}
              </button>
            ))}
          </div>
          <button type="button" className="kh-btn kh-btn--sm" onClick={() => setNow(Date.now())}>
            Refresh
          </button>
        </div>
        <AlarmHistoryList from={span.from} to={span.to} filter={filter} />
      </section>
    </div>
  );
}
