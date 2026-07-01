/**
 * Trigger predicate evaluator — the dual-consumer pure function.
 *
 * Called from three different paths, all sharing this evaluator:
 *
 *   1. Signal-router (PR 2)         — when a Signal is created, evaluate
 *                                     signal-side predicates against it.
 *   2. 15-min price cron (PR 2)     — for active theses, pull latest quote
 *                                     and evaluate price/time predicates.
 *   3. Daily run inline (PR 3)      — agent calls evaluateTrigger against
 *                                     fresh get_stock_data output before
 *                                     deciding per-thesis what to do.
 *
 * The function is pure: no DB, no fetches, no clock. Everything required
 * comes through `EvaluationContext`. Predicates that need data not in the
 * context (e.g. PRICE_MOVE_PCT with no recentPrices) return `false`
 * rather than throwing — the failure mode is a missed trigger, not a
 * crashed cron.
 *
 * RSI is stubbed to `false` for v1. Real RSI calculation needs candle
 * handling that isn't worth blocking PR 2 on.
 */

import type { Trigger, TriggerPredicate, Urgency } from "./types";
import { defaultCooldownDaysForPredicate } from "./defaults";

// ── EvaluationContext ─────────────────────────────────────────────────

export interface EvaluationContextSignal {
  /** mirrors Signal.type */
  type: string;
  /** mirrors Signal.sentiment ("BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED") */
  sentiment: string;
  /** mirrors Signal.urgency */
  urgency: string;
  /** mirrors Signal.tickers */
  tickers: string[];

  // Fields the producer stamps on EARNINGS / FILING signals when known.
  // Absent → predicates that need them return false rather than throwing.
  /** Earnings surprise pct: positive = beat, negative = miss. */
  earningsSurprisePct?: number;
  /** Direction the company guided. */
  guidanceDirection?: "UP" | "DOWN";
  /** SEC form type (only set on FILING signals). */
  filingFormType?: "10-K" | "10-Q" | "8-K" | "FORM_4";
}

export interface EvaluationContext {
  /** Present on the signal-driven path. Undefined on cron / daily-inline. */
  signal?: EvaluationContextSignal;

  /** Latest quote — present on cron and daily-inline paths. */
  latestQuote?: { price: number; changePct: number };

  /** Recent closes for windowed PRICE_MOVE_PCT. Sorted ascending by date. */
  recentPrices?: Array<{ date: Date; close: number }>;

  /** SMA precomputed by the caller; we don't fetch candles here. */
  sma?: { 50?: number; 200?: number };

  /** Thesis fields needed by time-based predicates. */
  thesis: {
    createdAt: Date;
    nextReviewAt?: Date | null;
    /**
     * Thesis lifecycle status. Drives the TIME_ELAPSED clock selection:
     * on an ACTIVE (held) thesis, a "max hold N days" review measures from
     * when the POSITION opened, not when the thesis row was created. Absent
     * on legacy callers → treated as not-ACTIVE, so the clock falls back to
     * createdAt (the pre-fix behavior). See P1-14.
     */
    status?: string | null;
    /**
     * When the paired open Position opened. Only meaningful for ACTIVE
     * theses; null/absent when the thesis isn't held or the caller didn't
     * look up the position. Used by TIME_ELAPSED on ACTIVE rows so a
     * 0-day-old position doesn't fire a 14d "max hold" trigger just because
     * the thesis row is 36 days old. WATCHING rows ignore this and stay on
     * createdAt (the correct clock for "is this watch row stale").
     */
    positionOpenedAt?: Date | null;
  };

