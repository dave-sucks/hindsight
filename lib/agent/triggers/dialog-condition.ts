/**
 * dialog-condition.ts — one condition in the Add Trigger dialog, as data
 * (DAV-281). The dialog held a single condition's choices in a dozen
 * useStates and built the predicate inline, so there was no way to ask for a
 * second one. A condition is now a value: the dialog holds one, or two
 * ("and also…"), and both go through the same three functions here —
 * patch (a choice, with the defaults that follow from it), valid, predicate.
 *
 * Pure and client-safe: no server imports.
 */

export type AddCriterion = "PRICE" | "MOVE" | "GAIN" | "TRAIL" | "CADENCE" | "EARNINGS" | "FILING" | "CHART";

export type ChartKind =
  | "NEAR_SMA"
  | "VS_SMA"
  | "NEW_HIGH"
  | "PCT_FROM_52W_HIGH"
  | "VOLUME_RATIO"
  | "GAP_UP"
  | "RSI"
  | "RS_VS_SPY"
  | "INSIDER_CLUSTER";

export type CountFrom = "LAST_REVIEW" | "BUY" | "EVENT_AFTER" | "EVENT_BEFORE";

/** The Earnings row's select: a heads-up before the report, or the result. */
export type EarningsWhen = "WITHIN" | "BEAT" | "MISS";

export interface DialogCondition {
  criterion: AddCriterion;
  /** ABOVE / BELOW for a price or a chart level; UP / DOWN for a move or a gain. */
  dir: string;
  val: string;
  basis: "intraday" | "close";
  moveWindow: "1D" | "5D" | "20D";
  chartKind: ChartKind;
  chartParam: string;
  filingEvent: string;
  countFrom: CountFrom;
  earningsWhen: EarningsWhen;
}

export function defaultCondition(criterion: AddCriterion): DialogCondition {
  return patchCondition(
    {
      criterion,
      dir: "BELOW",
      val: "",
      basis: "intraday",
      moveWindow: "1D",
      chartKind: "NEAR_SMA",
      chartParam: "50",
      filingEvent: "tier:MATERIAL",
      countFrom: "LAST_REVIEW",
      earningsWhen: "WITHIN",
    },
    { criterion },
  );
}

/** The default second choice of a chart condition (which average, which window). */
export function defaultChartParam(k: ChartKind): string {
  switch (k) {
    case "NEAR_SMA":
    case "VS_SMA":
      return "50";
    case "NEW_HIGH":
      return "20D";
    case "RSI":
      return "14";
    case "RS_VS_SPY":
      return "3M";
    case "INSIDER_CLUSTER":
      return "30";
    default:
      return "";
  }
}

/** Apply one choice, plus the defaults that follow from it (the direction a criterion starts on, a chart kind's usual window). */
export function patchCondition(c: DialogCondition, patch: Partial<DialogCondition>): DialogCondition {
  let next = { ...c, ...patch };
  if (patch.criterion !== undefined) {
    const dir =
      patch.criterion === "GAIN" ? "UP" : patch.criterion === "MOVE" ? "DOWN" : patch.criterion === "PRICE" ? "BELOW" : patch.criterion === "CHART" ? "ABOVE" : next.dir;
    next = { ...next, dir };
  }
  if (patch.chartKind !== undefined) {
    next = { ...next, chartParam: defaultChartParam(patch.chartKind), ...(patch.chartKind === "RSI" ? { dir: "BELOW" } : {}) };
  }
  return next;
}

/** Does this chart condition take a number from the input? */
export function chartHasValue(k: ChartKind): boolean {
  return k !== "VS_SMA" && k !== "NEW_HIGH";
}

/** True when the condition can only be a review (a schedule, a heads-up, a filing, insider buying). */
export function conditionForcesReview(c: DialogCondition): boolean {
  if (c.criterion === "FILING") return true;
  if (c.criterion === "EARNINGS") return true;
  if (c.criterion === "CADENCE") return c.countFrom === "LAST_REVIEW";
  return c.criterion === "CHART" && c.chartKind === "INSIDER_CLUSTER";
}

