/**
 * Sends field reports to a REST agent's `/batch` endpoint, each with its own
 * acquisition timestamp. What to send and when is the field's job
 * (`field.ts`); this only delivers, one request at a time, and keeps what the
 * agent did not accept for the next attempt.
 */

import type { Report } from "./field.ts";

export interface PublisherOptions {
  /** Agent base URL, e.g. http://agent-substation:9090 */
  url: string;
  /** Reports kept while the agent is unreachable; the oldest are dropped. */
  maxQueue?: number;
  fetch?: typeof fetch;
  log?(msg: string): void;
}

export interface Publisher {
  /** Queues the reports and sends what is queued; resolves to the number sent. */
  publish(reports: readonly Report[]): Promise<number>;
}

export function createPublisher(options: PublisherOptions): Publisher {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const maxQueue = options.maxQueue ?? 20_000;
  let queue: Report[] = [];
  let busy = false;
  let failing = false;

  return {
    async publish(reports) {
      queue.push(...reports);
      if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
      // One request in flight: a slow agent gets a bigger batch next time, not a pile of requests.
      if (busy || queue.length === 0) return 0;
      busy = true;
      const batch = queue;
      queue = [];
      try {
        const res = await doFetch(`${options.url}/batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch.map((r) => ({ addr: r.addr, value: r.value, quality: r.quality, timestamp: new Date(r.at).toISOString() }))),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        if (failing) options.log?.(`${options.url}: sending again`);
        failing = false;
        return batch.length;
      } catch (err) {
        queue = [...batch, ...queue];
        if (!failing) options.log?.(`${options.url}: ${err instanceof Error ? err.message : String(err)}`);
        failing = true;
        return 0;
      } finally {
        busy = false;
      }
    },
  };
}
