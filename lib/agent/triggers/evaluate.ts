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
 * context (a chart kind with no indicator snapshot, say) return `false`
 * rather than throwing — the failure mode is a missed trigger, not a
 * crashed cron.
 *
 * The chart kinds (VS_SMA, NEAR_SMA, VOLUME_RATIO, NEW_HIGH,
 * PCT_FROM_52W_HIGH, RS_VS_SPY, GAP_UP, RSI, the 5D/20D move) read the
 * daily indicator snapshot (lib/market-data/indicator-snapshot.ts) next to
 * the live quote. DAV-247.
 */

import type { Trigger, TriggerPredicate } from "./types";
import { defaultCooldownDaysForPredicate } from "./defaults";
import type { EarningsReport } from "./earnings";
import { daysUntilReport } from "./earnings";
import {
  liveRsi,
  movePctOverSessions,
  volumeRatio,
  type IndicatorSnapshot,
} from "@/lib/market-data/indicator-snapshot";
import { insiderCluster } from "@/lib/market-data/insider-cluster";

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

  /** Earnings surprise pct a producer stamped on an EARNINGS signal, when known. */
  earningsSurprisePct?: number;
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

  /**
   * This ticker's most recently reported quarter, when it reported inside
   * the evaluator's lookback window. Read by EARNINGS_BEAT / EARNINGS_MISS.
   *
   * This is the source that works today. The signal-side path below stayed
   * dark for months because no producer ever stamped a surprise figure onto
   * a Signal; the calendar carries reported EPS against estimate directly,
   * so beat/miss is arithmetic with nothing in between. See ./earnings and
   * docs/plans/EARNINGS_AND_MOVERS.md.
   *
   * Absent (didn't report, or the caller doesn't do earnings) → those
   * predicates fall back to `signal`, and then to false. A missed trigger,
   * never a crash.
   */
  earnings?: EarningsReport | null;

  /**
   * This ticker's NEXT scheduled report, when one falls inside the
   * evaluator's lookahead. Read by EARNINGS_WITHIN — the heads-up before
   * a report, off the same calendar call as `earnings`. Absent → false.
   */
  upcomingEarnings?: EarningsReport | null;

  /**
   * The daily indicator snapshot for this ticker (completed sessions through
   * yesterday). Read by every chart kind. Absent → those kinds are false.
   */
  indicators?: IndicatorSnapshot | null;

  /**
   * Today's session so far. `volume` is consolidated volume through ~15
   * minutes ago (SIP); `open` is today's open. Read by VOLUME_RATIO and
   * GAP_UP. Absent → those kinds are false.
   */
  today?: { open?: number | null; volume?: number | null } | null;

  /**
   * Which pass is evaluating. "INTRADAY": the 5-minute cron — a
   * `basis: "close"` price level is false (it waits for the close).
   * "CLOSE": the 16:20 ET pass — latestQuote.price IS the day's close.
   * Absent (the read-side snapshots): every level is read against the
   * price given, because they answer "is this true right now".
   */
  session?: "INTRADAY" | "CLOSE";

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
      if (predicate.basis === "close" && ctx.session === "INTRADAY") return false;
      return ctx.latestQuote != null && ctx.latestQuote.price > predicate.level;

    case "PRICE_BELOW":
      if (predicate.basis === "close" && ctx.session === "INTRADAY") return false;
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
      const avg = ctx.indicators?.sma[predicate.period];
      if (avg == null || ctx.latestQuote == null) return false;
      return predicate.direction === "ABOVE"
        ? ctx.latestQuote.price > avg
        : ctx.latestQuote.price < avg;
    }

    case "NEAR_SMA": {
      const avg = ctx.indicators?.sma[predicate.period];
      if (avg == null || avg <= 0 || ctx.latestQuote == null) return false;
      return (Math.abs(ctx.latestQuote.price - avg) / avg) * 100 <= predicate.withinPct;
    }

    case "VOLUME_RATIO": {
      const ratio = ctx.indicators ? volumeRatio(ctx.indicators, ctx.today?.volume) : null;
      return ratio != null && ratio >= predicate.min;
    }

    case "NEW_HIGH": {
      const snap = ctx.indicators;
      if (!snap || ctx.latestQuote == null) return false;
      return ctx.latestQuote.price > (predicate.window === "20D" ? snap.high20 : snap.high52w);
    }

    case "PCT_FROM_52W_HIGH": {
      const hi = ctx.indicators?.high52w;
      if (hi == null || hi <= 0 || ctx.latestQuote == null) return false;
      return Math.max(0, ((hi - ctx.latestQuote.price) / hi) * 100) <= predicate.max;
    }

    case "RS_VS_SPY": {
      const rs = ctx.indicators?.rsVsSpy[predicate.window];
      return rs != null && rs >= predicate.min;
    }

    case "GAP_UP":
      return evaluateGapUp(predicate, ctx);

    case "INSIDER_CLUSTER": {
      const buys = ctx.indicators?.insiderBuys;
      if (!buys) return false;
      return insiderCluster(buys, predicate.days, ctx.now).buyers >= predicate.minBuyers;
    }

    case "RSI": {
      if (!ctx.indicators || ctx.latestQuote == null) return false;
      const value = liveRsi(ctx.indicators, ctx.latestQuote.price, predicate.period ?? 14);
      if (value == null) return false;
      return predicate.direction === "ABOVE" ? value > predicate.threshold : value < predicate.threshold;
    }

    case "EARNINGS_BEAT": {
      const surprise = reportedSurprisePct(ctx);
      if (surprise == null || surprise <= 0) return false;
      if (predicate.minSurprisePct != null && surprise < predicate.minSurprisePct) {
        return false;
      }
      return true;
    }

    case "EARNINGS_MISS": {
      const surprise = reportedSurprisePct(ctx);
      if (surprise == null || surprise >= 0) return false;
      const absSurprise = Math.abs(surprise);
      if (predicate.minSurprisePct != null && absSurprise < predicate.minSurprisePct) {
        return false;
      }
      return true;
    }

    case "EARNINGS_WITHIN": {
      // "Reports within N days." 0 = reports today (a before-open print has
      // already happened; an after-close one is tonight) — both are the
      // heads-up this exists for. Past-dated rows never reach the context.
      const next = ctx.upcomingEarnings;
      if (!next) return false;
      const days = daysUntilReport(next, ctx.now);
      return days >= 0 && days <= predicate.days;
    }

    case "EARNINGS_SINCE": {
      // "Reported min–max days ago." Reads the reported row; the day of the
      // report is 0. The entry window for a post-report drift trade.
      const r = ctx.earnings;
      if (!r || r.epsActual == null) return false;
      const since = -daysUntilReport(r, ctx.now);
      return since >= predicate.min && since <= predicate.max;
    }

    // ── Time-based ────────────────────────────────────────────────────
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
  //
  //   `fireOnMatch` (a buy-now rung, DAV-247) skips the crossing for its
  //   FIRST fire: the level is already behind the price by design, and on a
  //   flat or down day the crossing would never come. Once it has fired it
  //   is an ordinary ENTER again.
  const firstFireOnMatch = trigger.fireOnMatch === true && trigger.lastFiredAt == null;
  if (
    trigger.action === "ENTER" &&
    !firstFireOnMatch &&
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
    case "NEAR_SMA":
    case "NEW_HIGH":
    case "PCT_FROM_52W_HIGH":
    case "RSI":
      return true;
    case "AND":
    case "OR":
      return p.predicates.some(readsPrice);
    default:
      return false;
  }
}

