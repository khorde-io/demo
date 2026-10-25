/**
 * Starts the HMI core for one of two backends:
 *
 * - `hub` (default): `config.json` from this origin names the identity
 *   provider and the GraphQL API; sign-in is OIDC with PKCE.
 * - `mock` (`VITE_HMI_BACKEND=mock`): the plant simulator runs in the
 *   browser behind the mock backend, signed in as a fixed operator.
 *
 * Both go through `createHmi`, so the screens cannot tell them apart.
 */

import { SCADA_ROLES, createHmi, loadConfig, type Catalog, type Hmi, type HmiConfig } from "@khorde/hmi-core";
import { createStaticAuth } from "@khorde/hmi-core/mock";
import { reactMessages } from "@khorde/hmi-react";
import { DEFAULT_THEME, THEMES } from "@khorde/hmi-theme";
import type { Plant } from "@khorde/demo-plant";
import { projectCatalog } from "./dictionary.ts";
import { startMockSite, type MockSite } from "./mock/mockSite.ts";
import { plant } from "./plant.ts";

export interface Booted {
  hmi: Hmi;
  plant: Plant;
  /** Present on the mock backend: the in-browser simulator. */
  site: MockSite | null;
}

const MOCK_CONFIG: HmiConfig = {
  siteName: "Ventos da Serra",
  auth: { authority: "http://mock.invalid", clientId: "mock", projectId: "mock" },
  api: { http: "http://mock.invalid/", ws: "ws://mock.invalid/" },
  defaults: { theme: DEFAULT_THEME, locale: "en" },
  themes: THEMES.map((t) => t.id),
};

const catalogs = (p: Plant): Record<string, Catalog[]> => ({ en: [{ messages: reactMessages }, projectCatalog(p)] });

export async function boot(backend: string | undefined = import.meta.env.VITE_HMI_BACKEND): Promise<Booted> {
  if (backend === "mock") {
    const site = startMockSite(plant);
    const hmi = createHmi({
      config: MOCK_CONFIG,
      backend: site.backend,
      auth: createStaticAuth({ name: "operator1", roles: [SCADA_ROLES.viewer, SCADA_ROLES.operator, SCADA_ROLES.alarmAck] }),
      catalogs: catalogs(plant),
    });
    await hmi.auth.init();
    return { hmi, plant, site };
  }
  const config = await loadConfig(import.meta.env.VITE_HMI_CONFIG ?? "/config.json", { themeIds: THEMES.map((t) => t.id), locales: ["en"] });
  const hmi = createHmi({ config, catalogs: catalogs(plant) });
  // Completes the login redirect when this page load is one.
  await hmi.auth.init();
  return { hmi, plant, site: null };
}

const started = new WeakMap<Hmi, Promise<void>>();

/** Starts the live services once per HMI (React may mount twice in development). */
export function startOnce(hmi: Hmi): Promise<void> {
  let p = started.get(hmi);
  if (!p) {
    p = hmi.start();
    started.set(hmi, p);
  }
  return p;
}
