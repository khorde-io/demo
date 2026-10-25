import { THEMES } from "@khorde/hmi-theme";
import { describe, expect, it } from "vitest";
import { createThemeService, type StorageLike } from "./theme.ts";

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

const setup = (over: Partial<Parameters<typeof createThemeService>[0]> = {}) => {
  const storage = memory();
  const target = { dataset: {} as Record<string, string | undefined> };
  const theme = createThemeService({ themes: THEMES, defaultTheme: "dark-grey", storage, target, ...over });
  return { theme, storage, target };
};

describe("theme service", () => {
  it("starts on the default theme and applies it", () => {
    const { theme, target } = setup();
    expect(theme.get()).toBe("dark-grey");
    expect(target.dataset.theme).toBe("dark-grey");
  });

  it("switches and remembers the choice per user", () => {
    const { theme, storage, target } = setup();
    theme.setUser("alice");
    theme.set("ink");
    expect(target.dataset.theme).toBe("ink");
    expect(storage.data.get("khorde.hmi.theme.alice")).toBe("ink");

    theme.setUser("bob");
    expect(theme.get()).toBe("dark-grey");
    theme.setUser("alice");
    expect(theme.get()).toBe("ink");
  });

  it("ignores unknown or disallowed themes", () => {
    const { theme } = setup({ allowed: ["dark-grey", "ink"] });
    theme.set("range-green");
    theme.set("neon");
    expect(theme.get()).toBe("dark-grey");
    expect(theme.list().map((t) => t.id)).toEqual(["dark-grey", "ink"]);
  });

  it("keeps working when storage throws", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const { theme } = setup({ storage: broken });
    theme.set("range-green");
    expect(theme.get()).toBe("range-green");
  });

  it("notifies subscribers", () => {
    const { theme } = setup();
    const seen: string[] = [];
    theme.subscribe(() => seen.push(theme.get()));
    theme.set("ink");
    theme.set("range-green");
    expect(seen).toEqual(["ink", "range-green"]);
  });
});
