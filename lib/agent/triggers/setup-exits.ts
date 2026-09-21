/**
 * setup-exits.ts — the exits a fill writes onto a stock from the setup it
 * was bought on (DAV-254, playbook E6 and Part F).
 *
 * Three rules, all from the catalog entry, none from the seat:
 *   • the time limit — "not working after N days" / the 60-day business
 *     checkpoint — as a day count from the buy (the review-cadence trigger's
 *     counting-from choice, #655), always a review, never a time stop;
 *   • a partial sale at N R — the setup's `manage.partialAtR`, as a TRIM at
 *     the gain that equals N times the stop distance;
 *   • the beat-the-market-sold review — a beat with the stock down 3% on
 *     the day (`manage.beatAndFadeReview`, TRADE and TARGET horizons).
 *
 * The trail stays on the analyst (Dave's ruling 2026-09-14: seat style lives
 * on each analyst's own rules). These are the stock's own, because they
 * depend on the stock's setup and its stop distance. Written through the
 * same ops path as everything else; an existing trigger in the same bucket
 * (the analyst chose one) is left alone by the caller.
 */

import {
  BIG_WINNER_PEAK_GAIN_PCT,
  BIG_WINNER_PEAK_WITHIN_DAYS,
  type Setup,
  type Horizon,
} from "@/lib/agent/knowledge/setups";
import type { Trigger } from "./types";
import type { TriggerOp } from "./ops";
import { triggerBucket } from "./bucket";
import { sessionsToCalendarDays } from "@/lib/market-hours";

/** A beat the market sold: down at least this much on the day of the reaction. */
export const BEAT_AND_FADE_DOWN_PCT = 3;

