import { describe, expect, it } from "vitest";
import { SCADA_ROLES } from "./auth.ts";
import type { HmiConfig } from "./config.ts";
import { createHmi } from "./hmi.ts";
import { createStaticAuth } from "./mock/auth.ts";
import { createMockBackend } from "./mock/backend.ts";
import { AGENT, feederBay, tick } from "./test-fixtures.ts";

const config: HmiConfig = {
  siteName: "Test site",
  auth: { authority: "http://idp", clientId: "c", projectId: "khorde_scada" },
  api: { http: "http://hub/", ws: "ws://hub/" },
  defaults: { theme: "dark-grey", locale: "en" },
  themes: ["dark-grey", "ink"],
  sites: ["vds-leaf"],
};

const setup = () => {
  const backend = createMockBackend(feederBay());
  const hmi = createHmi({
    config,
    backend,
    auth: createStaticAuth({ sub: "ana", roles: [SCADA_ROLES.operator] }),
    storage: null,
    catalogs: { en: [{ equipment: { "vds.sub.f1.cb": "F1 breaker" } }] },
  });
  return { backend, hmi };
};

describe("createHmi", () => {
  it("starts the registry, comms monitors and alarms", async () => {
    const { backend, hmi } = setup();
    backend.raiseAlarm({ name: "x", area: "vds.sub", severity: "high" });
    await hmi.start();
    expect(hmi.registry?.agentOf("vds.sub.f1.cb::pos")).toBe(AGENT);
    expect(hmi.registry?.command("vds.sub.f1.cb", "pos.open")).toMatchObject({ agent: AGENT });
    expect([...(hmi.agents?.get().keys() ?? [])].sort()).toEqual([AGENT, "vds-windfarm"]);
    expect(hmi.sites?.get().get("vds-leaf")?.status).toBe("online");
    expect(hmi.alarms.get().counts.byPriority[1].total).toBe(1);
    hmi.stop();
  });

  it("marks an offline agent's points stale", async () => {
    const { backend, hmi } = setup();
    await hmi.start();
    hmi.points.watch(["vds.>"]);
    await tick(50);
    backend.setHeartbeat("agent", AGENT, "offline");
    await tick();
    expect(hmi.points.get("vds.sub.f1.cb::pos").stale).toBe(true);
    expect(hmi.points.get("vds.wf.f1.t01::p_kw").stale).toBe(false);
    backend.setHeartbeat("agent", AGENT, "online");
    await tick();
    expect(hmi.points.get("vds.sub.f1.cb::pos").stale).toBe(false);
    hmi.stop();
  });

  it("layers project texts over the core's and offers the configured themes", () => {
    const { hmi } = setup();
    expect(hmi.i18n.equipmentName("vds.sub.f1.cb")).toBe("F1 breaker");
    expect(hmi.i18n.t("connection.online")).toBe("Online");
    expect(hmi.theme.list().map((t) => t.id)).toEqual(["dark-grey", "ink"]);
    hmi.stop();
  });

  it("checks permissions through the signed-in user", async () => {
    const { hmi } = setup();
    const sel = await hmi.commands.select({ agent: AGENT, equipment: "vds.sub.f1.cb", name: "pos.open" });
    expect(sel.ok).toBe(true);
    hmi.stop();
  });
});
