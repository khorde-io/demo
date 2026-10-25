import type { PointId } from "@khorde/hmi-core";
import { useI18n, usePoint } from "@khorde/hmi-react";

/**
 * A live value inside a drawing: number and unit, "?" while bad, dimmed while
 * stale. The unit comes from the dictionary unless given.
 */
export function SvgValue({
  id,
  x,
  y,
  decimals = 1,
  unit,
  anchor = "start",
  prefix,
}: {
  id: PointId;
  x: number;
  y: number;
  decimals?: number;
  unit?: string;
  anchor?: "start" | "middle" | "end";
  prefix?: string;
}) {
  const i18n = useI18n();
  const v = usePoint(id);
  const ok = v?.quality === "good" && typeof v.value === "number";
  const text = ok ? i18n.formatNumber(v.value as number, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "?";
  const cls = `sld-value${!ok ? " sld-value--bad" : v?.stale ? " sld-value--stale" : ""}`;
  return (
    <text className={cls} x={x} y={y} textAnchor={anchor}>
      {prefix && <tspan className="sld-value-label">{prefix} </tspan>}
      {text}
      <tspan className="sld-value-unit"> {unit ?? i18n.unit(id) ?? ""}</tspan>
    </text>
  );
}
