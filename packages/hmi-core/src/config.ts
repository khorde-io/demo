/**
 * Runtime configuration, loaded from `config.json` at startup so one build can
 * point at a local hub or at the SaaS.
 */

export interface HmiConfig {
  siteName: string;
  auth: {
    authority: string;
    clientId: string;
    projectId: string;
    /** Defaults to the current origin + "/". */
    redirectUri?: string;
    postLogoutRedirectUri?: string;
    /** Added to the required scopes. */
    extraScopes?: string[];
  };
  api: { http: string; ws: string };
  defaults: { theme: string; locale: string };
  /** Themes offered in the picker. */
  themes: string[];
  /** Agents to watch for comms health; when omitted, taken from the registry. */
  agents?: string[];
  /** Site (leaf) names to watch, for hybrid deployments. */
  sites?: string[];
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid HMI config:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export interface ValidateOptions {
  /** Theme ids that exist; config themes must be among them. */
  themeIds?: readonly string[];
  locales?: readonly string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validateConfig(raw: unknown, options: ValidateOptions = {}): HmiConfig {
  const problems: string[] = [];
  const root = isObj(raw) ? raw : (problems.push("config must be an object"), {});

  const str = (obj: Record<string, unknown>, key: string, where: string, required = true): string | undefined => {
    const v = obj[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== "string" || v.trim() === "") {
      problems.push(`${where}.${key} must be a non-empty string`);
      return undefined;
    }
    return v;
  };
  const url = (obj: Record<string, unknown>, key: string, where: string, protocols: string[]) => {
    const v = str(obj, key, where);
    if (v === undefined) return "";
    try {
      const u = new URL(v);
      if (!protocols.includes(u.protocol)) problems.push(`${where}.${key} must use ${protocols.join(" or ")}`);
    } catch {
      problems.push(`${where}.${key} is not a URL`);
    }
    return v;
  };
  const strList = (obj: Record<string, unknown>, key: string, where: string): string[] | undefined => {
    const v = obj[key];
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      problems.push(`${where}.${key} must be a list of strings`);
      return undefined;
    }
    return v as string[];
  };
  const section = (key: string) => {
    const v = root[key];
    if (isObj(v)) return v;
    problems.push(`${key} must be an object`);
    return {};
  };

  const auth = section("auth");
  const api = section("api");
  const defaults = section("defaults");

  const redirectUri = auth.redirectUri === undefined ? undefined : url(auth, "redirectUri", "auth", ["http:", "https:"]);
  const postLogoutRedirectUri =
    auth.postLogoutRedirectUri === undefined ? undefined : url(auth, "postLogoutRedirectUri", "auth", ["http:", "https:"]);
  const extraScopes = strList(auth, "extraScopes", "auth");

  const config: HmiConfig = {
    siteName: str(root, "siteName", "config") ?? "",
    auth: {
      authority: url(auth, "authority", "auth", ["http:", "https:"]),
      clientId: str(auth, "clientId", "auth") ?? "",
      projectId: str(auth, "projectId", "auth") ?? "",
      ...(redirectUri ? { redirectUri } : {}),
      ...(postLogoutRedirectUri ? { postLogoutRedirectUri } : {}),
      ...(extraScopes ? { extraScopes } : {}),
    },
    api: { http: url(api, "http", "api", ["http:", "https:"]), ws: url(api, "ws", "api", ["ws:", "wss:"]) },
    defaults: { theme: str(defaults, "theme", "defaults") ?? "", locale: str(defaults, "locale", "defaults") ?? "" },
    themes: strList(root, "themes", "config") ?? [],
  };
  const agents = strList(root, "agents", "config");
  const sites = strList(root, "sites", "config");
  if (agents) config.agents = agents;
  if (sites) config.sites = sites;

  if (config.themes.length === 0) config.themes = config.defaults.theme ? [config.defaults.theme] : [];
  if (config.defaults.theme && !config.themes.includes(config.defaults.theme)) {
    problems.push(`defaults.theme "${config.defaults.theme}" is not in themes`);
  }
  if (options.themeIds) {
    for (const t of config.themes) if (!options.themeIds.includes(t)) problems.push(`theme "${t}" is not registered`);
  }
  if (options.locales && config.defaults.locale && !options.locales.includes(config.defaults.locale)) {
    problems.push(`defaults.locale "${config.defaults.locale}" has no dictionary`);
  }

  if (problems.length) throw new ConfigError(problems);
  return config;
}

export async function loadConfig(
  url = "/config.json",
  options: ValidateOptions & { fetch?: typeof fetch } = {},
): Promise<HmiConfig> {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const res = await doFetch(url, { cache: "no-store" });
  if (!res.ok) throw new ConfigError([`could not load ${url}: HTTP ${res.status}`]);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new ConfigError([`${url} is not valid JSON`]);
  }
  return validateConfig(raw, options);
}
