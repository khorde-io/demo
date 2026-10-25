/**
 * Moves a few values on the mock backend every second, so trends and values
 * look alive in development. The real plant model is the simulator in sim/.
 */

import type { PointId } from "@khorde/hmi-core";
import type { MockBackend } from "@khorde/hmi-core/mock";

const WALKS: { id: PointId; base: number; spread: number; decimals: number }[] = [
  { id: "vds.sub.tr1::oil_temp", base: 61, spread: 1.5, decimals: 1 },
  { id: "vds.sub.tr2::oil_temp", base: 78, spread: 2, decimals: 1 },
  { id: "vds.sub.mv.a.f1::p_mw", base: 20.8, spread: 1.2, decimals: 2 },
  { id: "vds.sub.mv.a.f2::p_mw", base: 19.6, spread: 1.2, decimals: 2 },
  { id: "vds.sub.mv.b.f3::p_mw", base: 21.4, spread: 1.2, decimals: 2 },
  { id: "vds.sub.mv.b.f4::p_mw", base: 18.9, spread: 1.2, decimals: 2 },
  { id: "vds.sub.mv.a.f1::v_kv", base: 34.6, spread: 0.08, decimals: 2 },
];

export function startLiveValues(backend: MockBackend, everyMs = 1000): () => void {
  const level = new Map(WALKS.map((w) => [w.id, w.base] as const));
  const tick = () => {
    for (const w of WALKS) {
      const cur = level.get(w.id) ?? w.base;
      // Mean-reverting random walk.
      const next = cur + (w.base - cur) * 0.08 + (Math.random() - 0.5) * w.spread * 0.4;
      level.set(w.id, next);
      backend.publish(w.id, Number(next.toFixed(w.decimals)));
    }
  };
  tick();
  const t = setInterval(tick, everyMs);
  return () => clearInterval(t);
}