export function setupExitTriggers(input: {
  setup: Setup;
  horizon: Horizon | string | null;
  entry: number;
  stop: number | null;
  mintId: () => string;
  /**
   * When the stock was bought — the anchor the time limit counts from, and
   * the date the session-to-calendar conversion is measured across. A fill
   * writing its own exits passes now; a review naming the setup on a stock
   * already held passes the position's open date. Defaults to now.
   */
  boughtAt?: Date;
}): Trigger[] {
  const { setup, entry, stop } = input;
  const out: Trigger[] = [];
  // The big-winner rule is a trade/target idea; a compounder never trims on
  // a gain milestone and a catalyst exits on its event.
  const bigWinnerApplies = input.horizon === "TRADE" || input.horizon === "TARGET";

  // The time limit — "no progress in 20 sessions", the 60-day business
  // checkpoint — as a day count from the buy (#655). Always a review: the
  // playbook says exit OR re-set, and that is a decision, not a stop.
  //
  // THE ONE CONVERSION. The catalog writes the short clocks in sessions and
  // the checkpoints in calendar days; a REVIEW_CADENCE day count is always
  // calendar. Counting the real NYSE calendar here is the difference between
  // a breakout getting its 20 sessions and getting about 14 — the weekends
  // inside the window used to be spent as if the market had been open.
  // Never multiply by 7/5 anywhere else; convert here and say both units in
  // the sentence so the next reader can see which is which.
  if (setup.time.count != null && setup.time.count > 0) {
    const sessions = setup.time.unit === "SESSIONS" ? setup.time.count : null;
    const days =
      sessions != null
        ? sessionsToCalendarDays(sessions, input.boughtAt ?? new Date())
        : setup.time.count;
    out.push({
      id: input.mintId(),
      predicate: { kind: "REVIEW_CADENCE", days, from: "BUY" },
      action: "REVIEW",
      rationale:
        (sessions != null
          ? `${sessions} sessions after the buy — ${days} calendar days from this one`
          : `${days} days after the buy`) + ` — ${setup.time.text}`,
      cooldownDays: days,
      source: "DEFAULT",
    });
  }

  // The partial sale at N R — and the one thing that turns it off. A stock
  // that ran BIG_WINNER_PEAK_GAIN_PCT off the buy inside
  // BIG_WINNER_PEAK_WITHIN_DAYS is a likely big winner: the playbook holds
  // it and lets the trail manage it rather than cutting it in half. A slower
  // climb to the same gain is an ordinary winner and still gets de-risked.
  // Only where the partial lives at all, so a compounder and a catalyst are
  // untouched.
  if (setup.manage.partialAtR != null && stop != null && entry > 0 && stop > 0 && stop !== entry) {
    const distPct = (Math.abs(entry - stop) / entry) * 100;
    const pct = Math.round(setup.manage.partialAtR * distPct * 10) / 10;
    if (pct > 0) {
      out.push({
        id: input.mintId(),
        predicate: {
          kind: "GAIN_FROM_ENTRY",
          pct,
          direction: "UP",
          ...(bigWinnerApplies
            ? {
                skipIfPeakGainPct: BIG_WINNER_PEAK_GAIN_PCT,
                skipIfPeakWithinDays: BIG_WINNER_PEAK_WITHIN_DAYS,
              }
            : {}),
        },
        action: "TRIM",
        rationale:
          `Up ${pct}% from entry — ${setup.manage.partialAtR}R on a ${distPct.toFixed(1)}% stop. ${setup.target.text}` +
          (bigWinnerApplies
            ? ` Off for good once the stock has run ${BIG_WINNER_PEAK_GAIN_PCT}% off the buy within ${BIG_WINNER_PEAK_WITHIN_DAYS} days: a winner that fast is held and managed on the trail, not cut in half.`
            : ""),
        cooldownDays: 7,
        source: "DEFAULT",
      });
    }
  }

  if (setup.manage.beatAndFadeReview && (input.horizon === "TRADE" || input.horizon === "TARGET")) {
    out.push({
      id: input.mintId(),
      predicate: {
        kind: "AND",
        predicates: [
          { kind: "EARNINGS_BEAT" },
          { kind: "PRICE_MOVE_PCT", pct: BEAT_AND_FADE_DOWN_PCT, direction: "DOWN", window: "1D" },
        ],
      },
      action: "REVIEW",
      rationale: `A beat the market sold — the stock is down ${BEAT_AND_FADE_DOWN_PCT}%+ on the day it beat. The market wanted more; read the call before trusting the number, and tighten the floor.`,
      cooldownDays: 7,
      source: "DEFAULT",
    });
  }

  return out;
}

/**
 * The same exits, for a stock we already own whose review just named its
 * setup (DAV-285). 29 of 32 stocks on the book were written before setups
 * were named, so no fill ever wrote theirs. Entry is the real average cost,
 * the stop is the floor in force, and the day count runs from the actual
 * buy (the trigger reads the position's open date). A trigger already in
 * the same bucket — the analyst or Dave chose one — is left alone.
 */
export function heldSetupExitOps(input: {
  setup: Setup;
  horizon: Horizon | string | null;
  entry: number | null;
  stop: number | null;
  direction: string | null;
  stored: Trigger[];
  mintId: () => string;
  /** The position's open date — what the day count is measured from. */
  boughtAt?: Date;
}): TriggerOp[] {
  if (input.entry == null || !(input.entry > 0)) return [];
  // The partial sale is N times the risk taken at the buy. A floor already
  // raised past cost (MU 2026-09-17: cost $895.94, floor $969) is not that
  // risk any more, so no partial is written from it — the time limit and the
  // beat-the-market-sold review still are.
  const riskSide =
    input.stop != null && (input.direction === "SHORT" ? input.stop > input.entry : input.stop < input.entry);
  const taken = new Set(input.stored.map(triggerBucket));
  return setupExitTriggers({
    setup: input.setup,
    horizon: input.horizon,
    entry: input.entry,
    stop: riskSide ? input.stop : null,
    mintId: input.mintId,
    boughtAt: input.boughtAt,
  })
    .filter((t) => !taken.has(triggerBucket(t)))
    .map((trigger) => ({ op: "add" as const, trigger }));
}
