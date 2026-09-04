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

  /**
   * Latest quote — present on cron and daily-inline paths.
   *
   * `prevClose` is the prior session's close (Finnhub `pc`). It is what
   * lets an ENTER trigger fire on the CROSSING of its level rather than
   * every tick the price sits past it (DAV-229). The 5-minute cron always
   * has it; the read-side snapshots (daily run, resolver, needs-action)
   * don't carry it and so keep level semantics — they answer "is the
   * condition true now", which is the right question for a snapshot.
   */
  latestQuote?: { price: number; changePct: number; prevClose?: number };

  /** SMA precomputed by the caller; we don't fetch candles here. */
  sma?: { 50?: number; 200?: number };

  /**
   * Open-position economics — required by GAIN_FROM_ENTRY (avgCost) and
   * TRAILING_FROM_HIGH (peakPrice). Supplied by the cron + live paths for
   * HOLDING theses; absent/null (WATCHING, or caller didn't join the
   * position) → those predicates return false (missed trigger, not a
   * crash). peakPrice is the price-monitor-maintained water mark:
   * high-water for LONG, low-water for SHORT.
   */
  position?: {
    avgCost?: number | null;
    peakPrice?: number | null;
  } | null;

  /** Thesis fields needed by time-based predicates. */
  thesis: {
    createdAt: Date;
    /**
     * When an analyst last actually looked at this thesis. Drives
     * REVIEW_CADENCE. Absent falls back to createdAt, which makes a
     * never-reviewed thesis due immediately.
     */
    lastReviewedAt?: Date | null;
    /**
     * "LONG" | "SHORT" | null — orients GAIN_FROM_ENTRY and
     * TRAILING_FROM_HIGH (a SHORT's gain is a price DROP; its peak is the
     * low-water mark). Absent → treated as LONG, the overwhelming default.
     */
    direction?: string | null;
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

    case "GAIN_FROM_ENTRY": {
      // Cumulative % vs entry. UP fires at gain ≥ pct (milestone
      // checkpoint), DOWN fires at gain ≤ −pct (drawdown / loser
      // attention). SHORT gain = price drop from entry.
      const avg = ctx.position?.avgCost;
      if (avg == null || avg <= 0 || ctx.latestQuote == null) return false;
      const isLong = ctx.thesis.direction !== "SHORT";
      const gainPct = isLong
        ? ((ctx.latestQuote.price - avg) / avg) * 100
        : ((avg - ctx.latestQuote.price) / avg) * 100;
      return predicate.direction === "UP"
        ? gainPct >= predicate.pct
        : gainPct <= -predicate.pct;
    }

    case "TRAILING_FROM_HIGH": {
      // Give-back off the tracked water mark. LONG: fires when price has
      // fallen pct% from the high; SHORT: risen pct% from the low.
      const peak = ctx.position?.peakPrice;
      if (peak == null || peak <= 0 || ctx.latestQuote == null) return false;
      const isLong = ctx.thesis.direction !== "SHORT";
      const trail = isLong
        ? peak * (1 - predicate.pct / 100)
        : peak * (1 + predicate.pct / 100);
      return isLong
        ? ctx.latestQuote.price <= trail
        : ctx.latestQuote.price >= trail;
    }

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

    case "REVIEW_CADENCE": {
      // Counted from the last actual review. A thesis nobody has looked at
      // yet is due immediately — that is correct for a fresh watch item and
      // is how an unresearched seed asks for its first read.
      const last = ctx.thesis.lastReviewedAt ?? ctx.thesis.createdAt;
      return (ctx.now.getTime() - last.getTime()) / 86_400_000 >= predicate.days;
    }

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
): { fires: boolean; reason: "match" | "no-match" | "no-crossing" | "cooldown" } {
  const matched = evaluateTrigger(trigger.predicate, ctx);
  if (!matched) return { fires: false, reason: "no-match" };

  // Two fire semantics, keyed off the action (DAV-229, 2026-09-02):
  //
  //   Every rung but ENTER is a STANDING ORDER (principal ruling
  //   2026-08-16): it fires every day its condition holds; a declined
  //   proposal means "did nothing today", so it asks again tomorrow.
  //   Cooldown is the only rate limit. Never latch a protective level —
  //   that turns a declined sell into a silent one.
  //
  //   ENTER fires on the CROSSING: true now, false at the prior close.
  //   "Buy above $35" means buy when the price gets there — under the
  //   standing-order reading a level already past (TOST $35.15 against a
  //   $35.16 tape; PLTR, 16 fires in 30 days) was a daily proposal the
  //   analyst then declined. Evaluating the same predicate at the prior
  //   close gives composites and VS_SMA the crossing for free; entries
  //   that don't read the price can't cross and keep firing on match. No
  //   prevClose ⇒ level semantics (the read-side snapshots).
  if (
    trigger.action === "ENTER" &&
    ctx.latestQuote?.prevClose != null &&
    ctx.latestQuote.prevClose > 0 &&
    readsPrice(trigger.predicate)
  ) {
    const atPrevClose = evaluateTrigger(trigger.predicate, {
      ...ctx,
      latestQuote: { ...ctx.latestQuote, price: ctx.latestQuote.prevClose },
    });
    if (atPrevClose) return { fires: false, reason: "no-crossing" };
  }

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

/** Does this predicate compare the quote's price to a level? */
function readsPrice(p: TriggerPredicate): boolean {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
    case "VS_SMA":
      return true;
    case "AND":
    case "OR":
      return p.predicates.some(readsPrice);
    default:
      return false;
  }
}

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

function evaluatePriceMovePct(
  predicate: Extract<TriggerPredicate, { kind: "PRICE_MOVE_PCT" }>,
  ctx: EvaluationContext,
): boolean {
  // The daily move, off the quote's own change vs prior close (Finnhub `dp`,
  // carried on latestQuote.changePct). This is the number every app shows,
  // and it needs no candle history — which is why it is the only window that
  // survives. See the PRICE_MOVE_PCT note in ./types.
  const dailyPct = ctx.latestQuote?.changePct;
  if (typeof dailyPct !== "number") return false;
  return predicate.direction === "UP"
    ? dailyPct >= predicate.pct
    : dailyPct <= -predicate.pct;
}
