import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import { describe, expect, it, vi } from "vitest";
import { createGraphQLBackend } from "./backend.ts";
import * as documents from "./documents.ts";
import { toAlarm, toAlarmChange, toJournalEntry, toMeasurement, toQuality, type RawAlarm } from "./map.ts";
import { createTransport, GraphQLRequestError, type Transport } from "./transport.ts";
import { writable } from "../store.ts";

const schema = buildSchema(readFileSync(new URL("../../../../schema.graphql", import.meta.url), "utf8"));

const RAW_ALARM: RawAlarm = {
  key: "tr2_oil_temp/high",
  origin: "hub",
  name: "tr2_oil_temp",
  area: "vds.sub.tr2",
  condition: "high",
  instanceId: "b51e09c4-0000-4000-8000-000000003d7a",
  state: "Set",
  severity: "medium",
  value: 78.4,
  setAt: "2026-10-25T14:28:51.090Z",
  stateAt: "2026-10-25T14:30:00.000Z",
  ack: "NOT_ACK",
  ackedAt: null,
  ackedBy: null,
  originOnline: true,
};

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
    const a = toAlarm(RAW_ALARM);
    expect(a).toMatchObject({ priority: 2, acked: false, ackPending: false, ackedAt: null, key: "tr2_oil_temp/high", originOnline: true });
    expect(a.setAt.toISOString()).toBe("2026-10-25T14:28:51.090Z");
    expect(a.stateAt.toISOString()).toBe("2026-10-25T14:30:00.000Z");
  });

  it("counts a pending ack as acknowledged, and says it is pending", () => {
    expect(toAlarm({ ...RAW_ALARM, ack: "ACK_PENDING" })).toMatchObject({ acked: true, ackPending: true });
    expect(toAlarm({ ...RAW_ALARM, ack: "ACK" })).toMatchObject({ acked: true, ackPending: false });
  });

  it("maps the changes of the active summary", () => {
    expect(toAlarmChange({ kind: "UPSERT", instanceId: RAW_ALARM.instanceId, alarm: RAW_ALARM })).toMatchObject({ kind: "upsert", alarm: { name: "tr2_oil_temp" } });
    expect(toAlarmChange({ kind: "REMOVE", instanceId: "i1", alarm: null })).toEqual({ kind: "remove", instanceId: "i1" });
    expect(toAlarmChange({ kind: "SYNCED", instanceId: null, alarm: null })).toEqual({ kind: "synced" });
    expect(toAlarmChange({ kind: "UPSERT", instanceId: "i1", alarm: null })).toBeNull();
  });

  it("maps a journal gap, which has no alarm", () => {
    const e = toJournalEntry({ timestamp: "2026-10-25T01:00:00Z", kind: "GAP", origin: "site-1", name: "", area: "", condition: "", instanceId: "00000000-0000-0000-0000-000000000000", state: null, value: null, severity: null, ack: "NOT_ACK", ackedAt: null, ackedBy: null });
    expect(e).toMatchObject({ kind: "GAP", priority: null, value: null, acked: false });
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

  it("asks for history by paths, one page at a time", async () => {
    const row = (equipment: string, name: string) => ({ equipment, name, timestamp: "2026-10-25T01:00:00Z", type: "analogical", value: 1, quality: "good" });
    const { t, calls } = fakeTransport({
      histAnalogical: { pageInfo: { hasNextPage: true, endCursor: "c2" }, nodes: [row("vds.wf.f1.t01", "p_kw"), row("vds.wf.f2.t07", "p_kw")] },
    });
    const b = createGraphQLBackend(t);
    const from = new Date("2026-10-25T00:00:00Z");
    const to = new Date("2026-10-25T06:00:00Z");
    const got = await b.history("analogical", { paths: ["vds.wf.*.*.p_kw"], from, to, order: "desc", first: 50_000, after: "c1" });
    expect(calls[0]?.query).toBe(documents.HIST_ANALOGICAL);
    expect(calls[0]?.variables).toEqual({
      paths: ["vds.wf.*.*.p_kw"],
      timestamp: { from: from.toISOString(), to: to.toISOString() },
      order: "DESC",
      first: 10_000,
      after: "c1",
    });
    expect(got.items.map((m) => m.id)).toEqual(["vds.wf.f1.t01::p_kw", "vds.wf.f2.t07::p_kw"]);
    expect(got.next).toBe("c2");
  });

  it("ends on the last page, omits an open range, and sends nothing for no paths", async () => {
    const { t, calls } = fakeTransport({ histDiscrete: { pageInfo: { hasNextPage: false, endCursor: "x" }, nodes: [] } });
    const b = createGraphQLBackend(t);
    await expect(b.history("discrete", { paths: ["vds.sub.>"] })).resolves.toEqual({ items: [], next: null });
    expect(calls[0]?.variables).toMatchObject({ paths: ["vds.sub.>"], timestamp: undefined, order: "ASC", first: 1_000 });
    await expect(b.history("discrete", { paths: [] })).resolves.toEqual({ items: [], next: null });
    expect(calls).toHaveLength(1);
  });

  it("pages the alarm journal like the measurement history", async () => {
    const row = { timestamp: "2026-10-25T01:00:00Z", kind: "SET", origin: "hub", name: "a", area: "vds.sub", condition: "_", instanceId: "i1", state: "Set", value: 1, severity: "low", ack: "NOT_ACK", ackedAt: null, ackedBy: null };
    const { t, calls } = fakeTransport({ alarmJournal: { pageInfo: { hasNextPage: false, endCursor: "c9" }, nodes: [row] } });
    const b = createGraphQLBackend(t);
    const from = new Date("2026-10-25T00:00:00Z");
    const to = new Date("2026-10-25T06:00:00Z");
    const got = await b.alarmJournal({ from, to, order: "desc", first: 500, after: "c8" });
    expect(calls[0]?.query).toBe(documents.ALARM_JOURNAL);
    expect(calls[0]?.variables).toEqual({
      filter: { timestamp: { from: from.toISOString(), to: to.toISOString() } },
      order: "DESC",
      first: 500,
      after: "c8",
    });
    expect(got.items.map((e) => [e.instanceId, e.kind, e.priority])).toEqual([["i1", "SET", 3]]);
    expect(got.next).toBeNull();
  });

  it("acknowledges by key and instance, and returns the status", async () => {
    const { t, calls } = fakeTransport({ ackAlarm: { status: "PENDING" } });
    const b = createGraphQLBackend(t);
    await expect(b.ackAlarm("k1", "i1")).resolves.toBe("PENDING");
    expect(calls[0]?.query).toBe(documents.ACK_ALARM);
    expect(calls[0]?.variables).toEqual({ key: "k1", instanceId: "i1" });
  });
});
