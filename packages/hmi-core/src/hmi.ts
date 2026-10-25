/**
 * Wires the services together for an app: one call from config to a running
 * HMI core. Apps that need a different arrangement can build each service
 * themselves from the same pieces.
 */

import { THEMES, type ThemeInfo } from "@khorde/hmi-theme";
import { createHeartbeatMonitor, linkAgentStaleness, loadRegistry, type HeartbeatMonitor, type Registry } from "./agents.ts";
import { createAlarmStore, type AlarmStore } from "./alarms.ts";
import { createAuth, type Auth } from "./auth.ts";
import type { ScadaBackend } from "./backend.ts";
import { createCommandService, type CommandService } from "./commands.ts";
import type { HmiConfig } from "./config.ts";
import { createGraphQLBackend } from "./graphql/backend.ts";
import { createTransport } from "./graphql/transport.ts";
import { createHistoryService, type HistoryService } from "./history.ts";
import { en } from "./i18n/en.ts";
import { createI18n, type Catalog, type I18n } from "./i18n/i18n.ts";
import { createPointStore, type PointStore } from "./points.ts";
import type { Unsubscribe } from "./store.ts";
import { createThemeService, type StorageLike, type ThemeService } from "./theme.ts";

export interface HmiOptions {
  config: HmiConfig;
  /** Defaults to OIDC login against `config.auth`. */
  auth?: Auth;
  /** Defaults to the GraphQL API at `config.api`. */
  backend?: ScadaBackend;
  /** Catalogs per locale, layered after the core's own English texts. */
  catalogs?: Record<string, readonly Catalog[]>;
  /** Defaults to the built-in themes. */
  themes?: readonly ThemeInfo[];
  storage?: StorageLike | null;
  onError?(err: unknown): void;
}

export interface Hmi {
  config: HmiConfig;
  auth: Auth;
  backend: ScadaBackend;
  points: PointStore;
  alarms: AlarmStore;
  commands: CommandService;
  history: HistoryService;
  theme: ThemeService;
  i18n: I18n;
  agents: HeartbeatMonitor | null;
  sites: HeartbeatMonitor | null;
  registry: Registry | null;
  /** Call once signed in: loads the registry and starts the live services. */
  start(): Promise<void>;
  stop(): void;
}

export function createHmi(options: HmiOptions): Hmi {
  const { config } = options;
  const auth = options.auth ?? createAuth(config.auth);
  const backend =
    options.backend ??
    createGraphQLBackend(createTransport({ http: config.api.http, ws: config.api.ws, getToken: () => auth.getToken() }));

  const catalogs: Record<string, Catalog[]> = { en: [{ messages: en }] };
  for (const [locale, list] of Object.entries(options.catalogs ?? {})) {
    catalogs[locale] = [...(catalogs[locale] ?? []), ...list];
  }

  const theme = createThemeService({
    themes: options.themes ?? THEMES,
    defaultTheme: config.defaults.theme,
    allowed: config.themes,
    ...(options.storage !== undefined ? { storage: options.storage } : {}),
  });
  const followUser = () => theme.setUser(auth.get().user?.sub ?? null);
  followUser();
  const stopFollow = auth.subscribe(followUser);

  const points = createPointStore(backend, { ...(options.onError ? { onError: options.onError } : {}) });
  const cleanups: Unsubscribe[] = [stopFollow];

  const hmi: Hmi = {
    config,
    auth,
    backend,
    points,
    alarms: createAlarmStore(backend, { permissions: auth }),
    commands: createCommandService(backend, { permissions: auth }),
    history: createHistoryService(backend),
    theme,
    i18n: createI18n({ locale: config.defaults.locale, catalogs }),
    agents: null,
    sites: null,
    registry: null,

    async start() {
      const registry = await loadRegistry(backend);
      hmi.registry = registry;
      const agentIds = config.agents ?? [...new Set([...registry.measurements.values()].map((m) => m.agent))];
      hmi.agents = createHeartbeatMonitor(backend, "agent", agentIds);
      hmi.sites = createHeartbeatMonitor(backend, "site", config.sites ?? []);
      await Promise.all([hmi.agents.start(), hmi.sites.start(), hmi.alarms.start()]);
      cleanups.push(linkAgentStaleness(points, hmi.agents, registry));
    },

    stop() {
      for (const c of cleanups.splice(0)) c();
      hmi.alarms.stop();
      hmi.agents?.stop();
      hmi.sites?.stop();
      points.dispose();
    },
  };
  return hmi;
}
