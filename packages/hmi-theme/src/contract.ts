/**
 * Theme contract: every theme defines every semantic token, and its colours
 * meet the contrast and separation rules the HMI relies on. Pure functions over
 * CSS text, so customers can run the same check on their own themes.
 */

import { THEME_TOKENS } from "./index.ts";

export type Vars = Record<string, string>;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Collects custom properties per selector from flat CSS (no nesting). */
export function parseCustomProperties(css: string): Map<string, Vars> {
  const blocks = new Map<string, Vars>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (block[1] ?? "").trim().replace(/\s+/g, " ");
    const vars: Vars = blocks.get(selector) ?? {};
    for (const decl of (block[2] ?? "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      vars[decl[1] as string] = (decl[2] as string).trim();
    }
    blocks.set(selector, vars);
  }
  return blocks;
}

/** The custom properties a `[data-theme="id"]` selector defines. */
export function themeVars(css: string, id: string): Vars {
  const wanted = `[data-theme="${id}"]`;
  const out: Vars = {};
  for (const [selector, vars] of parseCustomProperties(css)) {
    if (selector.split(",").some((s) => s.trim() === wanted)) Object.assign(out, vars);
  }
  return out;
}

/** Follows `var(--x)` references through the theme, then the brand tokens. */
export function resolve(value: string, scopes: Vars[], depth = 0): string {
  const ref = /^var\(--([\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!ref || depth > 10) return value.trim();
  for (const scope of scopes) {
    const next = scope[ref[1] as string];
    if (next !== undefined) return resolve(next, scopes, depth + 1);
  }
  return ref[2] !== undefined ? resolve(ref[2], scopes, depth + 1) : value.trim();
}

export function parseColor(value: string): Rgba | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex) {
    let h = hex[1] as string;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(value);
  if (fn) {
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) };
  }
  return null;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgba): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** HSL hue (degrees) and saturation (0 to 1). */
export function hueSat({ r, g, b }: Rgba): { hue: number; sat: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { hue: 0, sat: 0 };
  const sat = d / (1 - Math.abs(2 * l - 1));
  let hue = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  hue *= 60;
  return { hue: hue < 0 ? hue + 360 : hue, sat };
}

type Rule = [fg: string, bg: string, min: number];

const TEXT = 4.5;
const GRAPHIC = 3;

/** Contrast pairs every theme must meet. */
export const CONTRAST_RULES: readonly Rule[] = [
  ...["proc-bg", "proc-surface", "proc-surface-2"].flatMap((bg): Rule[] => [
    ["text-value", bg, TEXT],
    ["text-label", bg, TEXT],
  ]),
  ["text-strong", "proc-bg", TEXT],
  ["proc-line-live", "proc-bg", GRAPHIC],
  ["proc-line-live", "proc-surface", GRAPHIC],
  ["proc-line-dead", "proc-bg", GRAPHIC],
  ["proc-static", "proc-bg", GRAPHIC],
  ["proc-fill-closed", "proc-bg", GRAPHIC],
  // Energized and de-energized lines must be told apart by lightness.
  ["proc-line-live", "proc-line-dead", GRAPHIC],
  ...["alarm-p1", "alarm-p2", "alarm-p3", "alarm-interlock"].flatMap((alarm): Rule[] => [
    [alarm, "proc-bg", GRAPHIC],
    [alarm, "proc-surface", GRAPHIC],
    // Priority numbers are drawn in alarm-ink inside the alarm shape.
    ["alarm-ink", alarm, TEXT],
  ]),
  ["chrome-text", "chrome-bg", TEXT],
  ["chrome-text", "chrome-raised", TEXT],
  ["chrome-text-muted", "chrome-bg", TEXT],
  ["chrome-accent", "chrome-bg", GRAPHIC],
  ["focus-color", "chrome-bg", GRAPHIC],
];

/** On a coloured ground, alarm hues must sit at least this far from its hue. */
export const MIN_ALARM_HUE_GAP = 30;
const SATURATED_GROUND = 0.25;

/**
 * Checks one theme. `vars` are the theme's own properties, `brand` the tokens
 * they may reference. Returns human-readable failures; empty means it passes.
 */
export function checkTheme(id: string, vars: Vars, brand: Vars): string[] {
  const failures: string[] = [];
  const scopes = [vars, brand];
  const colour = (token: string): Rgba | null => {
    const raw = vars[token];
    return raw === undefined ? null : parseColor(resolve(raw, scopes));
  };

  for (const token of THEME_TOKENS) {
    const raw = vars[token];
    if (raw === undefined) failures.push(`${id}: missing --${token}`);
    else if (!colour(token)) failures.push(`${id}: --${token} is not a colour (${resolve(raw, scopes)})`);
  }

  for (const [fg, bg, min] of CONTRAST_RULES) {
    const a = colour(fg);
    const b = colour(bg);
    if (!a || !b) continue;
    const ratio = contrast(a, b);
    if (ratio < min) failures.push(`${id}: --${fg} on --${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
  }

  const ground = colour("proc-bg");
  if (ground && hueSat(ground).sat >= SATURATED_GROUND) {
    const g = hueSat(ground).hue;
    for (const alarm of ["alarm-p1", "alarm-p2", "alarm-p3", "alarm-interlock"]) {
      const c = colour(alarm);
      if (!c) continue;
      const diff = Math.abs(hueSat(c).hue - g);
      const gap = Math.min(diff, 360 - diff);
      if (gap < MIN_ALARM_HUE_GAP) {
        failures.push(`${id}: --${alarm} hue is ${gap.toFixed(0)}° from --proc-bg, needs ${MIN_ALARM_HUE_GAP}°`);
      }
    }
  }

  return failures;
}
