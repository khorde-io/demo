/**
 * Words for interlock conditions, from the frontend dictionaries: equipment
 * names, state labels, point names and units. Nothing here is hard-coded per
 * plant; a project describes its points in its catalog.
 */

import { NEGATED, parsePointId, type CompareOp, type Condition, type I18n, type Operand, type PointId, type PointValue } from "@khorde/hmi-core";

export const OP_SYMBOL: Readonly<Record<CompareOp, string>> = { eq: "=", ne: "≠", gt: ">", ge: "≥", lt: "<", le: "≤" };
/** `5 < x` read from the point's side is `x > 5`. */
const MIRROR: Readonly<Record<CompareOp, CompareOp>> = { eq: "eq", ne: "ne", gt: "lt", lt: "gt", ge: "le", le: "ge" };

const isPoint = (o: Operand): o is PointId => typeof o === "string" && o.includes("::");

export interface ConditionText {
  /** Fits a ladder gate: "DS A Closed", "F1 Voltage < 1 kV". */
  short: string;
  /** For the condition list. */
  full: string;
  /** The expression as configured: "eq vds.sub.mv.bc.ds_a::pos, 1". */
  expression: string;
  /** The point whose current value explains the condition, if any. */
  subject: PointId | null;
}

function equipmentOf(i18n: I18n, id: PointId): string {
  return i18n.equipmentName(parsePointId(id).equipment);
}

function valueText(i18n: I18n, id: PointId, value: number): string {
  const label = i18n.stateLabel(id, value);
  if (label !== null) return label;
  const unit = i18n.unit(id);
  return unit ? `${i18n.formatNumber(value)} ${unit}` : i18n.formatNumber(value);
}

export function describeCondition(i18n: I18n, c: Condition): ConditionText {
  if (c.ref !== null || !c.compare) {
    const key = c.ref ?? "?";
    return { short: key, full: i18n.t("interlock.shared", { key }), expression: `ref ${key}`, subject: null };
  }
  const { op: shownOp, operands } = c.compare;
  const configuredOp = c.negated ? NEGATED[shownOp] : shownOp;
  const expression = `${c.negated ? "not " : ""}${configuredOp} ${operands[0]}, ${operands[1]}`;
  const [a, b] = operands;

  // Point against point: name both sides.
  if (isPoint(a) && isPoint(b)) {
    const side = (id: PointId) => `${equipmentOf(i18n, id)} ${i18n.pointName(id) ?? parsePointId(id).name}`;
    const text = `${side(a)} ${OP_SYMBOL[shownOp]} ${side(b)}`;
    return { short: text, full: text, expression, subject: a };
  }
  const point = isPoint(a) ? a : isPoint(b) ? b : null;
  if (!point) {
    const text = `${a} ${OP_SYMBOL[shownOp]} ${b}`;
    return { short: text, full: text, expression, subject: null };
  }
  const value = Number(point === a ? b : a);
  const op = point === a ? shownOp : MIRROR[shownOp];
  const equipment = equipmentOf(i18n, point);
  const name = i18n.pointName(point);
  const state = i18n.stateLabel(point, value);

  if (state !== null && (op === "eq" || op === "ne")) {
    const wanted = op === "eq" ? state : i18n.t("interlock.notValue", { value: state });
    return { short: `${equipment} ${wanted}`, full: `${equipment}${name ? ` ${name.toLowerCase()}` : ""} ${wanted}`, expression, subject: point };
  }
  const wanted = `${OP_SYMBOL[op]} ${valueText(i18n, point, value)}`;
  const named = `${equipment} ${name ?? parsePointId(point).name}`;
  return { short: `${named} ${wanted}`, full: `${named} ${wanted}`, expression, subject: point };
}

/** "Closed", "34.6 kV", or a quality text when the value cannot be shown. */
export function currentValueText(i18n: I18n, v: PointValue | undefined): string {
  if (!v || v.value === null) return i18n.t("quality.noValue");
  if (v.quality !== "good") return i18n.t("quality.bad");
  if (v.stale) return i18n.t("quality.stale");
  if (typeof v.value === "boolean") return i18n.stateLabel(v.id, v.value) ?? String(v.value);
  if (typeof v.value !== "number") return v.value;
  return valueText(i18n, v.id, v.value);
}
