/**
 * The trigger rules as the kinds answered them, frozen as they stood on
 * 2026-10-04 (the commit before the cutover's first stage). rules.test.ts
 * checks the measure catalog against them over every stored trigger.
 *
 * Test-only, and never edited to make a test pass: a disagreement is a
 * change in how a trigger behaves, which is decided on its own, never inside
 * a refactor.
 */

import { trailFireLevel } from "../../trail";
import type { TriggerAction, TriggerPredicate } from "../../types";

/** The cascade bucket's predicate half (bucket.ts). */
export function predicateKey(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return p.kind;
    case "PRICE_MOVE_PCT":
      return `${p.kind}:${p.window}:${p.direction}`;
    case "GAIN_FROM_ENTRY":
      return `${p.kind}:${p.direction}`;
    case "TRAILING_FROM_HIGH":
      return p.kind;
    case "VS_SMA":
      return `${p.kind}:${p.period}:${p.direction}`;
    case "NEAR_SMA":
      return `${p.kind}:${p.period}`;
    case "VOLUME_RATIO":
    case "PCT_FROM_52W_HIGH":
    case "GAP_UP":
    case "INSIDER_CLUSTER":
      return p.kind;
    case "NEW_HIGH":
    case "RS_VS_SPY":
      return `${p.kind}:${p.window}`;
    case "RSI":
      return `${p.kind}:${p.period ?? 14}:${p.direction}`;
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
    case "EARNINGS_WITHIN":
    case "EARNINGS_SINCE":
      return p.kind;
    case "SEC_EVENT":
      return p.tier
        ? `${p.kind}:tier`
        : `${p.kind}:${[...(p.items ?? []), ...(p.forms ?? [])].sort().join("|")}`;
    case "REVIEW_CADENCE":
      return (p.from ?? "LAST_REVIEW") === "LAST_REVIEW"
        ? p.kind
        : `${p.kind}:${p.from}:${p.from === "EVENT" ? (p.side ?? "AFTER") : ""}`;
    case "AND":
    case "OR":
      return `${p.kind}:${p.predicates.map(predicateKey).sort().join("|")}`;
  }
}

/** The cascade bucket (bucket.ts): a buy on a typed price is one bucket whichever way it's set. */
export function triggerBucket(t: { predicate: TriggerPredicate; action: TriggerAction }): string {
  if (t.action === "ENTER" && (t.predicate.kind === "PRICE_ABOVE" || t.predicate.kind === "PRICE_BELOW")) {
    return "PRICE_LEVEL::ENTER";
  }
  return `${predicateKey(t.predicate)}::${t.action}`;
}

/** The default cooldown (defaults.ts). */
export function defaultCooldownDaysForPredicate(p: TriggerPredicate, action?: TriggerAction): number {
  switch (p.kind) {
    case "SEC_EVENT":
      return 0;
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
      return 7;
    case "EARNINGS_WITHIN":
    case "EARNINGS_SINCE":
    case "INSIDER_CLUSTER":
      return 30;
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
    case "PRICE_MOVE_PCT":
    case "NEAR_SMA":
    case "VOLUME_RATIO":
    case "NEW_HIGH":
    case "RSI":
      return 1;
    case "RS_VS_SPY":
      return 7;
    case "VS_SMA":
    case "PCT_FROM_52W_HIGH":
      return action === "REVIEW" ? 7 : 1;
    case "GAP_UP":
      return Math.max(1, p.withinDays ?? 1);
    case "GAIN_FROM_ENTRY":
      return 7;
    case "TRAILING_FROM_HIGH":
      return 1;
    case "REVIEW_CADENCE":
      return p.days;
    case "AND":
    case "OR":
      return Math.max(1, ...p.predicates.map((child) => defaultCooldownDaysForPredicate(child, action)));
  }
}

/** A state, not a moment (state-cooldown.ts). */
export function isStatePredicate(p: { kind: string; predicates?: readonly { kind: string }[] }): boolean {
  switch (p.kind) {
    case "VS_SMA":
    case "PCT_FROM_52W_HIGH":
    case "RS_VS_SPY":
      return true;
    case "AND":
    case "OR": {
      const children = p.predicates ?? [];
      return children.length > 0 && children.every(isStatePredicate);
    }
    default:
      return false;
  }
}

