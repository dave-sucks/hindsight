/**
 * The translator between today's predicate kinds and the condition shape.
 *
 *   fromLegacy: every stored kind → a condition (or a group of them).
 *   toLegacy:   a condition → the kind that says the same thing, or null when
 *               no kind can (a new option, held back until the cutover).
 *
 * Until PR 3 the server stores and checks kinds, so the dialog builds a
 * condition and saves `toLegacy(condition)`. docs/plans/TRIGGER_TYPES.md §9.
 *
 * Pure and client-safe.
 */

import type { TriggerPredicate } from "../types";
import type { Condition, Group, Params, Retired, VariableId, When } from "./types";
import { isGroup } from "./types";

type Kind<K extends TriggerPredicate["kind"]> = Extract<TriggerPredicate, { kind: K }>;

const SMA = { 20: "sma20", 50: "sma50", 150: "sma150", 200: "sma200" } as const;
const MOVE_VARIABLE = { "1D": "prev_close", "5D": "close_5d", "20D": "close_20d" } as const;
const MOVE_WINDOW = { prev_close: "1D", close_5d: "5D", close_20d: "20D" } as const;
const UNIT_DAYS = { days: 1, weeks: 7, months: 30 } as const;

function withParams(c: Condition, params: Params): Condition {
  return Object.keys(params).length ? { ...c, params } : c;
}

// ── kinds → conditions ────────────────────────────────────────────────

export function fromLegacy(p: unknown): When | Retired {
  if (!p || typeof p !== "object" || typeof (p as { kind?: unknown }).kind !== "string") {
    return { retired: true, was: p };
  }
  const q = p as TriggerPredicate;
  switch (q.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return withParams(
        { watch: "price", unit: "$", is: q.kind === "PRICE_ABOVE" ? "above" : "below", value: q.level },
        q.basis === "close" ? { onClose: true } : {},
      );
    case "VS_SMA":
      return { watch: "price", unit: "$", is: q.direction === "ABOVE" ? "above" : "below", variable: SMA[q.period] };
    case "NEW_HIGH":
      return { watch: "price", unit: "$", is: "above", variable: q.window === "20D" ? "high20" : "high52" };
    case "PRICE_MOVE_PCT":
      return { watch: "price", unit: "%", is: q.direction === "UP" ? "above" : "below", value: q.pct, variable: MOVE_VARIABLE[q.window] };
    case "GAIN_FROM_ENTRY":
      return withParams(
        { watch: "price", unit: "%", is: q.direction === "UP" ? "above" : "below", value: q.pct, variable: "entry" },
        q.skipIfPeakGainPct != null
          ? { fastWinner: { gainPct: q.skipIfPeakGainPct, ...(q.skipIfPeakWithinDays != null ? { withinDays: q.skipIfPeakWithinDays } : {}) } }
          : {},
      );
    case "TRAILING_FROM_HIGH":
      return withParams(
        { watch: "price", unit: "%", is: "below", value: q.pct, variable: "peak" },
        {
          ...(q.armAtGainPct != null ? { startOnceUpPct: q.armAtGainPct } : {}),
          ...(q.atrMultiple != null ? { widenAtr: q.atrMultiple } : {}),
        },
      );
    case "NEAR_SMA":
      return { watch: "price", unit: "%", is: "near", value: q.withinPct, variable: SMA[q.period] };
    case "PCT_FROM_52W_HIGH":
      return { watch: "price", unit: "%", is: "near", value: q.max, variable: "high52" };
    case "VOLUME_RATIO":
      return { watch: "volume", is: "above", value: q.min };
    case "RSI":
      return withParams(
        { watch: "rsi", is: q.direction === "ABOVE" ? "above" : "below", value: q.threshold },
        q.period != null ? { period: q.period } : {},
      );
    case "RS_VS_SPY":
      return { watch: "strength", is: "above", value: q.min, params: { window: q.window } };
    case "GAP_UP":
      return {
        watch: "gap",
        is: "above",
        value: q.minPct,
        params: { volume: q.minVolRatio, ...(q.withinDays != null ? { withinDays: q.withinDays } : {}) },
      };
    case "INSIDER_CLUSTER":
      return { watch: "insiders", is: "at_least", value: q.minBuyers, params: { days: q.days } };
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
      // A negative minimum is ignored by today's checker (any beat or miss
      // fires), so it reads as 0. Two retired rows carry one.
      return { watch: "surprise", is: q.kind === "EARNINGS_BEAT" ? "beat" : "miss", value: Math.max(0, q.minSurprisePct ?? 0) };
    case "EARNINGS_WITHIN":
      return { watch: "report", is: "before", value: q.days };
    case "EARNINGS_SINCE":
      return { watch: "report", is: "after", value: q.max, params: { fromDay: q.min } };
    case "SEC_EVENT":
      return secEventFromLegacy(q);
    case "REVIEW_CADENCE":
      return cadenceFromLegacy(q);
    case "AND":
    case "OR": {
      const conditions = q.predicates.map(fromLegacy);
      if (conditions.some((c) => "retired" in c)) return { retired: true, was: p };
      return { match: q.kind === "AND" ? "all" : "any", conditions: conditions as When[] };
    }
    default:
      return { retired: true, was: p };
  }
}