export function conditionValid(c: DialogCondition): boolean {
  const num = Number(c.val);
  const filled = c.val.trim() !== "" && Number.isFinite(num);
  switch (c.criterion) {
    case "FILING":
      return true;
    case "CHART": {
      const k = c.chartKind;
      if (!chartHasValue(k)) return true;
      return (
        filled &&
        (k === "RS_VS_SPY" ? num > -100 : num > 0) &&
        (k !== "RSI" || num < 100) &&
        (k !== "NEAR_SMA" || num <= 10) &&
        (k !== "INSIDER_CLUSTER" || (Number.isInteger(num) && num <= 10))
      );
    }
    case "EARNINGS":
      // A beat or a miss needs no number: blank means any beat / any miss.
      if (c.earningsWhen !== "WITHIN") return c.val.trim() === "" || (filled && num > 0 && num < 1000);
      // The calendar lookahead is 14 days — a longer heads-up can't be seen.
      return filled && num > 0 && Number.isInteger(num) && num <= 14;
    case "CADENCE":
      return filled && num > 0 && Number.isInteger(num);
    case "MOVE":
      // A move is a fraction of the price — 100% or more is nonsense.
      return filled && num > 0 && num < 100;
    case "TRAIL":
      // Zod floors the trail at 1% (under that it re-fires on noise).
      return filled && num >= 1 && num < 100;
    default:
      // A price, or a gain from entry (which CAN exceed 100).
      return filled && num > 0;
  }
}

function filingPredicate(v: string): Record<string, unknown> {
  const [type, code] = [v.slice(0, v.indexOf(":")), v.slice(v.indexOf(":") + 1)];
  if (type === "tier") return { kind: "SEC_EVENT", tier: code };
  if (type === "item") return { kind: "SEC_EVENT", items: [code] };
  return { kind: "SEC_EVENT", forms: [code] };
}

/** The predicate one condition posts. */
export function conditionPredicate(c: DialogCondition): Record<string, unknown> {
  const num = Number(c.val);
  switch (c.criterion) {
    case "FILING":
      return filingPredicate(c.filingEvent);
    case "CHART":
      switch (c.chartKind) {
        case "NEAR_SMA":
          return { kind: "NEAR_SMA", period: Number(c.chartParam), withinPct: num };
        case "VS_SMA":
          return { kind: "VS_SMA", period: Number(c.chartParam), direction: c.dir };
        case "NEW_HIGH":
          return { kind: "NEW_HIGH", window: c.chartParam };
        case "PCT_FROM_52W_HIGH":
          return { kind: "PCT_FROM_52W_HIGH", max: num };
        case "VOLUME_RATIO":
          return { kind: "VOLUME_RATIO", min: num };
        case "GAP_UP":
          return { kind: "GAP_UP", minPct: num, minVolRatio: 3 };
        case "RSI":
          return { kind: "RSI", period: Number(c.chartParam), threshold: num, direction: c.dir };
        case "RS_VS_SPY":
          return { kind: "RS_VS_SPY", window: c.chartParam, min: num };
        case "INSIDER_CLUSTER":
          return { kind: "INSIDER_CLUSTER", minBuyers: num, days: Number(c.chartParam) };
      }
      break;
    case "EARNINGS":
      if (c.earningsWhen === "WITHIN") return { kind: "EARNINGS_WITHIN", days: num };
      return {
        kind: c.earningsWhen === "BEAT" ? "EARNINGS_BEAT" : "EARNINGS_MISS",
        ...(c.val.trim() !== "" ? { minSurprisePct: num } : {}),
      };
    case "CADENCE":
      return c.countFrom === "LAST_REVIEW"
        ? { kind: "REVIEW_CADENCE", days: num }
        : c.countFrom === "BUY"
          ? { kind: "REVIEW_CADENCE", days: num, from: "BUY" }
          : { kind: "REVIEW_CADENCE", days: num, from: "EVENT", side: c.countFrom === "EVENT_BEFORE" ? "BEFORE" : "AFTER" };
    case "GAIN":
      return { kind: "GAIN_FROM_ENTRY", pct: num, direction: c.dir };
    case "TRAIL":
      return { kind: "TRAILING_FROM_HIGH", pct: num };
    case "MOVE":
      return { kind: "PRICE_MOVE_PCT", pct: num, direction: c.dir, window: c.moveWindow };
    case "PRICE":
      return {
        kind: c.dir === "ABOVE" ? "PRICE_ABOVE" : "PRICE_BELOW",
        level: num,
        ...(c.basis === "close" ? { basis: "close" } : {}),
      };
  }
  return {};
}

/** The predicate the dialog posts: the one condition, or both joined by AND. */
export function dialogPredicate(first: DialogCondition, second: DialogCondition | null): Record<string, unknown> {
  return second ? { kind: "AND", predicates: [conditionPredicate(first), conditionPredicate(second)] } : conditionPredicate(first);
}