  /** Caller-supplied "now" — keeps the function pure and testable. */
  now: Date;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Evaluate a single predicate against the context.
 * Returns true iff the predicate's condition is satisfied.
 * Returns false (not throw) when context is missing required data.
 */
export function evaluateTrigger(
  predicate: TriggerPredicate,
  ctx: EvaluationContext,
): boolean {
  switch (predicate.kind) {
    // ── Price-based ───────────────────────────────────────────────────
    case "PRICE_ABOVE":
      return ctx.latestQuote != null && ctx.latestQuote.price > predicate.level;

    case "PRICE_BELOW":
      return ctx.latestQuote != null && ctx.latestQuote.price < predicate.level;

    case "PRICE_MOVE_PCT":
      return evaluatePriceMovePct(predicate, ctx);

    case "VS_SMA": {
      const smaVal = ctx.sma?.[predicate.period];
      if (smaVal == null || ctx.latestQuote == null) return false;
      return predicate.direction === "ABOVE"
        ? ctx.latestQuote.price > smaVal
        : ctx.latestQuote.price < smaVal;
    }

    case "RSI":
      // TODO(PR 2.1): real RSI calculation requires candle history; v1 stub.
      return false;

    // ── Signal-based ──────────────────────────────────────────────────
    case "SIGNAL_TYPE":
      return evaluateSignalType(predicate, ctx);

    case "EARNINGS_BEAT": {
      if (ctx.signal?.type !== "EARNINGS") return false;
      const surprise = ctx.signal.earningsSurprisePct;
      if (surprise == null || surprise <= 0) return false;
      if (predicate.minSurprisePct != null && surprise < predicate.minSurprisePct) {
        return false;
      }
      return true;
    }

    case "EARNINGS_MISS": {
      if (ctx.signal?.type !== "EARNINGS") return false;
      const surprise = ctx.signal.earningsSurprisePct;
      if (surprise == null || surprise >= 0) return false;
      const absSurprise = Math.abs(surprise);
      if (predicate.minSurprisePct != null && absSurprise < predicate.minSurprisePct) {
        return false;
      }
      return true;
    }

    case "GUIDANCE_CHANGE":
      return (
        ctx.signal?.type === "EARNINGS" &&
        ctx.signal.guidanceDirection === predicate.direction
      );

    case "FILING":
      return (
        ctx.signal?.type === "FILING" &&
        ctx.signal.filingFormType === predicate.formType
      );

    // ── Time-based ────────────────────────────────────────────────────
    case "TIME_ELAPSED": {
      // Clock selection (P1-14): for a HELD (ACTIVE) thesis with a known
      // position open time, a "max hold N days" review measures from when
      // the POSITION opened. The thesis row may be far older (re-minted,
      // long-watched) than the live position; measuring from createdAt
      // fires the trigger on a 0-day-old position. WATCHING-side (and any
      // ACTIVE row missing positionOpenedAt) keeps measuring from createdAt
      // — the correct clock for "is this watch row stale."
      const anchor =
        (ctx.thesis.status === "HOLDING") &&
        ctx.thesis.positionOpenedAt != null
          ? ctx.thesis.positionOpenedAt
          : ctx.thesis.createdAt;
      const elapsedMs = ctx.now.getTime() - anchor.getTime();
      const elapsedDays = elapsedMs / 86_400_000;
      return elapsedDays >= predicate.days;
    }

    case "REVIEW_DATE_HIT":
      return (
        ctx.thesis.nextReviewAt != null &&
        ctx.now.getTime() >= ctx.thesis.nextReviewAt.getTime()
      );

    // ── Composition ───────────────────────────────────────────────────
    case "AND":
      return predicate.predicates.every((p) => evaluateTrigger(p, ctx));

    case "OR":
      return predicate.predicates.some((p) => evaluateTrigger(p, ctx));
  }
}

/**
 * Evaluate a full Trigger including the cooldown gate. Returns a reason
 * code so callers (and tests) can distinguish "predicate matched but
 * cooldown blocks fire" from "predicate didn't match."
 *
 * Cooldown semantics:
 *
 *   1. `cooldownDays` absent — fall back to the predicate-kind default
 *      from `defaultCooldownDaysForPredicate`. Defense in depth for legacy
 *      rows from before the write-path default-filler shipped, plus
 *      anything that slips through.
 *
 *   2. `cooldownDays === 0` on a non-EXIT action — STRUCTURALLY INVALID,
 *      treat as "absent" and fall back to the per-kind default. This is
 *      the read-path mirror of the write-path fix in
 *      `applyTriggerCooldownDefaults`. Required because the write-path
 *      fix only stops *future* bad values from landing — existing on-disk
 *      rows with the bad shape would otherwise keep tick-firing until
 *      something rewrites them. Background: 2026-06-02 NVDA runaway.
 *
 *   3. `cooldownDays === 0` on an EXIT action — legitimate escape hatch.
 *      EXIT is terminal; the position closes and the cron's `status:ACTIVE`
 *      filter removes the row from evaluation. No runaway risk.
 */
export function shouldFire(
  trigger: Trigger,
  ctx: EvaluationContext,
): { fires: boolean; reason: "match" | "no-match" | "cooldown" } {
  const matched = evaluateTrigger(trigger.predicate, ctx);
  if (!matched) return { fires: false, reason: "no-match" };

  // Read-path defense — see (2) in the docstring above.
  const isInvalidZero =
    trigger.cooldownDays === 0 && trigger.action !== "EXIT";
  const effectiveCooldown =
    trigger.cooldownDays != null && !isInvalidZero
      ? trigger.cooldownDays
      : defaultCooldownDaysForPredicate(trigger.predicate);

  if (effectiveCooldown > 0 && trigger.lastFiredAt != null) {
    const lastFired = new Date(trigger.lastFiredAt).getTime();
    const cooldownMs = effectiveCooldown * 86_400_000;
    if (ctx.now.getTime() - lastFired < cooldownMs) {
      return { fires: false, reason: "cooldown" };
    }
  }

  return { fires: true, reason: "match" };
}

// ── Internals ─────────────────────────────────────────────────────────

const URGENCY_RANK: Record<Urgency, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  BREAKING: 3,
};

