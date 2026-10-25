import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import { describe, expect, it, vi } from "vitest";
import { createGraphQLBackend } from "./backend.ts";
import * as documents from "./documents.ts";
import { toAlarm, toMeasurement, toQuality } from "./map.ts";
import { createTransport, GraphQLRequestError, type Transport } from "./transport.ts";
import { writable } from "../store.ts";

const schema = buildSchema(readFileSync(new URL("../../../../schema.graphql", import.meta.url), "utf8"));

describe("documents", () => {
  it.each(Object.entries(documents))("%s is valid against schema.graphql", (_name, source) => {
    expect(validate(schema, parse(source)).map((e) => e.message)).toEqual([]);
  });
});

describe("mapping", () => {
  it("reads quality as good or bad", () => {
    expect(toQuality("good")).toBe("good");
    expect(toQuality("GOOD")).toBe("good");
    expect(toQuality("bad")).toBe("bad");
    expect(toQuality("substituted")).toBe("bad");
  });

  it("maps a measurement", () => {
    const m = toMeasurement({
      name: "pos",
      equipment: "vds.sub.f1.cb",
      timestamp: "2026-10-25T14:32:41.208Z",
      type: "discrete",
      value: 1,
      quality: "good",
    });
    expect(m).toMatchObject({ id: "vds.sub.f1.cb::pos", value: 1, quality: "good" });
    expect(m.timestamp.toISOString()).toBe("2026-10-25T14:32:41.208Z");
  });

  it("maps an alarm and its priority", () => {
    const a = toAlarm({
      name: "tr2_oil_temp",
      area: "vds.sub.tr2",
      condition: "high",
      instanceId: "b51e09c4-0000-4000-8000-000000003d7a",
      timestamp: "2026-10-25T14:28:51.090Z",
      state: "Set",
      value: 78.4,
      severity: "medium",
      ack: "NotAck",
      ackTimestamp: null,
      actorId: null,
      actorDisplay: null,
    });
    expect(a).toMatchObject({ priority: 2, acked: false, ackTimestamp: null });
  });
});

describe("transport.request", () => {
  const transport = (fetch: typeof globalThis.fetch) =>
    createTransport({ http: "http://hub/", ws: "ws://hub/", getToken: async () => "tok", fetch });

  it("posts the query with a bearer token and returns data", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200 }));
    const t = transport(fetch);
    await expect(t.request("query { ok }", { a: 1 })).resolves.toEqual({ ok: 1 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://hub/");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ query: "query { ok }", variables: { a: 1 } });
    t.dispose();
  });

  it("turns GraphQL errors into GraphQLRequestError", async () => {
    const t = transport(async () => new Response(JSON.stringify({ errors: [{ message: "denied" }] }), { status: 200 }));
    await expect(t.request("query { ok }")).rejects.toThrow(GraphQLRequestError);
    await expect(t.request("query { ok }")).rejects.toThrow("denied");
    t.dispose();
  });

  it("reports HTTP failures", async () => {
    const t = transport(async () => new Response("nope", { status: 502 }));
    await expect(t.request("query { ok }")).rejects.toMatchObject({ status: 502 });
    t.dispose();
  });
});

describe("GraphQL backend", () => {
  function fakeTransport(data: unknown) {
    const calls: { query: string; variables: Record<string, unknown> | undefined }[] = [];
    const t: Transport = {
      connection: writable("idle"),
      request: async <T,>(query: string, variables?: Record<string, unknown>) => {
        calls.push({ query, variables });
        return data as T;
      },
      subscribe: () => () => {},
      dispose: () => {},
    };
    return { t, calls };
  }

  it("sends discrete commands without a value and analogical ones with it", async () => {
    const { t, calls } = fakeTransport({ discreteCommandRequest: "r1", analogicalCommandRequest: "r2" });
    const b = createGraphQLBackend(t);
    const key = { agent: "a", equipment: "e", name: "pos.open" };
    await expect(b.sendCommand(key, { bypassInterlock: false })).resolves.toBe("r1");
    await expect(b.sendCommand({ ...key, name: "sp" }, { value: 2.5, bypassInterlock: true })).resolves.toBe("r2");
    expect(calls[0]?.query).toBe(documents.DISCRETE_COMMAND);
    expect(calls[1]?.query).toBe(documents.ANALOGICAL_COMMAND);
    expect(calls[1]?.variables).toMatchObject({ value: 2.5, bypassInterlock: true });
  });

  it("asks the hub for the point name and keeps only the equipment the path matches", async () => {
    const row = (equipment: string, name: string) => ({ equipment, name, timestamp: "2026-10-25T01:00:00Z", type: "analogical", value: 1, quality: "good" });
    const { t, calls } = fakeTransport({
      histAnalogical: [row("vds.wf.f1.t01", "p_kw"), row("vds.wf.f2.t07", "p_kw"), row("vds.sub.mv.a.f1", "p_kw"), row("vds.wf.met", "p_kw")],
    });
    const b = createGraphQLBackend(t);
    const from = new Date("2026-10-25T00:00:00Z");
    const to = new Date("2026-10-25T06:00:00Z");
    const got = await b.history("analogical", { path: "vds.wf.*.*.p_kw", from, to });
    expect(calls[0]?.variables).toEqual({ filter: { name: "^p_kw$", timestamp: { from: from.toISOString(), to: to.toISOString() } } });
    expect(got.map((m) => m.id)).toEqual(["vds.wf.f1.t01::p_kw", "vds.wf.f2.t07::p_kw"]);
  });

  it("sends no name filter for a trailing wildcard and refuses names that are not plain", async () => {
    const { t, calls } = fakeTransport({ histDiscrete: [] });
    const b = createGraphQLBackend(t);
    await b.history("discrete", { path: "vds.sub.>" });
    expect(calls[0]?.variables).toEqual({ filter: { timestamp: { from: undefined, to: undefined } } });
    await expect(b.history("discrete", { path: "vds.sub.x.p'; drop" })).rejects.toThrow("unsupported name segment");
  });
});