function secEventFromLegacy(q: Kind<"SEC_EVENT">): When {
  const is = q.tier === "RED" ? "red_flag" : "material";
  const events: VariableId[] = [
    ...(q.items ?? []).map((i) => `item:${i}` as const),
    ...(q.forms ?? []).map((f) => `form:${f}` as const),
  ];
  if (events.length === 0) return { watch: "filing", is };
  if (events.length === 1) return { watch: "filing", is, variable: events[0] };
  // A rule naming several events (the Catalyst seat's 8.01 + 7.01 wake) is
  // "any of" one-event conditions. toLegacy folds it back into one kind.
  return { match: "any", conditions: events.map((variable) => ({ watch: "filing", is, variable })) };
}

function cadenceFromLegacy(q: Kind<"REVIEW_CADENCE">): Condition {
  const from = q.from ?? "LAST_REVIEW";
  if (from === "BUY") return { watch: "schedule", is: "after", value: q.days, variable: "buy" };
  if (from === "EVENT") return { watch: "schedule", is: q.side === "BEFORE" ? "before" : "after", value: q.days, variable: "event" };
  return { watch: "schedule", is: "every", value: q.days };
}

// ── conditions → kinds ────────────────────────────────────────────────

export function toLegacy(w: When): TriggerPredicate | null {
  if (isGroup(w)) {
    const folded = foldFilingEvents(w);
    if (folded) return folded;
    const parts = w.conditions.map(toLegacy);
    if (parts.some((part) => part == null)) return null;
    return { kind: w.match === "all" ? "AND" : "OR", predicates: parts as TriggerPredicate[] };
  }
  return conditionToLegacy(w);
}

function conditionToLegacy(c: Condition): TriggerPredicate | null {
  const v = c.value;
  const params = c.params ?? {};
  switch (c.watch) {
    case "price":
      return priceToLegacy(c);
    case "volume":
      return c.is === "above" && v != null && !params.onClose ? { kind: "VOLUME_RATIO", min: v } : null;
    case "rsi":
      if (v == null || (c.is !== "above" && c.is !== "below")) return null;
      return {
        kind: "RSI",
        ...(params.period != null ? { period: params.period } : {}),
        threshold: v,
        direction: c.is === "above" ? "ABOVE" : "BELOW",
      };
    case "strength":
      return c.is === "above" && v != null ? { kind: "RS_VS_SPY", window: params.window ?? "3M", min: v } : null;
    case "gap":
      return v != null
        ? {
            kind: "GAP_UP",
            minPct: v,
            minVolRatio: params.volume ?? 3,
            ...(params.withinDays != null ? { withinDays: params.withinDays } : {}),
          }
        : null;
    case "insiders":
      return v != null ? { kind: "INSIDER_CLUSTER", minBuyers: v, days: params.days ?? 30 } : null;
    case "surprise":
      if (c.is !== "beat" && c.is !== "miss") return null;
      return { kind: c.is === "beat" ? "EARNINGS_BEAT" : "EARNINGS_MISS", ...(v != null && v > 0 ? { minSurprisePct: v } : {}) };
    case "report":
      if (v == null) return null;
      if (c.is === "before") return { kind: "EARNINGS_WITHIN", days: v };
      if (c.is === "after") return { kind: "EARNINGS_SINCE", min: params.fromDay ?? 0, max: v };
      return null;
    case "filing":
      return filingToLegacy(c);
    case "schedule":
      return scheduleToLegacy(c);
  }
}

