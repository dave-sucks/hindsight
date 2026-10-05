/**
 * The checker as the kinds answered it, frozen as it stood before the
 * cutover (lib/agent/triggers/evaluate.ts on 2026-10-05). read.test.ts checks
 * the condition shape's checker against it over every stored trigger and
 * 300 market situations each, as the trigger check did on every pass for
 * the three shadow days.
 *
 * Test-only, and never edited to make a test pass.
 */

import type { Checker, EvaluationContext } from "../../evaluate";
import { daysUntilReport } from "../../earnings";
import { trailFireLevel } from "../../trail";

import { liveRsi, movePctOverSessions, volumeRatio } from "@/lib/market-data/indicator-snapshot";
import { insiderCluster } from "@/lib/market-data/insider-cluster";
import { unfiredMatches } from "@/lib/market-data/sec-events";
import type { LegacyPredicate } from "../legacy-types";

/**
 * Evaluate a single predicate against the context.
 * Returns true iff the predicate's condition is satisfied.
 * Returns false (not throw) when context is missing required data.
 */
export function evaluateTrigger(
  predicate: LegacyPredicate,
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
      // A big winner is not trimmed (playbook: "+20% in ≤ 3 weeks — then
      // hold"). Once the position's tracked peak has run that far off the
      // buy THAT FAST, the partial sale is off for good and the trail
      // manages the position. Reads the same water mark the trail does, so
      // it needs no memory of its own.
      if (predicate.skipIfPeakGainPct != null && ctx.position?.peakPrice != null) {
        const peak = ctx.position.peakPrice;
        const peakGain = isLong ? ((peak - avg) / avg) * 100 : ((avg - peak) / avg) * 100;
        if (peakGain >= predicate.skipIfPeakGainPct && peakWasFast(predicate, ctx)) return false;
      }
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
      // Null until armed (armAtGainPct, DAV-250) — see ./trail.
      const trail = trailFireLevel(predicate, {
        peak,
        avgCost: ctx.position?.avgCost,
        isLong,
        // The stock's own range widens the give-back (DAV-294). Missing
        // snapshot → the written percent, exactly as before.
        atr: ctx.indicators?.atr14,
      });
      if (trail == null) return false;
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

    case "SEC_EVENT":
      // A matching filing this trigger hasn't fired on yet.
      return unfiredMatches(predicate, ctx.filings, ctx.firedFilings).length > 0;

    // ── Time-based ────────────────────────────────────────────────────
    case "REVIEW_CADENCE": {
      const dayMs = 86_400_000;
      switch (predicate.from ?? "LAST_REVIEW") {
        case "BUY": {
          // N days after the position opened. False until held — a watch
          // can carry "out after 20 days" ahead of the fill; it starts
          // counting on the fill.
          const opened = ctx.position?.openedAt;
          if (!opened) return false;
          return (ctx.now.getTime() - opened.getTime()) / dayMs >= predicate.days;
        }
        case "EVENT": {
          // N days before or after the thesis's own event date. "Before"
          // is true from N days out until the date; after the date it is
          // over. "After" is true from N days past the date on.
          const event = ctx.thesis.catalystDate;
          if (!event) return false;
          const daysUntil = (event.getTime() - ctx.now.getTime()) / dayMs;
          return (predicate.side ?? "AFTER") === "BEFORE"
            ? daysUntil >= 0 && daysUntil <= predicate.days
            : -daysUntil >= predicate.days;
        }
        default: {
          // Counted from the last actual review. A thesis nobody has looked
          // at yet is due immediately — that is correct for a fresh watch
          // item and is how an unresearched seed asks for its first read.
          const last = ctx.thesis.lastReviewedAt ?? ctx.thesis.createdAt;
          return (ctx.now.getTime() - last.getTime()) / dayMs >= predicate.days;
        }
      }
    }

    // ── Composition ───────────────────────────────────────────────────
    case "AND":
      return predicate.predicates.every((p) => evaluateTrigger(p, ctx));

    case "OR":
      return predicate.predicates.some((p) => evaluateTrigger(p, ctx));
  }
}

/** The old checker reads kinds only; the parity tests hand it the stored kinds. */
const kind = (p: unknown) => p as LegacyPredicate;
export const KIND_CHECKER: Checker = {
  holds: (p, ctx) => evaluateTrigger(kind(p), ctx) === true,
  readsPrice: (p) => readsPrice(kind(p)),
  readsUpcomingReport: (p) => readsUpcomingReport(kind(p)),
};

// ── Internals ─────────────────────────────────────────────────────────

/**
 * Did the position reach its peak fast enough to count as a big winner?
 *
 * The playbook's rule is a run of 20% *in three weeks or less*. Without the
 * clock the switch would read "never take a partial on anything that has
 * ever been up 20%", which is a far wider change to selling than the rule —
 * a six-month grind to +20% is an ordinary winner and the partial is exactly
 * what it's for.
 *
 * Both dates come off the Position row: openedAt at the fill, peakAt written
 * next to peakPrice by the price monitor. If either is missing we cannot
 * prove the run was fast, so we say no and the partial stands — the failure
 * direction is "de-risk a big winner", not "hold a stock through a rule we
 * couldn't check".
 */
function peakWasFast(
  predicate: Extract<LegacyPredicate, { kind: "GAIN_FROM_ENTRY" }>,
  ctx: EvaluationContext,
): boolean {
  if (predicate.skipIfPeakWithinDays == null) return true;
  const openedAt = ctx.position?.openedAt;
  const peakAt = ctx.position?.peakAt;
  if (openedAt == null || peakAt == null) return false;
  const days = (peakAt.getTime() - openedAt.getTime()) / 86_400_000;
  return days >= 0 && days <= predicate.skipIfPeakWithinDays;
}

/** Does this predicate read the next scheduled report? (The heads-up.) */
function readsUpcomingReport(p: LegacyPredicate): boolean {
  if (p.kind === "EARNINGS_WITHIN") return true;
  if (p.kind === "AND" || p.kind === "OR") return p.predicates.some(readsUpcomingReport);
  return false;
}

/** Does this predicate compare the quote's price to a level? */
function readsPrice(p: LegacyPredicate): boolean {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
    case "VS_SMA":
    case "NEAR_SMA":
    case "NEW_HIGH":
    case "PCT_FROM_52W_HIGH":
    case "RSI":
      return true;
    // The 5D/20D move is measured from the live price, so it can cross; the
    // 1D move reads the quote's own change and can't be re-read at the close.
    case "PRICE_MOVE_PCT":
      return p.window !== "1D";
    case "AND":
    case "OR":
      return p.predicates.some(readsPrice);
    default:
      return false;
  }
}

/**
 * The reported surprise percentage for this ticker — reported EPS against
 * the published estimate, off the calendar. Positive = beat, negative =
 * miss, null = we don't know (nothing reported, or an estimate we can't
 * compute a percentage against). A signal-side fallback went with the
 * signal router (2026-09-15); no producer ever stamped a figure onto one.
 */
function reportedSurprisePct(ctx: EvaluationContext): number | null {
  return ctx.earnings?.surprisePct ?? null;
}

function evaluatePriceMovePct(
  predicate: Extract<LegacyPredicate, { kind: "PRICE_MOVE_PCT" }>,
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
  predicate: Extract<LegacyPredicate, { kind: "GAP_UP" }>,
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