/**
 * The reported surprise percentage for this ticker, from whichever source
 * the caller supplied. Positive = beat, negative = miss, null = we don't
 * know (nothing reported, or an estimate we can't compute a percentage
 * against).
 *
 * Calendar first. It is the arithmetic — reported EPS against the published
 * estimate — whereas a signal's figure is whatever a producer stamped onto
 * the row, and in practice no producer ever stamped one. The signal branch
 * stays so that a restored router still works, not because it currently
 * carries anything.
 */
function reportedSurprisePct(ctx: EvaluationContext): number | null {
  if (ctx.earnings?.surprisePct != null) return ctx.earnings.surprisePct;
  if (ctx.signal?.type === "EARNINGS") return ctx.signal.earningsSurprisePct ?? null;
  return null;
}

function evaluatePriceMovePct(
  predicate: Extract<TriggerPredicate, { kind: "PRICE_MOVE_PCT" }>,
  ctx: EvaluationContext,
): boolean {
  // 1D: the quote's own change vs prior close (Finnhub `dp`, carried on
  // latestQuote.changePct) — the number every app shows. 5D / 20D: the live
  // price against the close that many sessions back, off the snapshot.
  let move: number | null;
  if (predicate.window === "1D") {
    move = typeof ctx.latestQuote?.changePct === "number" ? ctx.latestQuote.changePct : null;
  } else {
    const sessions = predicate.window === "5D" ? 5 : 20;
    move =
      ctx.indicators && ctx.latestQuote
        ? movePctOverSessions(ctx.indicators, ctx.latestQuote.price, sessions)
        : null;
  }
  if (move == null) return false;
  return predicate.direction === "UP" ? move >= predicate.pct : move <= -predicate.pct;
}

/**
 * Gapped up ≥ minPct on ≥ minVolRatio× volume — today (live open vs prior
 * close, volume so far), or within the last `withinDays` sessions off the
 * snapshot's gap list. withinDays 1 = today only.
 */
function evaluateGapUp(
  predicate: Extract<TriggerPredicate, { kind: "GAP_UP" }>,
  ctx: EvaluationContext,
): boolean {
  const snap = ctx.indicators;
  if (!snap) return false;
  const within = predicate.withinDays ?? 1;
  const prevClose = ctx.latestQuote?.prevClose;
  const open = ctx.today?.open;
  if (open != null && prevClose != null && prevClose > 0) {
    const pct = ((open - prevClose) / prevClose) * 100;
    const ratio = volumeRatio(snap, ctx.today?.volume);
    if (pct >= predicate.minPct && ratio != null && ratio >= predicate.minVolRatio) return true;
  }
  return snap.gaps.some(
    (g) =>
      g.sessionsAgo < within &&
      g.pct >= predicate.minPct &&
      g.volumeRatio != null &&
      g.volumeRatio >= predicate.minVolRatio,
  );
}
