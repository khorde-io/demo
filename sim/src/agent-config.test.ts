import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { agentConfigs, agentConfigYaml } from "./agent-config.ts";
import { buildPlant, driverPath, type Expr } from "./plant.ts";

const schema = JSON.parse(readFileSync(new URL("../site-config/agent-config.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);

const plant = buildPlant();
const configs = agentConfigs(plant);

/** Comparisons (`[op, equipment::name]`) an interlock expression makes, and the keys it refers to. */
function walk(e: Expr, compares: [string, string][] = [], refs: string[] = []) {
  for (const [op, arg] of Object.entries(e)) {
    if (op === "ref") refs.push(arg as string);
    else if (op === "not") walk(arg as Expr, compares, refs);
    else if (op === "and" || op === "or") for (const x of arg as Expr[]) walk(x, compares, refs);
    else compares.push([op, (arg as [string, number])[0]]);
  }
  return { compares, refs };
}

describe("agent config", () => {
  it.each(Object.entries(configs))("%s matches the agent-config schema", (_, config) => {
    validate(config);
    expect((validate.errors ?? []).slice(0, 3)).toEqual([]);
  });

  it("has the option C plant: 24 turbines, 2 transformers", () => {
    expect(plant.turbines).toHaveLength(24);
    expect(plant.transformers).toHaveLength(2);
    expect(plant.turbines.map((t) => t.number)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it("scales with the turbine count", () => {
    expect(buildPlant({ turbinesPerFeeder: 2 }).turbines).toHaveLength(8);
  });

  it("uses unique point, alarm, command and interlock names", () => {
    const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
    expect(dupes(plant.points.map((p) => `${p.equipment}::${p.name}`))).toEqual([]);
    expect(dupes(plant.points.map((p) => driverPath(p.equipment, p.name)))).toEqual([]);
    expect(dupes(plant.alarms.map((a) => a.config.name))).toEqual([]);
    expect(dupes(plant.commands.map((c) => `${c.equipment}::${c.name}`))).toEqual([]);
    expect(dupes(plant.interlocks.map((i) => i.key))).toEqual([]);
  });

  it("only refers to points and interlocks of the same agent", () => {
    const problems: string[] = [];
    for (const [agent, config] of Object.entries(configs)) {
      const points = new Set(config.measurements.map((m) => `${m.equipment}::${m.name}`));
      const discrete = new Set(config.measurements.filter((m) => m.type === "discrete").map((m) => `${m.equipment}::${m.name}`));
      const keys = new Set(config.interlocks.map((i) => i.key as string));
      for (const a of config.alarms) if (!points.has(a.meas as string)) problems.push(`${agent} alarm ${a.name}: no point ${a.meas}`);
      for (const c of config.commands) {
        const key = (c.interlock as { key: string } | undefined)?.key;
        if (key && !keys.has(key)) problems.push(`${agent} command ${c.equipment} ${c.name}: no interlock ${key}`);
      }
      for (const i of config.interlocks) {
        const { compares, refs } = walk(i.expression as Expr);
        for (const r of refs) if (!keys.has(r)) problems.push(`${agent} interlock ${i.key}: no interlock ${r}`);
        for (const [op, p] of compares) {
          if (!points.has(p)) problems.push(`${agent} interlock ${i.key}: no point ${p}`);
          // `eq` and `ne` only work on discrete points.
          else if ((op === "eq" || op === "ne") && !discrete.has(p)) problems.push(`${agent} interlock ${i.key}: ${op} on analog ${p}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("round-trips through YAML", () => {
    const yaml = agentConfigYaml(plant);
    expect(yaml.startsWith("# yaml-language-server: $schema=")).toBe(true);
    expect(parse(yaml)).toEqual(JSON.parse(JSON.stringify(configs)));
  });

  it("matches the committed site-config/vds-agents.yaml (run npm run gen after changing plant.ts)", () => {
    const committed = readFileSync(new URL("../site-config/vds-agents.yaml", import.meta.url), "utf8");
    expect(committed).toBe(agentConfigYaml(plant));
  });
});