/** The weekly floor on a state review (state-cooldown.ts). */
export function flooredCooldownDays(trigger: { action: string; predicate: TriggerPredicate }, days: number): number {
  return trigger.action === "REVIEW" && isStatePredicate(trigger.predicate) ? Math.max(days, 7) : days;
}

/** A sale that can go straight to a proposal (types.ts). */
export function isDirectEligiblePredicate(kind: string): boolean {
  return ["PRICE_ABOVE", "PRICE_BELOW", "PRICE_MOVE_PCT", "GAIN_FROM_ENTRY", "TRAILING_FROM_HIGH"].includes(kind);
}

/** The label a protective sale closes with (types.ts). */
export function protectiveExitCloseReason(predicate: TriggerPredicate, direction: string | null): "STOP" | "TARGET" | null {
  if (!isDirectEligiblePredicate(predicate.kind)) return null;
  const isLong = direction !== "SHORT";
  switch (predicate.kind) {
    case "PRICE_BELOW":
      return isLong ? "STOP" : "TARGET";
    case "PRICE_ABOVE":
      return isLong ? "TARGET" : "STOP";
    case "PRICE_MOVE_PCT": {
      const up = predicate.direction === "UP";
      const favorable = isLong ? up : !up;
      return favorable ? "TARGET" : "STOP";
    }
    case "GAIN_FROM_ENTRY":
    case "TRAILING_FROM_HIGH":
      return "STOP";
    default:
      return "STOP";
  }
}

/** What a trigger does on a stock we don't hold (types.ts). */
export function effectiveTriggerAction(
  trigger: { action: TriggerAction; predicate: TriggerPredicate },
  state: { status?: string | null; direction?: string | null; hasBuy?: boolean },
): TriggerAction {
  if (state.status === "HOLDING") return trigger.action;
  const kind = trigger.predicate.kind;
  const isPriceLevel = kind === "PRICE_ABOVE" || kind === "PRICE_BELOW";
  if (trigger.action === "EXIT") return "DEMOTE";
  if (trigger.action === "REVIEW" && isPriceLevel && state.hasBuy !== false) {
    const isLong = state.direction !== "SHORT";
    const favourable = isLong ? kind === "PRICE_ABOVE" : kind === "PRICE_BELOW";
    if (favourable) return "DEMOTE";
  }
  return trigger.action;
}

type TimedPredicate = { kind: string; basis?: string; predicates?: TimedPredicate[] };

/** A watched stock's floor reads the close (types.ts). */
export function watchedFloorOnClose<T extends { action: string; predicate: TimedPredicate }>(
  trigger: T,
  state: { status?: string | null },
): T {
  if (state.status === "HOLDING" || trigger.action !== "EXIT") return trigger;
  const onClose = (p: TimedPredicate): TimedPredicate =>
    p.kind === "PRICE_ABOVE" || p.kind === "PRICE_BELOW"
      ? { ...p, basis: "close" }
      : (p.kind === "AND" || p.kind === "OR") && p.predicates
        ? { ...p, predicates: p.predicates.map(onClose) }
        : p;
  const predicate = onClose(trigger.predicate);
  return JSON.stringify(predicate) === JSON.stringify(trigger.predicate) ? trigger : ({ ...trigger, predicate } as T);
}

// ── What the trigger check loaded for a trigger (trigger-evaluator.ts, and indicator-needs.ts, deleted) ──

export function isPriceSidePredicate(p: TriggerPredicate): boolean {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
    case "PRICE_MOVE_PCT":
    case "GAIN_FROM_ENTRY":
    case "TRAILING_FROM_HIGH":
    case "VS_SMA":
    case "NEAR_SMA":
    case "VOLUME_RATIO":
    case "NEW_HIGH":
    case "PCT_FROM_52W_HIGH":
    case "RS_VS_SPY":
    case "GAP_UP":
    case "RSI":
    case "INSIDER_CLUSTER":
    case "REVIEW_CADENCE":
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
    case "EARNINGS_WITHIN":
    case "EARNINGS_SINCE":
    case "SEC_EVENT":
      return true;
    case "AND":
    case "OR":
      return p.predicates.every(isPriceSidePredicate);
    default:
      return false;
  }
}

export function needsEarningsData(p: TriggerPredicate): boolean {
  switch (p.kind) {
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
    case "EARNINGS_WITHIN":
    case "EARNINGS_SINCE":
      return true;
    case "AND":
    case "OR":
      return p.predicates.some(needsEarningsData);
    default:
      return false;
  }
}

