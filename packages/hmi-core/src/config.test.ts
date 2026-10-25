import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, validateConfig } from "./config.ts";

const valid = {
  siteName: "Ventos da Serra",
  auth: { authority: "http://auth.localhost:9310", clientId: "123", projectId: "khorde_scada" },
  api: { http: "http://localhost:8085/", ws: "ws://localhost:8085/" },
  defaults: { theme: "dark-grey", locale: "en" },
  themes: ["dark-grey", "range-green", "ink"],
};

const themeIds = ["dark-grey", "range-green", "ink"];

describe("validateConfig", () => {
  it("accepts a complete config", () => {
    expect(validateConfig(valid, { themeIds, locales: ["en"] })).toMatchObject({ siteName: "Ventos da Serra", themes: themeIds });
  });

  it("offers the default theme when no list is given", () => {
    const { themes: _ignored, ...rest } = valid;
    expect(validateConfig(rest).themes).toEqual(["dark-grey"]);
  });

  it("lists every problem at once", () => {
    const bad = {
      ...valid,
      auth: { authority: "not a url", clientId: "" },
      api: { http: "http://x/", ws: "http://x/" },
      defaults: { theme: "neon", locale: "pt" },
    };
    let error: unknown;
    try {
      validateConfig(bad, { themeIds, locales: ["en"] });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).problems).toEqual([
        "auth.authority is not a URL",
        "auth.clientId must be a non-empty string",
        "auth.projectId must be a non-empty string",
        "api.ws must use ws: or wss:",
        'defaults.theme "neon" is not in themes',
        'defaults.locale "pt" has no dictionary',
    ]);
  });

  it("rejects an unregistered theme", () => {
    expect(() => validateConfig({ ...valid, themes: ["dark-grey", "neon"] }, { themeIds })).toThrow('theme "neon" is not registered');
  });
});

describe("loadConfig", () => {
  it("fetches and validates", async () => {
    const fetch = async () => new Response(JSON.stringify(valid));
    await expect(loadConfig("/config.json", { fetch })).resolves.toMatchObject({ siteName: "Ventos da Serra" });
  });

  it("reports a missing file", async () => {
    const fetch = async () => new Response("", { status: 404 });
    await expect(loadConfig("/config.json", { fetch })).rejects.toThrow("HTTP 404");
  });
});
