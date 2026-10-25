/**
 * Theme registry. The CSS lives next to this file; this module only describes
 * it, so the theme service, the picker and the contract test agree on which
 * themes exist and which tokens each must define.
 */

export interface ThemeInfo {
  /** Value of the `data-theme` attribute. */
  id: string;
  /** Dictionary key for the theme's display name. */
  nameKey: string;
  /** Stylesheet path inside this package. */
  file: string;
}

export const THEMES = [
  { id: "dark-grey", nameKey: "theme.darkGrey", file: "themes/dark-grey.css" },
  { id: "range-green", nameKey: "theme.rangeGreen", file: "themes/range-green.css" },
  { id: "ink", nameKey: "theme.ink", file: "themes/ink.css" },
] as const satisfies readonly ThemeInfo[];

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "dark-grey";

export function isThemeId(value: string): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

/** Semantic tokens every theme must define. Components use only these. */
export const THEME_TOKENS = [
  "proc-bg",
  "proc-surface",
  "proc-surface-2",
  "proc-border",
  "proc-line-live",
  "proc-line-dead",
  "proc-static",
  "proc-fill-closed",
  "proc-band-normal",
  "proc-track",
  "proc-scrim",
  "text-value",
  "text-label",
  "text-strong",
  "alarm-p1",
  "alarm-p2",
  "alarm-p3",
  "alarm-interlock",
  "alarm-ink",
  "chrome-bg",
  "chrome-raised",
  "chrome-strip",
  "chrome-accent",
  "chrome-text",
  "chrome-text-muted",
  "chrome-border",
  "focus-color",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