export function needsUpcomingEarnings(p: TriggerPredicate): boolean {
  switch (p.kind) {
    case "EARNINGS_WITHIN":
      return true;
    case "AND":
    case "OR":
      return p.predicates.some(needsUpcomingEarnings);
    default:
      return false;
  }
}

export function needsTodayVolume(p: TriggerPredicate): boolean {
  switch (p.kind) {
    case "VOLUME_RATIO":
    case "GAP_UP":
      return true;
    case "AND":
    case "OR":
      return p.predicates.some(needsTodayVolume);
    default:
      return false;
  }
}

export function hasCloseBasis(p: TriggerPredicate): boolean {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return p.basis === "close";
    case "AND":
    case "OR":
      return p.predicates.some(hasCloseBasis);
    default:
      return false;
  }
}

export function needsFilings(p: TriggerPredicate): boolean {
  return secEventLeaves(p).length > 0;
}

function secEventLeaves(p: TriggerPredicate): TriggerPredicate[] {
  if (p.kind === "SEC_EVENT") return [p];
  if (p.kind === "AND" || p.kind === "OR") return p.predicates.flatMap(secEventLeaves);
  return [];
}

export function needsIndicators(p: TriggerPredicate): boolean {
  switch (p.kind) {
    case "VS_SMA":
    case "NEAR_SMA":
    case "VOLUME_RATIO":
    case "NEW_HIGH":
    case "PCT_FROM_52W_HIGH":
    case "RS_VS_SPY":
    case "GAP_UP":
    case "RSI":
    case "INSIDER_CLUSTER":
      return true;
    case "PRICE_MOVE_PCT":
      return p.window !== "1D";
    case "TRAILING_FROM_HIGH":
      // A trail whose give-back widens with the stock's range reads ATR(14)
      // off the snapshot. A plain trail needs nothing and costs nothing.
      return p.atrMultiple != null;
    case "AND":
    case "OR":
      return p.predicates.some(needsIndicators);
    default:
      return false;
  }
}

// ── Levels, the cascade's gates, and the protective rules (levels.ts, ratchet.ts, price-levels.ts) ──

/** levels.ts: inert without a position (the top-level kind only). */
export function isPositionScoped(p: TriggerPredicate): boolean {
  return new Set(["GAIN_FROM_ENTRY", "TRAILING_FROM_HIGH"]).has(p.kind);
}

/** levels.ts: the review clock a watched stock drops when inherited. */
export function isInheritedClock(p: TriggerPredicate): boolean {
  return p.kind === "REVIEW_CADENCE" && (p.from ?? "LAST_REVIEW") === "LAST_REVIEW";
}

/** levels.ts `protectiveTightestFirst`: the rank of a protective EXIT, lower kept first. */
export function protectiveRank(t: { action: string; predicate: TriggerPredicate }, direction: string | null): number | null {
  const isLong = direction !== "SHORT";
  if (t.action !== "EXIT") return null;
  if (protectiveExitCloseReason(t.predicate, direction ?? null) !== "STOP") {
    return null;
  }
  switch (t.predicate.kind) {
    case "PRICE_BELOW":
      return isLong ? -t.predicate.level : t.predicate.level;
    case "PRICE_ABOVE":
      return isLong ? t.predicate.level : -t.predicate.level;
    case "TRAILING_FROM_HIGH":
    case "GAIN_FROM_ENTRY":
    case "PRICE_MOVE_PCT":
      return t.predicate.pct;
    default:
      return null;
  }
}

/** ratchet.ts: does `next` protect less than `prev`. */
export function weakens(prev: TriggerPredicate, next: TriggerPredicate): boolean {
  if (prev.kind !== next.kind) return false;
  const toCloseBasis = (p: TriggerPredicate, n: TriggerPredicate) =>
    (p as { basis?: string }).basis !== "close" && (n as { basis?: string }).basis === "close";
  switch (prev.kind) {
    case "PRICE_BELOW":
      return (next as { level: number }).level < prev.level || toCloseBasis(prev, next);
    case "PRICE_ABOVE":
      return (next as { level: number }).level > prev.level || toCloseBasis(prev, next);
    case "TRAILING_FROM_HIGH": {
      const n = next as { pct: number; armAtGainPct?: number; atrMultiple?: number };
      const p = prev as { pct: number; armAtGainPct?: number; atrMultiple?: number };
      return (
        n.pct > p.pct ||
        (n.armAtGainPct ?? 0) > (p.armAtGainPct ?? 0) ||
        (n.atrMultiple ?? 0) > (p.atrMultiple ?? 0)
      );
    }
    case "PRICE_MOVE_PCT":
    case "GAIN_FROM_ENTRY":
      return (next as { pct: number }).pct > prev.pct;
    default:
      return false;
  }
}