function evaluateSignalType(
  predicate: Extract<TriggerPredicate, { kind: "SIGNAL_TYPE" }>,
  ctx: EvaluationContext,
): boolean {
  if (!ctx.signal) return false;
  if (ctx.signal.type !== predicate.signalType) return false;

  if (predicate.sentiment != null && ctx.signal.sentiment !== predicate.sentiment) {
    return false;
  }

  if (predicate.minUrgency != null) {
    const signalRank = URGENCY_RANK[ctx.signal.urgency as Urgency];
    const minRank = URGENCY_RANK[predicate.minUrgency];
    if (signalRank == null || signalRank < minRank) return false;
  }

  return true;
}

const WINDOW_DAYS: Record<"1D" | "5D" | "30D", number> = {
  "1D": 1,
  "5D": 5,
  "30D": 30,
};

function evaluatePriceMovePct(
  predicate: Extract<TriggerPredicate, { kind: "PRICE_MOVE_PCT" }>,
  ctx: EvaluationContext,
): boolean {
  // ── Daily move (the "Movement Amount" alert) ──────────────────────────
  // For the 1D window, use the quote's own daily % change vs the prior close
  // (Finnhub `dp`, carried on latestQuote.changePct). This is the standard
  // "stock is up/down X% today" number every app shows, and it lets the
  // trigger-evaluator CRON path fire daily-move triggers with no candle
  // history — the cron already fetches it. UP fires at ≥ +pct, DOWN at ≤ -pct.
  if (predicate.window === "1D" && ctx.latestQuote != null) {
    const dailyPct = ctx.latestQuote.changePct;
    if (typeof dailyPct === "number") {
      return predicate.direction === "UP"
        ? dailyPct >= predicate.pct
        : dailyPct <= -predicate.pct;
    }
  }

  // ── Multi-day windows (5D / 30D) ──────────────────────────────────────
  // Need a recent-closes series to compute the move; the cron doesn't load
  // candles, so these still evaluate via the daily-run inline / live paths
  // that supply recentPrices.
  if (ctx.recentPrices == null || ctx.recentPrices.length === 0) return false;
  if (ctx.latestQuote == null) return false;

  const windowDays = WINDOW_DAYS[predicate.window];
  const cutoff = new Date(ctx.now.getTime() - windowDays * 86_400_000);

  // Find the most recent close at-or-before the cutoff.
  // recentPrices is sorted ascending; walk from the end backward.
  let pastClose: number | undefined;
  for (let i = ctx.recentPrices.length - 1; i >= 0; i--) {
    if (ctx.recentPrices[i].date.getTime() <= cutoff.getTime()) {
      pastClose = ctx.recentPrices[i].close;
      break;
    }
  }

  if (pastClose == null || pastClose === 0) return false;

  const currentPrice = ctx.latestQuote.price;
  const pctChange = ((currentPrice - pastClose) / pastClose) * 100;

  return predicate.direction === "UP"
    ? pctChange >= predicate.pct
    : pctChange <= -predicate.pct;
}
