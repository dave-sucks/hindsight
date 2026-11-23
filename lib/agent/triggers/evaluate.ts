/**
 * Does a trigger fire: the evaluation context, and `shouldFire`, the one fire
 * decision. A trigger fires when it becomes true; once fired, it fires again
 * only after a market close finds its condition false. A buy or add never
 * fires on a stale quote; a filing fires once per filing, a heads-up once per
 * report.
 *
 * Pure: no DB, no fetches, no clock. Everything comes through
 * `EvaluationContext`, and a condition missing what it reads is false rather
 * than a throw: the failure is a missed trigger, not a crashed cron. Whether a
 * condition holds is read off the measure catalog (./condition/read.ts); the
 * chart measures read the daily indicator snapshot next to the live quote.
 */

import type { Trigger } from "./types";
import type { EarningsReport } from "./earnings";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import type { SecFiling } from "@/lib/market-data/sec-events";
import { SHAPE_CHECKER } from "./condition/read";
import { firedSinceFalseClose } from "./condition/describe";
import type { When } from "@/lib/agent/triggers/condition";

// ── EvaluationContext ─────────────────────────────────────────────────

export interface EvaluationContext {
  /**
   * Latest quote — present on cron and daily-inline paths. `prevClose` is the
   * prior session's close, read by a gap.
   */
  latestQuote?: {
    price: number;
    changePct: number;
    prevClose?: number;
    /**
     * The market is open and this quote isn't from the last 15 minutes
     * (lib/market-data/quote-age). A buy or add never fires on it; a sell or review
     * still does — skipping a stop is the worse failure. DAV-261.
     */
    stale?: boolean;
  };

  /**
   * The S&P 500's move on the day, in %: SPY against its prior close. Read by
   * a market trigger, the account's own (./market). Absent on a stock's check
   * → false.
   */
  market?: { changePct: number } | null;

  /**
   * This ticker's most recently reported quarter, when it reported inside
   * the evaluator's lookback window. Read by earnings beat / miss.
   *
   * This is the source that works today. The signal-side path below stayed
   * dark for months because no producer ever stamped a surprise figure onto
   * a Signal; the calendar carries reported EPS against estimate directly,
   * so beat/miss is arithmetic with nothing in between. See ./earnings and
   * docs/plans/EARNINGS_AND_MOVERS.md.
   *
   * Absent (didn't report, or the caller doesn't do earnings) → those
   * predicates are false. A missed trigger, never a crash.
   */
  earnings?: EarningsReport | null;

  /**
   * This ticker's NEXT scheduled report, when one falls inside the
   * evaluator's lookahead. Read by before-earnings — the heads-up before
   * a report, off the same calendar call as `earnings`. Absent → false.
   */
  upcomingEarnings?: EarningsReport | null;

  /**
   * This ticker's watched SEC filings inside the evaluator's lookback,
   * newest first. Read by filing. Absent → false.
   */
  filings?: SecFiling[] | null;

  /**
   * The filing IDs the trigger being evaluated has already fired on. Set by
   * `shouldFire` from the trigger itself — a context is per thesis, this is
   * per trigger — so one filing wakes a trigger once.
   */
  firedFilings?: readonly string[];

  /**
   * The Market Reviewer's high notes on this stock in the last day, newest
   * first. Read by a news note. Absent → false.
   */
  notes?: ReadonlyArray<{ id: string; createdAt: Date; body: string }> | null;

  /** When the trigger being evaluated last fired, set by `conditionHolds`: a news note holds on a note written after it. */
  firedAt?: Date | null;

  /**
   * The report dates the heads-up being evaluated has already fired for.
   * Same shape as `firedFilings`: per trigger, set by `shouldFire`.
   */
  firedReports?: readonly string[];

  /**
   * The daily indicator snapshot for this ticker (completed sessions through
   * yesterday). Read by every chart kind. Absent → those kinds are false.
   */
  indicators?: IndicatorSnapshot | null;

  /**
   * Wall Street's targets for this ticker: the newest StreetConsensus row
   * within 14 days (lib/market-data/street-consensus-store). Read by a price
   * condition on a Street variable. Absent → that condition is false: no row,
   * a row too old, or the feed down all read the same way, a missed fire,
   * never a crash.
   */
  street?: { targetAvg: number; targetHigh: number; targetLow: number; asOf: string } | null;

