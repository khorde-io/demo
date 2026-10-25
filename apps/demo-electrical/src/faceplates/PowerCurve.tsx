import { RATED_KW } from "@khorde/demo-plant";
import { powerCurve } from "@khorde/demo-plant/sim";

const W = 520;
const H = 180;
const PAD = { l: 44, r: 12, t: 12, b: 28 };
const MAX_WIND = 25;
const sx = (ms: number) => PAD.l + (ms / MAX_WIND) * (W - PAD.l - PAD.r);
const sy = (kw: number) => H - PAD.b - (kw / RATED_KW) * (H - PAD.t - PAD.b);
const CURVE = Array.from({ length: 101 }, (_, i) => (i / 100) * MAX_WIND)
  .map((ms) => `${sx(ms).toFixed(1)},${sy(powerCurve(ms)).toFixed(1)}`)
  .join(" ");

/**
 * The turbine's reference power curve with where it is now: a gap between the
 * dot and the curve is lost production (curtailment, derating or a fault).
 */
export function PowerCurve({ windMs, powerKw, setpointKw }: { windMs: number | null; powerKw: number | null; setpointKw: number | null }) {
  const expected = windMs === null ? null : powerCurve(windMs);
  const label =
    windMs === null || powerKw === null
      ? "Power curve, no current value"
      : `Power curve: ${(powerKw / 1000).toFixed(2)} MW at ${windMs.toFixed(1)} m/s, curve ${(((expected ?? 0) as number) / 1000).toFixed(2)} MW`;
  return (
    <figure className="fp-curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {[0, 5, 10, 15, 20, 25].map((ms) => (
          <g key={ms}>
            <line className="fp-curve-grid" x1={sx(ms)} x2={sx(ms)} y1={PAD.t} y2={H - PAD.b} />
            <text className="fp-curve-tick" x={sx(ms)} y={H - 10} textAnchor="middle">
              {ms}
            </text>
          </g>
        ))}
        {[0, 1.5, 3, 4.5].map((mw) => (
          <g key={mw}>
            <line className="fp-curve-grid" x1={PAD.l} x2={W - PAD.r} y1={sy(mw * 1000)} y2={sy(mw * 1000)} />
            <text className="fp-curve-tick" x={PAD.l - 6} y={sy(mw * 1000) + 4} textAnchor="end">
              {mw}
            </text>
          </g>
        ))}
        <polyline className="fp-curve-line" points={CURVE} />
        {setpointKw !== null && setpointKw < RATED_KW && <line className="fp-curve-sp" x1={PAD.l} x2={W - PAD.r} y1={sy(setpointKw)} y2={sy(setpointKw)} />}
        {windMs !== null && powerKw !== null && (
          <>
            {expected !== null && <line className="fp-curve-gap" x1={sx(Math.min(windMs, MAX_WIND))} x2={sx(Math.min(windMs, MAX_WIND))} y1={sy(expected)} y2={sy(powerKw)} />}
            <circle className="fp-curve-dot" cx={sx(Math.min(windMs, MAX_WIND))} cy={sy(Math.max(0, powerKw))} r={6} />
          </>
        )}
      </svg>
      <figcaption className="note">Power curve · MW against wind m/s · dot: now{setpointKw !== null && setpointKw < RATED_KW ? " · dashed: setpoint" : ""}</figcaption>
    </figure>
  );
}
