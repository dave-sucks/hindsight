/**
 * Does a trigger fire: the evaluation context, and `shouldFire`, the one fire
 * decision. A trigger fires when its condition holds and it is not inside the
 * wait saved on it (`cooldownDays`, counted from `lastFiredAt`). A buy or add
 * never fires on a stale quote; a heads-up whose report it never fired for is
 * not waiting.
 *
 * Pure: no DB, no fetches, no clock. Everything comes through
 * `EvaluationContext`, and a condition missing what it reads is false rather
 * than a throw: the failure is a missed trigger, not a crashed cron. Whether a
 * condition holds is read off the measure catalog (./condition/read.ts); the
 * chart measures read the daily indicator snapshot next to the live quote.
 */

import type { Trigger } from "./types";
import { effectiveCooldownDays } from "./defaults";
import type { EarningsReport } from "./earnings";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import type { SecFiling } from "@/lib/market-data/sec-events";
import { SHAPE_CHECKER } from "./condition/read";
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
}

/**
 * The one fire rule: a trigger fires when its condition holds and it is not
 * inside the wait saved on it (`cooldownDays`, counted from `lastFiredAt`; a
 * row saved before the wait was written reads its measure's default). A
 * reason code says which (tests and the evaluator's log read it).
 */
export function shouldFire(
  trigger: Trigger,
  ctx: EvaluationContext,
  checker: Checker = SHAPE_CHECKER,
): { fires: boolean; reason: "match" | "no-match" | "stale-quote" | "cooldown" } {
  // A filing trigger reads its own fired-filing memory; nothing else does.
  if (trigger.firedFilings?.length) ctx = { ...ctx, firedFilings: trigger.firedFilings };
  if (trigger.firedReports?.length) ctx = { ...ctx, firedReports: trigger.firedReports };
  const matched = checker.holds(trigger.predicate, ctx);
  if (!matched) return { fires: false, reason: "no-match" };

  // A buy never fires on a quote that isn't today's price: at 09:30 Finnhub
  // still reported ETN's Friday close as "now" (2026-09-14, DAV-261). An ADD
  // is a buy too.
  if ((trigger.action === "ENTER" || trigger.action === "ADD") && ctx.latestQuote?.stale) {
    return { fires: false, reason: "stale-quote" };
  }

  // A heads-up is once per REPORT, and the wait is how that is enforced
  // inside one window — so a report this trigger has never fired for is not
  // waiting, whatever the clock says. Without this, one fire against a wrong
  // date eats the real heads-up: AIR fired for a phantom 2026-09-21 and the
  // 7-day wait ran past the true 09-29 window (DAV-293).
  const reportDate = checker.readsUpcomingReport(trigger.predicate)
    ? (ctx.upcomingEarnings?.reportDate ?? null)
    : null;
  const unfiredReport = reportDate != null && !(trigger.firedReports ?? []).includes(reportDate);

  const wait = effectiveCooldownDays(trigger);
  if (wait > 0 && trigger.lastFiredAt != null && !unfiredReport) {
    if (ctx.now.getTime() - new Date(trigger.lastFiredAt).getTime() < wait * 86_400_000) {
      return { fires: false, reason: "cooldown" };
    }
  }

  return { fires: true, reason: "match" };
}
