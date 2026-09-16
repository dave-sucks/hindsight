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

import type { Setup, Horizon } from "@/lib/agent/knowledge/setups";
import type { Trigger } from "./types";

/** A beat the market sold: down at least this much on the day of the reaction. */
export const BEAT_AND_FADE_DOWN_PCT = 3;

export function setupExitTriggers(input: {
  setup: Setup;
  horizon: Horizon | string | null;
  entry: number;
  stop: number | null;
  mintId: () => string;
}): Trigger[] {
  const { setup, entry, stop } = input;
  const out: Trigger[] = [];

  // The time limit — "not working after N days", the 60-day business
  // checkpoint — as a day count from the buy (#655). Always a review: the
  // playbook says exit OR re-set, and that is a decision, not a stop.
  if (setup.time.tradingDays != null && setup.time.tradingDays > 0) {
    out.push({
      id: input.mintId(),
      predicate: { kind: "REVIEW_CADENCE", days: setup.time.tradingDays, from: "BUY" },
      action: "REVIEW",
      rationale: `${setup.time.tradingDays} days after the buy — ${setup.time.text}`,
      cooldownDays: setup.time.tradingDays,
      source: "DEFAULT",
    });
  }

  if (setup.manage.partialAtR != null && stop != null && entry > 0 && stop > 0 && stop !== entry) {
    const distPct = (Math.abs(entry - stop) / entry) * 100;
    const pct = Math.round(setup.manage.partialAtR * distPct * 10) / 10;
    if (pct > 0) {
      out.push({
        id: input.mintId(),
        predicate: { kind: "GAIN_FROM_ENTRY", pct, direction: "UP" },
        action: "TRIM",
        rationale: `Up ${pct}% from entry — ${setup.manage.partialAtR}R on a ${distPct.toFixed(1)}% stop. ${setup.target.text}`,
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
