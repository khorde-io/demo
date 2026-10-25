import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkTheme, contrast, parseColor, parseCustomProperties, resolve, themeVars } from "./contract.ts";
import { DEFAULT_THEME, THEMES, isThemeId } from "./index.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const brand = parseCustomProperties(read("./brand.css")).get(":root") ?? {};

describe.each(THEMES)("theme $id", ({ id, file }) => {
  const vars = themeVars(read(`./${file}`), id);

  it("defines every token with colours that meet the contract", () => {
    expect(checkTheme(id, vars, brand)).toEqual([]);
  });

  it("is imported by index.css", () => {
    expect(read("./index.css")).toContain(`./${file}`);
  });
});

describe("registry", () => {
  it("has a valid default theme", () => {
    expect(isThemeId(DEFAULT_THEME)).toBe(true);
  });

  it("puts the default theme on :root", () => {
    const file = THEMES.find((t) => t.id === DEFAULT_THEME)?.file ?? "";
    const blocks = parseCustomProperties(read(`./${file}`));
    expect([...blocks.keys()].some((s) => s.split(",").map((p) => p.trim()).includes(":root"))).toBe(true);
  });
});

describe("contract helpers", () => {
  it("parses hex and rgb colours", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#00282680")?.a).toBeCloseTo(0.5, 2);
    expect(parseColor("rgba(10, 12, 12, 0.62)")).toEqual({ r: 10, g: 12, b: 12, a: 0.62 });
    expect(parseColor("red")).toBeNull();
  });

  it("computes WCAG contrast", () => {
    const black = parseColor("#000000")!;
    const white = parseColor("#ffffff")!;
    expect(contrast(black, white)).toBeCloseTo(21, 5);
  });

  it("resolves var() chains and fallbacks", () => {
    expect(resolve("var(--a)", [{ a: "var(--b)" }, { b: "#123456" }])).toBe("#123456");
    expect(resolve("var(--missing, #abcdef)", [{}])).toBe("#abcdef");
  });

  it("reports a missing token and a failing pair", () => {
    const failures = checkTheme("broken", { "text-value": "#333333", "proc-bg": "#2b2f2f" }, brand);
    expect(failures).toContain("broken: missing --proc-surface");
    expect(failures.some((f) => f.startsWith("broken: --text-value on --proc-bg"))).toBe(true);
  });

  it("rejects an alarm hue close to a saturated ground", () => {
    const failures = checkTheme("teal", { "proc-bg": "#062a27", "alarm-p3": "#2fa8b5" }, brand);
    expect(failures.some((f) => f.includes("--alarm-p3 hue"))).toBe(true);
  });
});
