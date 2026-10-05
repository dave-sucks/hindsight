/**
 * Which predicate kinds a person may add by hand, at each level.
 *
 * The add paths refuse anything outside these sets, and the trigger dialog
 * reads the same sets to know what it may offer, so a button on screen can't
 * promise a trigger the server will refuse. Moved here from
 * lib/actions/thesis-edit.ts and lib/actions/level-triggers.ts (both
 * server-only) so the browser can import them.
 *
 * Pure and client-safe.
 */

import type { TriggerPredicate } from "./types";

type Kind = TriggerPredicate["kind"];

/** On a stock (Thesis.triggers). */
export const THESIS_ADDABLE_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PRICE_MOVE_PCT",
  "GAIN_FROM_ENTRY",
  "TRAILING_FROM_HIGH",
  "REVIEW_CADENCE",
  // The earnings heads-up, and the result at the report.
  "EARNINGS_WITHIN",
  "EARNINGS_BEAT",
  "EARNINGS_MISS",
  // The window after a report (the earnings-drift buy). The evaluator has
  // read it since September; the dialog's "After" button is what adds it.
  "EARNINGS_SINCE",
  "VS_SMA",
  "NEAR_SMA",
  "VOLUME_RATIO",
  "NEW_HIGH",
  "PCT_FROM_52W_HIGH",
  "RS_VS_SPY",
  "GAP_UP",
  "RSI",
  "INSIDER_CLUSTER",
  "SEC_EVENT",
]);

/**
 * On an analyst or the account (AgentConfig.triggers / Account.triggers): a
 * standing rule has to mean the same thing on every stock it covers, so an
 * absolute price level is excluded.
 *
 * GAIN_FROM_ENTRY and TRAILING_FROM_HIGH are allowed even though they read the
 * position: they evaluate false with no open position, and "every holding
 * trails 6%" is the most valuable thing a standing rule can say.
 */
export const LEVEL_ELIGIBLE_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  "PRICE_MOVE_PCT",
  "GAIN_FROM_ENTRY",
  "TRAILING_FROM_HIGH",
  "VS_SMA",
  "RSI",
  "NEAR_SMA",
  "VOLUME_RATIO",
  "NEW_HIGH",
  "PCT_FROM_52W_HIGH",
  "RS_VS_SPY",
  "GAP_UP",
  "INSIDER_CLUSTER",
  "SEC_EVENT",
  "EARNINGS_BEAT",
  "EARNINGS_MISS",
  // "Review 3 days before earnings" and "in the 2 days after" mean the same
  // on every stock. The account's heads-up is seeded by code; these let a
  // person add one at an analyst too.
  "EARNINGS_WITHIN",
  "EARNINGS_SINCE",
  // A day count means the same on every stock: "review 10 days before the
  // event date", "sell 30 days after the buy if still held".
  "REVIEW_CADENCE",
]);

/** Kinds that read the open position. On an un-held stock they could never fire, so a hand add is refused there. */
export const POSITION_SCOPED_KINDS: ReadonlySet<Kind> = new Set<Kind>(["GAIN_FROM_ENTRY", "TRAILING_FROM_HIGH"]);