  /**
   * Today's session so far. `volume` is consolidated volume through ~15
   * minutes ago (SIP); `open` is today's open. Read by volume and
   * gap. Absent → those kinds are false.
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
   * Open-position economics — required by move-from-entry (avgCost) and
   * trail (peakPrice). Supplied by the cron + live paths for
   * HOLDING theses; absent/null (WATCHING, or caller didn't join the
   * position) → those predicates return false (missed trigger, not a
   * crash). peakPrice is the water mark the five-minute pass keeps:
   * high-water for LONG, low-water for SHORT.
   */
  position?: {
    avgCost?: number | null;
    peakPrice?: number | null;
    /** When the position opened — the anchor for a day count `from: "BUY"`. */
    openedAt?: Date | null;
  } | null;

  /** Thesis fields needed by time-based predicates. */
  thesis: {
    createdAt: Date;
    /**
     * When an analyst last actually looked at this thesis. Drives
     * review-clock. Absent falls back to createdAt, which makes a
     * never-reviewed thesis due immediately.
     */
    lastReviewedAt?: Date | null;
    /**
     * The thesis's own event date (Thesis.catalystDate) — the anchor for a
     * day count `from: "EVENT"`. Absent/null → that count is false.
     */
    catalystDate?: Date | null;
    /**
     * "LONG" | "SHORT" | null — orients move-from-entry and
     * trail (a SHORT's gain is a price DROP; its peak is the
     * low-water mark). Absent → treated as LONG, the overwhelming default.
     */
    direction?: string | null;
  };

  /** Caller-supplied "now" — keeps the function pure and testable. */
  now: Date;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Does the predicate's condition hold? False (never a throw) when the context
 * is missing what it needs. Read off the measure catalog (./condition/read.ts).
 */
export function evaluateTrigger(predicate: When, ctx: EvaluationContext): boolean {
  return SHAPE_CHECKER.holds(predicate, ctx);
}

/**
 * What `shouldFire` asks of a predicate: does it hold now, and does it read
 * the next scheduled report (so a heads-up fires once per report). Answered
 * off the measure catalog (./condition/read.ts).
 */
export interface Checker {
  holds(p: When, ctx: EvaluationContext): boolean;
  readsUpcomingReport(p: When): boolean;
  /** It holds only on a filing or a report it hasn't fired for: each new one fires. */
  oncePerEvent(p: When): boolean;
}

/** Does the trigger's condition hold now, read with its own memory of the filings and reports it fired on. */
export function conditionHolds(trigger: Pick<Trigger, "predicate" | "firedFilings" | "firedReports" | "lastFiredAt">, ctx: EvaluationContext, checker: Checker = SHAPE_CHECKER): boolean {
  if (trigger.lastFiredAt) ctx = { ...ctx, firedAt: new Date(trigger.lastFiredAt) };
  if (trigger.firedFilings?.length) ctx = { ...ctx, firedFilings: trigger.firedFilings };
  if (trigger.firedReports?.length) ctx = { ...ctx, firedReports: trigger.firedReports };
  return checker.holds(trigger.predicate, ctx);
}

/**
 * The one fire rule: a trigger fires when it becomes true. Once it fires, it
 * does not fire again until a market close finds its condition false
 * (`firedSinceFalseClose`, ./condition/describe). A reason code says which (tests and the
 * evaluator's log read it).
 */
export function shouldFire(
  trigger: Trigger,
  ctx: EvaluationContext,
  checker: Checker = SHAPE_CHECKER,
): { fires: boolean; reason: "match" | "no-match" | "stale-quote" | "fired" } {
  if (!conditionHolds(trigger, ctx, checker)) return { fires: false, reason: "no-match" };

  // A buy never fires on a quote that isn't today's price: at 09:30 Finnhub
  // still reported ETN's Friday close as "now" (2026-09-14, DAV-261). An ADD
  // is a buy too.
  if ((trigger.action === "ENTER" || trigger.action === "ADD") && ctx.latestQuote?.stale) {
    return { fires: false, reason: "stale-quote" };
  }

  // A filing or a heads-up holds only on one it hasn't fired for
  // (./condition/read), so one that holds is a new filing or report: it fires
  // once per event. Two filings in a day each fire, and a wrong date it fired
  // for doesn't eat the real heads-up (AIR, a phantom 2026-09-21 before the
  // true 09-29, DAV-293).
  if (firedSinceFalseClose(trigger) && !checker.oncePerEvent(trigger.predicate)) {
    return { fires: false, reason: "fired" };
  }

  return { fires: true, reason: "match" };
}
