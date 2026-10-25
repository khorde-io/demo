import { describe, expect, it, vi } from "vitest";
import { en } from "./en.ts";
import { createI18n, statePatternScore, type Catalog, type Translation } from "./i18n.ts";

const project: Catalog = {
  messages: {
    alarms: { tr2_oil_temp: { high: "TR2 oil temperature high", high_high: "TR2 oil temperature very high" }, f2_sf6: { _: "F2 breaker SF6 pressure low" } },
    command: { status: { success: "Done" } },
  },
  equipment: { "vds.sub.tr2": "TR2" },
  states: {
    "**.cb::pos": { "0": "Open", "1": "Closed", "2": "Intermediate", "3": "Invalid" },
    "vds.sub.mv.bc.cb::pos": { "0": "Coupler open" },
    "**::remote_local": { "0": "Local", "1": "Remote" },
  },
};

// Compile-time check: a translation must have every key of the English texts.
const pt: Translation<typeof en> = JSON.parse(JSON.stringify(en));
pt.connection.online = "Conectado";

const i18n = (locale = "en", onMissing?: (k: string) => void) =>
  createI18n({ locale, catalogs: { en: [{ messages: en }, project], pt: [{ messages: pt }] }, ...(onMissing ? { onMissing } : {}) });

describe("i18n", () => {
  it("translates keys with parameters", () => {
    expect(i18n().t("alarm.priority", { priority: 1 })).toBe("Priority 1");
  });

  it("lets the project override library texts", () => {
    expect(i18n().t("command.status.success")).toBe("Done");
    expect(i18n().t("command.status.blocked")).toBe("Blocked by interlock");
  });

  it("falls back to English, then to the key, and reports the miss once", () => {
    const onMissing = vi.fn();
    const t = i18n("pt", onMissing);
    expect(t.t("connection.online")).toBe("Conectado");
    // The Portuguese catalog has no project layer: plant texts fall back to English.
    expect(t.alarmText({ name: "tr2_oil_temp", condition: "high" })).toBe("TR2 oil temperature high");
    expect(t.equipmentName("vds.sub.tr2")).toBe("TR2");
    expect(t.t("no.such.key")).toBe("no.such.key");
    t.t("no.such.key");
    expect(onMissing).toHaveBeenCalledTimes(1);
  });

  it("switches locale at runtime", () => {
    const t = i18n();
    t.setLocale("pt");
    expect(t.locale.get()).toBe("pt");
    expect(t.t("connection.online")).toBe("Conectado");
  });

  it("names equipment, falling back to the id", () => {
    expect(i18n().equipmentName("vds.sub.tr2")).toBe("TR2");
    expect(i18n().equipmentName("vds.sub.tr9")).toBe("vds.sub.tr9");
  });

  it("labels discrete values by the most specific pattern", () => {
    const t = i18n();
    expect(t.stateLabel("vds.sub.mv.a.f1.cb::pos", 1)).toBe("Closed");
    expect(t.stateLabel("vds.sub.mv.bc.cb::pos", 0)).toBe("Coupler open");
    expect(t.stateLabel("vds.sub.mv.bc.cb::pos", 1)).toBe("Closed");
    expect(t.stateLabel("vds.sub.f1.cb::remote_local", true)).toBe("Remote");
    expect(t.stateLabel("vds.sub.f1.ds::pos", 1)).toBeNull();
    expect(t.stateLabel("vds.sub.f1.cb::pos", null)).toBeNull();
  });

  it("writes alarm text by name and condition, with fallbacks", () => {
    const onMissing = vi.fn();
    const t = i18n("en", onMissing);
    expect(t.alarmText({ name: "tr2_oil_temp", condition: "high_high" })).toBe("TR2 oil temperature very high");
    expect(t.alarmText({ name: "f2_sf6", condition: "stage1" })).toBe("F2 breaker SF6 pressure low");
    expect(t.alarmText({ name: "unknown", condition: "set" })).toBe("unknown · set");
    expect(onMissing).toHaveBeenCalledWith("alarms.unknown.set", "en");
  });

  it("formats numbers and dates for the locale", () => {
    expect(i18n().formatNumber(1186.5, { maximumFractionDigits: 1 })).toBe("1,186.5");
    expect(i18n().formatDateTime(new Date("2026-10-25T14:32:41Z"), { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false })).toBe("14:32");
  });
});

describe("statePatternScore", () => {
  it("scores literal segments higher", () => {
    const id = "vds.sub.mv.bc.cb::pos";
    expect(statePatternScore("vds.sub.mv.bc.cb::pos", id)).toBeGreaterThan(statePatternScore("**.cb::pos", id));
    expect(statePatternScore("**.cb::pos", id)).toBeGreaterThan(statePatternScore("**::*", id));
    expect(statePatternScore("*.cb::pos", id)).toBe(-1);
  });
});