/** live-evaluate.ts and needs-action.ts: evaluable against a quote alone. */
export function isPriceOrTimePredicate(p: TriggerPredicate): boolean {
  const PRICE_OR_TIME_KINDS = new Set([
    "PRICE_ABOVE", "PRICE_BELOW", "PRICE_MOVE_PCT", "GAIN_FROM_ENTRY", "TRAILING_FROM_HIGH", "VS_SMA", "NEAR_SMA",
    "VOLUME_RATIO", "NEW_HIGH", "PCT_FROM_52W_HIGH", "RS_VS_SPY", "GAP_UP", "RSI", "INSIDER_CLUSTER",
  ]);
  if (PRICE_OR_TIME_KINDS.has(p.kind)) return true;
  if (p.kind === "AND" || p.kind === "OR") {
    return p.predicates.every(isPriceOrTimePredicate);
  }
  return false;
}

const ABSOLUTE = new Set<TriggerPredicate["kind"]>(["PRICE_ABOVE", "PRICE_BELOW"]);
const PROJECTED = new Set<TriggerPredicate["kind"]>(["TRAILING_FROM_HIGH", "GAIN_FROM_ENTRY"]);
const isLongOf = (d: string | null | undefined) => d !== "SHORT";

/** price-levels.ts: a level on the chart, as `canonicalLevels` read one (null when it is none). */
export function chartLevel(
  p: TriggerPredicate,
  ctx: { direction: string | null; avgCost?: number | null; peakPrice?: number | null; atr14?: number | null },
): { price: number; side: "UPSIDE" | "DOWNSIDE"; projected: boolean } | null {
  const absolute = ABSOLUTE.has(p.kind);
  if (!absolute && !PROJECTED.has(p.kind)) return null;
  const side = levelSide(p, ctx.direction);
  if (side == null) return null;
  const price = predicatePrice(p, ctx);
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  return { price, side, projected: !absolute };
}

/** price-levels.ts `levelSlotOf`. */
export function levelSlotOf(t: { action: string; predicate: TriggerPredicate }, direction: string | null): "ENTRY" | "FLOOR" | "TARGET" | null {
  if (!ABSOLUTE.has(t.predicate.kind)) return null;
  if (t.action === "ENTER") return "ENTRY";
  const side = levelSide(t.predicate, direction);
  if (side === "DOWNSIDE") return t.action === "EXIT" ? "FLOOR" : null;
  return t.action === "EXIT" || t.action === "REVIEW" ? "TARGET" : null;
}

/** price-levels.ts `isPlanLevel`. */
export function isPlanLevel(t: { action: string; predicate: TriggerPredicate }, direction: string | null): boolean {
  if (!ABSOLUTE.has(t.predicate.kind)) return false;
  if (t.action === "ENTER" || t.action === "EXIT") return true;
  if (t.action !== "REVIEW") return false;
  return levelSide(t.predicate, direction) === "UPSIDE";
}

/** price-levels.ts `priceOf`; demote.ts reads the same number (0 for none). */
export function priceOf(p: TriggerPredicate): number | null {
  return p.kind === "PRICE_ABOVE" || p.kind === "PRICE_BELOW" ? p.level : null;
}

function levelSide(p: TriggerPredicate, direction: string | null): "UPSIDE" | "DOWNSIDE" | null {
  const long = isLongOf(direction);
  switch (p.kind) {
    case "PRICE_ABOVE":
      return long ? "UPSIDE" : "DOWNSIDE";
    case "PRICE_BELOW":
      return long ? "DOWNSIDE" : "UPSIDE";
    case "TRAILING_FROM_HIGH":
      return "DOWNSIDE";
    case "GAIN_FROM_ENTRY":
      return p.direction === "UP" ? "UPSIDE" : "DOWNSIDE";
    default:
      return null;
  }
}

