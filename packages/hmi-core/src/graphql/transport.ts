/**
 * The wire: queries and mutations over HTTP POST, subscriptions over one shared
 * graphql-ws socket. The access token is read on every request and on every
 * (re)connect, so a renewed token is picked up without restarting anything.
 */

import { createClient, type Client } from "graphql-ws";
import { writable, type Readable, type Unsubscribe } from "../store.ts";

export type ConnectionState = "idle" | "connecting" | "online" | "offline";

export interface Sink<T> {
  next(value: T): void;
  error?(err: unknown): void;
}

export interface TransportOptions {
  /** HTTP endpoint, e.g. `http://localhost:8085/`. */
  http: string;
  /** WebSocket endpoint, e.g. `ws://localhost:8085/`. */
  ws: string;
  getToken(): Promise<string>;
  fetch?: typeof fetch;
  /** WebSocket constructor, for environments without a global one. */
  webSocketImpl?: unknown;
  /** Longest wait between reconnect attempts. */
  maxRetryWaitMs?: number;
}

export interface Transport {
  request<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  subscribe<T>(query: string, variables: Record<string, unknown>, sink: Sink<T>): Unsubscribe;
  /** State of the subscription socket. */
  connection: Readable<ConnectionState>;
  dispose(): void;
}

export class GraphQLRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly errors: readonly { message: string }[] = [],
  ) {
    super(message);
    this.name = "GraphQLRequestError";
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

function errorsMessage(errors: readonly { message: string }[]): string {
  return errors.map((e) => e.message).join("\n");
}

export function createTransport(options: TransportOptions): Transport {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const connection = writable<ConnectionState>("idle");
  const maxWait = options.maxRetryWaitMs ?? 30_000;
  let active = 0;

  const ws: Client = createClient({
    url: options.ws,
    lazy: true,
    connectionParams: async () => ({ token: await options.getToken() }),
    retryAttempts: Number.POSITIVE_INFINITY,
    shouldRetry: () => true,
    retryWait: async (retries) => {
      const wait = Math.min(maxWait, 1000 * 2 ** retries) * (0.75 + Math.random() * 0.5);
      await new Promise((resolve) => setTimeout(resolve, wait));
    },
    ...(options.webSocketImpl ? { webSocketImpl: options.webSocketImpl } : {}),
    on: {
      connecting: () => connection.set("connecting"),
      connected: () => connection.set("online"),
      closed: () => connection.set(active > 0 ? "offline" : "idle"),
    },
  });

  return {
    connection,

    async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      const token = await options.getToken();
      const res = await doFetch(options.http, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query, variables }),
      });
      let body: GraphQLResponse<T>;
      try {
        body = (await res.json()) as GraphQLResponse<T>;
      } catch {
        throw new GraphQLRequestError(`HTTP ${res.status}: response is not JSON`, res.status);
      }
      if (body.errors?.length) throw new GraphQLRequestError(errorsMessage(body.errors), res.status, body.errors);
      if (!res.ok) throw new GraphQLRequestError(`HTTP ${res.status}`, res.status);
      if (body.data === undefined) throw new GraphQLRequestError("Response has no data", res.status);
      return body.data;
    },

    subscribe<T>(query: string, variables: Record<string, unknown>, sink: Sink<T>): Unsubscribe {
      active++;
      let done = false;
      const stop = ws.subscribe<T>(
        { query, variables },
        {
          next: (result) => {
            if (result.errors?.length) {
              sink.error?.(new GraphQLRequestError(errorsMessage(result.errors), null, result.errors));
              return;
            }
            if (result.data !== undefined && result.data !== null) sink.next(result.data as T);
          },
          error: (err) => sink.error?.(err),
          complete: () => {},
        },
      );
      return () => {
        if (done) return;
        done = true;
        active--;
        stop();
      };
    },

    dispose() {
      void ws.dispose();
    },
  };
}
