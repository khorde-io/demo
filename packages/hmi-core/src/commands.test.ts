import { describe, expect, it } from "vitest";
import { permissionsFor, SCADA_ROLES } from "./auth.ts";
import { createCommandService } from "./commands.ts";
import { createMockBackend } from "./mock/backend.ts";
import type { RequestUpdate } from "./model.ts";
import { CB, CB_CLOSE, ES_CLOSE, TR_TAP, feederBay } from "./test-fixtures.ts";

const operator = permissionsFor(new Set([SCADA_ROLES.operator]));
const viewer = permissionsFor(new Set([SCADA_ROLES.viewer]));
const bypasser = permissionsFor(new Set([SCADA_ROLES.operator, SCADA_ROLES.interlockBypass]));

const service = (permissions = operator, opts = {}) => {
  const backend = createMockBackend(feederBay());
  return { backend, commands: createCommandService(backend, { permissions, pollIntervalMs: 2, ...opts }) };
};

describe("command service", () => {
  it("runs a permitted command through every request state", async () => {
    const { backend, commands } = service();
    const sel = await commands.select(CB);
    expect(sel.ok).toBe(true);
    if (!sel.ok) return;
    expect(sel.selection.interlock.outcome).toBe("PERMIT");

    const seen: RequestUpdate[][] = [];
    const result = await commands.execute(sel.selection, { onUpdate: (u) => seen.push([...u]) });
    expect(result.status).toBe("success");
    expect(result.updates.map((u) => u.state)).toEqual(["FORWARDED_TO_AGENT", "AGENT_RECEIVED", "AGENT_SENT", "REQUEST_SUCCESS"]);
    expect(seen.length).toBeGreaterThan(1);
    expect(backend.value("vds.sub.f1.cb::pos")?.value).toBe(0);
  });

  it("refuses viewers", async () => {
    const { commands } = service(viewer);
    const sel = await commands.select(CB);
    expect(sel).toMatchObject({ ok: false, result: { status: "denied" } });
  });

  it("reports a blocked interlock at selection and refuses to send", async () => {
    const { backend, commands } = service();
    const sel = await commands.select(ES_CLOSE);
    if (!sel.ok) throw new Error("select failed");
    expect(sel.selection.interlock.outcome).toBe("BLOCK");
    const result = await commands.execute(sel.selection);
    expect(result.status).toBe("blocked");
    expect(backend.requests()).toHaveLength(0);
  });

  it("re-checks the interlock at confirmation", async () => {
    const { backend, commands } = service();
    const sel = await commands.select(CB_CLOSE);
    if (!sel.ok) throw new Error("select failed");
    expect(sel.selection.interlock.outcome).toBe("PERMIT");
    backend.publish("vds.sub.f1.es::pos", 1);
    await expect(commands.execute(sel.selection)).resolves.toMatchObject({ status: "blocked" });
  });

  it("only bypasses with the bypass role", async () => {
    const plain = service();
    const sel = await plain.commands.select(ES_CLOSE);
    if (!sel.ok) throw new Error("select failed");
    await expect(plain.commands.execute(sel.selection, { bypassInterlock: true })).resolves.toMatchObject({ status: "denied" });

    const allowed = service(bypasser);
    const sel2 = await allowed.commands.select(ES_CLOSE);
    if (!sel2.ok) throw new Error("select failed");
    const result = await allowed.commands.execute(sel2.selection, { bypassInterlock: true });
    expect(result.status).toBe("success");
    expect(result.updates[0]?.state).toBe("FORWARDED_TO_AGENT_INTERLOCK_BYPASSED");
    expect(allowed.backend.requests()[0]?.request.bypassInterlock).toBe(true);
  });

  it("expires a selection that was not confirmed in time", async () => {
    let t = 0;
    const { commands } = service(operator, { now: () => new Date(t), selectTimeoutMs: 1000 });
    const sel = await commands.select(CB);
    if (!sel.ok) throw new Error("select failed");
    t = 2000;
    await expect(commands.execute(sel.selection)).resolves.toMatchObject({ status: "expired" });
  });

  it("sends analogical values", async () => {
    const { backend, commands } = service();
    const sel = await commands.select(TR_TAP, 10);
    if (!sel.ok) throw new Error("select failed");
    await expect(commands.execute(sel.selection)).resolves.toMatchObject({ status: "success" });
    expect(backend.requests()[0]?.request.value).toBe(10);
    expect(backend.value("vds.sub.tr1::tap")?.value).toBe(10);
  });

  it("maps a device error to an error result", async () => {
    const backend = createMockBackend(feederBay({ onCommand: () => false }));
    const commands = createCommandService(backend, { permissions: operator, pollIntervalMs: 2 });
    const sel = await commands.select(CB);
    if (!sel.ok) throw new Error("select failed");
    await expect(commands.execute(sel.selection)).resolves.toMatchObject({ status: "error" });
  });

  it("times out when no final state arrives", async () => {
    const backend = createMockBackend(feederBay({ stepMs: 10_000 }));
    const commands = createCommandService(backend, { permissions: operator, pollIntervalMs: 2, requestTimeoutMs: 20 });
    const sel = await commands.select(CB);
    if (!sel.ok) throw new Error("select failed");
    const result = await commands.execute(sel.selection);
    expect(result.status).toBe("timeout");
    expect(result.requestId).not.toBeNull();
  });
});