function predicatePrice(
  p: TriggerPredicate,
  ctx: { direction: string | null; avgCost?: number | null; peakPrice?: number | null; atr14?: number | null },
): number | null {
  const long = isLongOf(ctx.direction);
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return p.level;
    case "TRAILING_FROM_HIGH":
      return trailFireLevel(p, { peak: ctx.peakPrice, avgCost: ctx.avgCost, isLong: long, atr: ctx.atr14 });
    case "GAIN_FROM_ENTRY": {
      const avg = ctx.avgCost;
      if (avg == null || avg <= 0) return null;
      const up = p.direction === "UP";
      const favourable = long ? up : !up;
      return favourable ? avg * (1 + p.pct / 100) : avg * (1 - p.pct / 100);
    }
    default:
      return null;
  }
}

// ── The small readers of a typed price (rearm.ts, buy-crossing.ts, declined-sale.ts, trigger-evaluator.ts, complete-run.ts, agent-watch.ts) ──

/** rearm.ts `isIntradayPriceBuy`, and the comparison it re-arms on. */
export function isIntradayPriceBuy(t: { action: string; predicate: TriggerPredicate }): boolean {
  const p = t.predicate;
  return t.action === "ENTER" && (p.kind === "PRICE_ABOVE" || p.kind === "PRICE_BELOW") && p.basis !== "close";
}
export function levelStillHeld(p: TriggerPredicate, price: number): boolean | null {
  if (p.kind !== "PRICE_ABOVE" && p.kind !== "PRICE_BELOW") return null;
  return p.kind === "PRICE_ABOVE" ? price > p.level : price < p.level;
}

/** buy-crossing.ts `crossingLevel`. */
export function crossingLevel(p: TriggerPredicate | null | undefined): { level: number; crossing: "ABOVE" | "BELOW" } | null {
  if (!p) return null;
  if (p.kind === "PRICE_ABOVE" && typeof p.level === "number" && p.level > 0) {
    return { level: p.level, crossing: "ABOVE" };
  }
  if (p.kind === "PRICE_BELOW" && typeof p.level === "number" && p.level > 0) {
    return { level: p.level, crossing: "BELOW" };
  }
  return null;
}

/** declined-sale.ts: the absolute floor on the side this direction is protected from, as a number. */
export function protectedFloor(p: TriggerPredicate, direction: string | null): number | null {
  const isLong = direction !== "SHORT";
  const wanted = isLong ? "PRICE_BELOW" : "PRICE_ABOVE";
  if (p.kind !== wanted) return null;
  const level = (p as { level?: unknown }).level;
  if (typeof level !== "number" || !(level > 0)) return null;
  return level;
}

/** trigger-evaluator.ts: the floor a DEMOTE names. */
export function demoteFloor(p: TriggerPredicate, direction: string | null): number | null {
  const short = direction === "SHORT";
  return p.kind === (short ? "PRICE_ABOVE" : "PRICE_BELOW") ? (p as { level: number }).level : null;
}

/** complete-run.ts: an EXIT on one of these is a protective rung (a floor or a trail). */
export function isProtectiveExitKind(p: TriggerPredicate): boolean {
  return ["PRICE_BELOW", "PRICE_ABOVE", "TRAILING_FROM_HIGH", "GAIN_FROM_ENTRY"].includes(p.kind);
}

/** agent-watch.ts: a review schedule's days. */
export function scheduleDays(p: TriggerPredicate): number | null {
  const q = p as { kind?: string; days?: unknown };
  if (q?.kind !== "REVIEW_CADENCE") return null;
  return typeof q.days === "number" && q.days > 0 ? q.days : null;
}

/** editable.ts (deleted): did the old popover offer a number to edit (the reject dialog lists only these). */
export function hadEditableNumber(p: TriggerPredicate): boolean {
  const one = (q: TriggerPredicate) =>
    ["PRICE_ABOVE", "PRICE_BELOW", "PRICE_MOVE_PCT", "GAIN_FROM_ENTRY", "TRAILING_FROM_HIGH", "REVIEW_CADENCE", "EARNINGS_WITHIN",
      "NEAR_SMA", "VOLUME_RATIO", "PCT_FROM_52W_HIGH", "GAP_UP", "RSI", "INSIDER_CLUSTER"].includes(q.kind);
  return p.kind === "AND" || p.kind === "OR" ? p.predicates.some((c) => c.kind !== "AND" && c.kind !== "OR" && one(c)) : one(p);
}
