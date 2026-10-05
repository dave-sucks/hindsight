/**
 * Does a trigger fire: the evaluation context, and `shouldFire`, the one fire
 * decision (the condition, the crossing for a buy, a stale quote, the
 * cooldown, a report already fired for, a re-arm).
 *
 * Pure: no DB, no fetches, no clock. Everything comes through
 * `EvaluationContext`, and a condition missing what it reads is false rather
 * than a throw: the failure is a missed trigger, not a crashed cron. Whether a
 * condition holds is read off the measure catalog (./condition/read.ts); the
 * chart measures read the daily indicator snapshot next to the live quote.
 */

import { crossingBaseline } from "./written-price";
import type { Trigger, TriggerPredicate } from "./types";
import { effectiveCooldownDays } from "./defaults";
import type { EarningsReport } from "./earnings";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import type { SecFiling } from "@/lib/market-data/sec-events";
import { SHAPE_CHECKER } from "./condition/read";

// ── EvaluationContext ─────────────────────────────────────────────────

export interface EvaluationContext {
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
   * the evaluator's lookback window. Read by EARNINGS_BEAT / EARNINGS_MISS.
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
   * evaluator's lookahead. Read by EARNINGS_WITHIN — the heads-up before
   * a report, off the same calendar call as `earnings`. Absent → false.
   */
  upcomingEarnings?: EarningsReport | null;

  /**
   * This ticker's watched SEC filings inside the evaluator's lookback,
   * newest first. Read by SEC_EVENT. Absent → false.
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
    /** When the position opened — the anchor for a day count `from: "BUY"`. */
    openedAt?: Date | null;
    /**
     * When that water mark was set, written alongside peakPrice by the price
     * monitor. Read by the big-winner switch, which needs to tell a run that
     * took two weeks from one that took six months. Absent → the switch
     * can't prove the run was fast, so the partial stands.
     */
    peakAt?: Date | null;
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
     * The thesis's own event date (Thesis.catalystDate) — the anchor for a
     * day count `from: "EVENT"`. Absent/null → that count is false.
     */
    catalystDate?: Date | null;
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
 * Does the predicate's condition hold? False (never a throw) when the context
 * is missing what it needs. Read off the measure catalog (./condition/read.ts).
 */
export function evaluateTrigger(predicate: TriggerPredicate, ctx: EvaluationContext): boolean {
  return SHAPE_CHECKER.holds(predicate, ctx);
}

/**
 * What `shouldFire` asks of a predicate: does it hold now, does it compare the
 * price to a level (so a buy on it fires on the crossing), and does it read
 * the next scheduled report (so a heads-up fires once per report). Answered
 * off the measure catalog (./condition/read.ts).
 */
export interface Checker {
  holds(p: TriggerPredicate, ctx: EvaluationContext): boolean;
  readsPrice(p: TriggerPredicate): boolean;
  readsUpcomingReport(p: TriggerPredicate): boolean;
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
  checker: Checker = SHAPE_CHECKER,
): { fires: boolean; reason: "match" | "no-match" | "no-crossing" | "stale-quote" | "cooldown" } {
  // A filing trigger reads its own fired-filing memory; nothing else does.
  if (trigger.firedFilings?.length) ctx = { ...ctx, firedFilings: trigger.firedFilings };
  if (trigger.firedReports?.length) ctx = { ...ctx, firedReports: trigger.firedReports };
  const matched = checker.holds(trigger.predicate, ctx);
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
  //   A buy written after that close is measured from the price it was
  //   written at instead, until the next close — otherwise a level set on a
  //   down day is dead on arrival (./written-price).
  // A buy never fires on a quote that isn't today's price: at 09:30 Finnhub
  // still reported ETN's Friday close as "now" and Thursday's as the prior
  // close, so Friday's crossing counted twice (2026-09-14, DAV-261).
  // An ADD is a buy too.
  if ((trigger.action === "ENTER" || trigger.action === "ADD") && ctx.latestQuote?.stale) {
    return { fires: false, reason: "stale-quote" };
  }

  const baseline =
    trigger.action === "ENTER" && ctx.latestQuote?.prevClose != null && ctx.latestQuote.prevClose > 0
      ? crossingBaseline(trigger, ctx.latestQuote.prevClose, ctx.now)
      : null;
  if (baseline != null && ctx.latestQuote && checker.readsPrice(trigger.predicate)) {
    const atBaseline = checker.holds(trigger.predicate, {
      ...ctx,
      latestQuote: { ...ctx.latestQuote, price: baseline },
    });
    if (atBaseline) return { fires: false, reason: "no-crossing" };
  }

  // Read-path defense — see (2) in the docstring above. The written value,
  // the per-predicate default behind it, and the weekly floor a state
  // predicate can't go under, all in one place (./defaults).
  const effectiveCooldown = effectiveCooldownDays(trigger);

  // A heads-up is once per REPORT, and the cooldown is how that is enforced
  // inside one window — so a report this trigger has never fired for is not
  // in cooldown, whatever the clock says. Without this, one fire against a
  // wrong date eats the real heads-up: AIR fired for a phantom 2026-09-21
  // and the 7-day cooldown ran past the true 09-29 window (DAV-293).
  const reportDate = checker.readsUpcomingReport(trigger.predicate)
    ? (ctx.upcomingEarnings?.reportDate ?? null)
    : null;
  const unfiredReport = reportDate != null && !(trigger.firedReports ?? []).includes(reportDate);

  // A buy a trigger run passed on because the price had slipped back under
  // its level is left armed (./rearm, DAV-343): a re-arm after the last fire
  // lifts the cooldown, and the next fire stamps a new one.
  const rearmed =
    trigger.rearmedAt != null &&
    trigger.lastFiredAt != null &&
    new Date(trigger.rearmedAt).getTime() >= new Date(trigger.lastFiredAt).getTime();

  if (effectiveCooldown > 0 && trigger.lastFiredAt != null && !unfiredReport && !rearmed) {
    const lastFired = new Date(trigger.lastFiredAt).getTime();
    const cooldownMs = effectiveCooldown * 86_400_000;
    if (ctx.now.getTime() - lastFired < cooldownMs) {
      return { fires: false, reason: "cooldown" };
    }
  }

  return { fires: true, reason: "match" };
}
