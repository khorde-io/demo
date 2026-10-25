/**
 * Khorde's dotted-path wildcards, as used by `measByPaths`, alarm areas and
 * history filters: `*` matches exactly one segment, a trailing `>` matches one
 * or more remaining segments.
 */

export function isPattern(path: string): boolean {
  return path.split(".").some((s) => s === "*" || s === ">");
}

export function matchPath(pattern: string, path: string): boolean {
  const p = pattern.split(".");
  const s = path.split(".");
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg === ">") return i === p.length - 1 && s.length > i;
    if (i >= s.length) return false;
    if (seg !== "*" && seg !== s[i]) return false;
  }
  return p.length === s.length;
}

export function matchAny(patterns: readonly string[], path: string): boolean {
  return patterns.some((p) => matchPath(p, path));
}

/** Drops patterns already covered by another one in the list (keeps order). */
export function reducePatterns(patterns: Iterable<string>): string[] {
  const unique = [...new Set(patterns)];
  return unique.filter((p) => !unique.some((q) => q !== p && covers(q, p)));
}

/** True when every path `inner` matches is also matched by `outer`. */
export function covers(outer: string, inner: string): boolean {
  const o = outer.split(".");
  const n = inner.split(".");
  for (let i = 0; i < o.length; i++) {
    const seg = o[i];
    if (seg === ">") return n.length > i;
    if (i >= n.length) return false;
    const other = n[i];
    if (other === ">") return false;
    if (seg !== "*" && seg !== other) return false;
  }
  return o.length === n.length;
}
