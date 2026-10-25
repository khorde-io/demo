import { describe, expect, it } from "vitest";
import { parsePointId, pointId, pointPath } from "./model.ts";
import { covers, isPattern, matchPath, pathMatcher, reducePatterns } from "./paths.ts";

describe("matchPath", () => {
  it.each([
    ["vds.sub.f1.cb.pos", "vds.sub.f1.cb.pos", true],
    ["vds.sub.*.cb.pos", "vds.sub.f1.cb.pos", true],
    ["vds.sub.*.pos", "vds.sub.f1.cb.pos", false],
    ["vds.sub.>", "vds.sub.f1.cb.pos", true],
    ["vds.sub.>", "vds.sub", false],
    ["vds.*.>", "vds.wf.f1", true],
    ["vds.wf.*.*.p_kw", "vds.wf.f1.t01.p_kw", true],
    ["vds.wf.*.*.p_kw", "vds.wf.f1.t01.q_kvar", false],
  ])("%s matches %s → %s", (pattern, path, expected) => {
    expect(matchPath(pattern, path)).toBe(expected);
  });

  it("recognizes patterns", () => {
    expect(isPattern("vds.sub.>")).toBe(true);
    expect(isPattern("vds.sub.f1.cb.pos")).toBe(false);
  });
});

describe("covers and reducePatterns", () => {
  it("knows when one pattern contains another", () => {
    expect(covers("vds.>", "vds.sub.f1.cb.pos")).toBe(true);
    expect(covers("vds.>", "vds.sub.>")).toBe(true);
    expect(covers("vds.sub.>", "vds.>")).toBe(false);
    expect(covers("vds.*.f1", "vds.sub.f1")).toBe(true);
    expect(covers("vds.sub.f1", "vds.*.f1")).toBe(false);
  });

  it("drops covered entries and duplicates", () => {
    expect(reducePatterns(["vds.sub.f1.cb.pos", "vds.sub.>", "vds.wf.f1.t01.p_kw", "vds.sub.>"]).sort()).toEqual([
      "vds.sub.>",
      "vds.wf.f1.t01.p_kw",
    ]);
  });
});

describe("pathMatcher", () => {
  it("matches exact paths and patterns like matchPath", () => {
    const m = pathMatcher(["vds.sub.f1.cb.pos", "vds.wf.*.t01.p_kw", "vds.sub.tr1.>"]);
    expect(["vds.sub.f1.cb.pos", "vds.wf.f1.t01.p_kw", "vds.sub.tr1.oil_temp"].map(m)).toEqual([true, true, true]);
    expect(["vds.sub.f1.cb", "vds.wf.f1.t02.p_kw", "vds.sub.tr1"].map(m)).toEqual([false, false, false]);
  });

  it("reduces thousands of exact paths quickly", () => {
    const many = Array.from({ length: 5000 }, (_, i) => `vds.x.p${i}.v`);
    const t = performance.now();
    expect(reducePatterns([...many, "vds.x.p1.>"])).toHaveLength(4999 + 1);
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe("point ids", () => {
  it("round-trips equipment::name and builds the dotted path", () => {
    const id = pointId("vds.sub.f1.cb", "pos");
    expect(id).toBe("vds.sub.f1.cb::pos");
    expect(parsePointId(id)).toEqual({ equipment: "vds.sub.f1.cb", name: "pos" });
    expect(pointPath(id)).toBe("vds.sub.f1.cb.pos");
  });

  it("rejects malformed ids", () => {
    expect(() => parsePointId("vds.sub.f1.cb.pos")).toThrow("Not a point id");
    expect(() => parsePointId("::pos")).toThrow("Not a point id");
  });
});