function priceToLegacy(c: Condition): TriggerPredicate | null {
  const v = c.value;
  const params = c.params ?? {};
  const onClose = params.onClose === true;
  const variable = c.variable;
  if (c.unit !== "%") {
    if (!variable) {
      if (v == null || (c.is !== "above" && c.is !== "below")) return null;
      return { kind: c.is === "above" ? "PRICE_ABOVE" : "PRICE_BELOW", level: v, ...(onClose ? { basis: "close" as const } : {}) };
    }
    if (onClose) return null;
    const period = smaPeriod(variable);
    if (period && (c.is === "above" || c.is === "below")) {
      return { kind: "VS_SMA", period, direction: c.is === "above" ? "ABOVE" : "BELOW" };
    }
    if ((variable === "high20" || variable === "high52") && c.is === "above") {
      return { kind: "NEW_HIGH", window: variable === "high20" ? "20D" : "52W" };
    }
    return null;
  }
  if (onClose || !variable || v == null) return null;
  if (c.is === "near") {
    const period = smaPeriod(variable);
    if (period) return { kind: "NEAR_SMA", period, withinPct: v };
    if (variable === "high52") return { kind: "PCT_FROM_52W_HIGH", max: v };
    return null;
  }
  if (c.is !== "above" && c.is !== "below") return null;
  const direction = c.is === "above" ? "UP" : "DOWN";
  if (variable === "prev_close" || variable === "close_5d" || variable === "close_20d") {
    return { kind: "PRICE_MOVE_PCT", pct: v, direction, window: MOVE_WINDOW[variable] };
  }
  if (variable === "entry") {
    const fast = params.fastWinner;
    return {
      kind: "GAIN_FROM_ENTRY",
      pct: v,
      direction,
      ...(fast ? { skipIfPeakGainPct: fast.gainPct, ...(fast.withinDays != null ? { skipIfPeakWithinDays: fast.withinDays } : {}) } : {}),
    };
  }
  if (variable === "peak" && c.is === "below") {
    return {
      kind: "TRAILING_FROM_HIGH",
      pct: v,
      ...(params.startOnceUpPct != null ? { armAtGainPct: params.startOnceUpPct } : {}),
      ...(params.widenAtr != null ? { atrMultiple: params.widenAtr } : {}),
    };
  }
  return null;
}

function filingToLegacy(c: Condition): TriggerPredicate | null {
  if (c.is !== "material" && c.is !== "red_flag") return null;
  const variable = c.variable;
  if (!variable) return { kind: "SEC_EVENT", tier: c.is === "red_flag" ? "RED" : "MATERIAL" };
  if (variable.startsWith("item:")) return { kind: "SEC_EVENT", items: [variable.slice(5)] };
  if (variable.startsWith("form:")) return { kind: "SEC_EVENT", forms: [variable.slice(5)] };
  return null;
}

function scheduleToLegacy(c: Condition): TriggerPredicate | null {
  const v = c.value;
  if (v == null) return null;
  if (c.is === "every" && !c.variable) {
    return { kind: "REVIEW_CADENCE", days: Math.round(v * UNIT_DAYS[c.params?.every ?? "days"]) };
  }
  if (c.variable === "buy") return c.is === "after" ? { kind: "REVIEW_CADENCE", days: v, from: "BUY" } : null;
  if (c.variable === "event" && (c.is === "before" || c.is === "after")) {
    return { kind: "REVIEW_CADENCE", days: v, from: "EVENT", side: c.is === "before" ? "BEFORE" : "AFTER" };
  }
  return null;
}

/** "Any of" one-event filing conditions is one SEC_EVENT naming them all. */
function foldFilingEvents(g: Group): TriggerPredicate | null {
  if (g.match !== "any" || g.conditions.length < 2) return null;
  const items: string[] = [];
  const forms: string[] = [];
  let is: string | null = null;
  for (const c of g.conditions) {
    if (isGroup(c) || c.watch !== "filing" || !c.variable) return null;
    if (is != null && c.is !== is) return null;
    is = c.is;
    if (c.variable.startsWith("item:")) items.push(c.variable.slice(5));
    else if (c.variable.startsWith("form:")) forms.push(c.variable.slice(5));
    else return null;
  }
  return { kind: "SEC_EVENT", ...(items.length ? { items } : {}), ...(forms.length ? { forms } : {}) };
}

function smaPeriod(variable: VariableId): 20 | 50 | 150 | 200 | null {
  switch (variable) {
    case "sma20":
      return 20;
    case "sma50":
      return 50;
    case "sma150":
      return 150;
    case "sma200":
      return 200;
    default:
      return null;
  }
}
