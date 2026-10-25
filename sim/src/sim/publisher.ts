/**
 * Sends simulated values to a REST agent's `/batch` endpoint. Only changes go
 * out (with a small deadband for analog values), plus a periodic refresh, so
 * history is not flooded with identical samples.
 */

import type { Sample } from "./model.ts";

export interface PublisherOptions {
  /** Agent base URL, e.g. http://agent-substation:9090 */
  url: string;
  /** Re-send unchanged values this often. */
  refreshMs?: number;
  /** Relative deadband for analog values. */
  deadband?: number;
  fetch?: typeof fetch;
  log?(msg: string): void;
}

export interface Publisher {
  publish(samples: readonly Sample[], now?: number): Promise<number>;
}

interface Sent {
  value: number;
  quality: boolean;
  at: number;
}

export function changed(prev: Sent | undefined, s: Sample, now: number, refreshMs: number, deadband: number): boolean {
  if (!prev) return true;
  if (prev.quality !== s.quality) return true;
  if (now - prev.at >= refreshMs) return true;
  if (s.type === "discrete") return prev.value !== s.value;
  return Math.abs(s.value - prev.value) > Math.max(Math.abs(prev.value) * deadband, 0.01);
}

export function createPublisher(options: PublisherOptions): Publisher {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const refreshMs = options.refreshMs ?? 30_000;
  const deadband = options.deadband ?? 0.002;
  const last = new Map<string, Sent>();
  let failing = false;

  return {
    async publish(samples, now = Date.now()) {
      const due = samples.filter((s) => changed(last.get(s.addr), s, now, refreshMs, deadband));
      if (due.length === 0) return 0;
      const timestamp = new Date(now).toISOString();
      try {
        const res = await doFetch(`${options.url}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(due.map((s) => ({ addr: s.addr, value: s.value, quality: s.quality, timestamp }))),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        for (const s of due) last.set(s.addr, { value: s.value, quality: s.quality, at: now });
        if (failing) options.log?.(`${options.url}: sending again`);
        failing = false;
        return due.length;
      } catch (err) {
        // Keep the unsent values "changed" so they go out on the next tick.
        if (!failing) options.log?.(`${options.url}: ${err instanceof Error ? err.message : String(err)}`);
        failing = true;
        return 0;
      }
    },
  };
}
