/**
 * Plan sanity — the arithmetic that says a written plan contradicts the
 * live tape. System 1, THREE_SYSTEMS.md Move 2 (DAV-188).
 *
 * Dave's acceptance test, verbatim: "I shouldn't have a thesis minted with
 * a target price that makes no sense based on the live price, that then
 * goes through 5 daily runs and triggers firing, and it still be wrong."
 *
 * The three production cases this covers:
 *   • CAPR — buy level written ~20% below where the stock trades: the
 *     condition is chronically true, fires forever, never sensibly fills.
 *   • Goalpost drift — a WATCHING target the price has already passed.
 *   • Incoherent-at-entry stops — the live price already past the planned
 *     stop, so a fill would close on the next tick.
 *
 * Design rules (why this is NOT another write-time gate):
 *   • Write-time checks catch birth defects; these flags catch DRIFT — the
 *     plan was fine when written and the world moved. They ride the
 *     resolver (`resolved.planSanity`), recompute against the live price on
 *     every read, and a flagged row is promoted into the daily run's FULL
 *     work list so the agent MUST see it (a flag on an unread row is
 *     decoration — the exact disease this module exists to end).
 *   • Judgment stays with the analyst: the flag states the arithmetic in
 *     plain words; the run fixes the number, states in one sentence why the
 *     level is deliberate, or stops watching. Nothing auto-moves a level.
 *   • WATCHING-only in this slice. Held rows already carry ladderHealth +
 *     live triggers for the same class of question; unresearched seeds
 *     (direction null) have no plan to check; PASS/RETIRED are history.
 *
 * Pure module — no DB, no clock, no fetches. Inputs come from data the
 * resolver already holds, so this adds zero cost to get_theses.
 */

export type PlanSanityFlag = {
  kind:
    | "ENTRY_FAR_FROM_PRICE"
    | "ENTRY_AT_PRICE"
    | "TARGET_ALREADY_PASSED"
    | "STOP_ALREADY_BREACHED"
    | "STOP_INSIDE_NOISE";
  /** Plain-language statement of the arithmetic, with the numbers. */
  text: string;
};

/**
 * How far (percent of live price) a WATCHING buy level may sit from the
 * tape before it's flagged. CAPR's chronic-true level sat ~20% away; 15%
 * flags that class while leaving room for genuine wait-for-my-price
 * setups. Deliberately one loose constant, not per-horizon tuning — the
 * flag asks a question, it doesn't refuse anything.
 */
export const ENTRY_DISTANCE_FLAG_PCT = 10;
// 15 → 10 on 2026-09-02. ASML sat at 13.7% from its buy level — a plan
// nobody could act on — and cleared the old bar by 1.3 points, so it went
// quiet instead of into the run's work list. 10% still leaves room for a
// genuine wait-for-my-price setup; it stops a plan rotting just under the
// alarm.

/**
 * The other end of the same question: a buy level ON the tape is a buy
 * condition already true, so it fires the day it's written and forever
 * after. TOST $35.15 vs a $35.16 tape, ISRG $401.23 vs $401.29. Half a
 * percent is inside a spread — tighter than that is one number twice.
 */
export const ENTRY_AT_PRICE_PCT = 0.5;

const fmt = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function computePlanSanity(args: {
  status: string;
  direction: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  currentPrice: number | null;
  /**
   * The stock's ordinary daily move as a percent of price (wider of today's
   * and the prior session's range — see getDailyRangePcts). Optional:
   * absent ⇒ the noise check is skipped, everything else still runs.
   */
  dayRangePct?: number | null;
}): PlanSanityFlag[] {
  const {
    status,
    direction,
    entryPrice,
    targetPrice,
    stopLoss,
    currentPrice,
    dayRangePct,
  } = args;
  if (status !== "WATCHING") return [];
  if (direction !== "LONG" && direction !== "SHORT") return [];
  if (currentPrice == null || currentPrice <= 0) return [];

  const isLong = direction === "LONG";
  const flags: PlanSanityFlag[] = [];

  if (entryPrice != null && entryPrice > 0) {
    const distPct = ((entryPrice - currentPrice) / currentPrice) * 100;
    if (Math.abs(distPct) > ENTRY_DISTANCE_FLAG_PCT) {
      const rel = distPct < 0 ? "below" : "above";
      flags.push({
        kind: "ENTRY_FAR_FROM_PRICE",
        text:
          `The buy level ${fmt(entryPrice)} is ${Math.abs(distPct).toFixed(0)}% ${rel} the live price ${fmt(currentPrice)}. ` +
          (distPct < 0 === isLong
            ? `A level this far ${rel} the tape either never fills or fills only in a collapse you wouldn't want to buy. `
            : `A level this far ${rel} the tape is a plan the price has left behind. `) +
          `Re-anchor it to current structure, state in one sentence why it's deliberately parked there, or stop watching.`,
      });
    } else if (Math.abs(distPct) < ENTRY_AT_PRICE_PCT) {
      flags.push({
        kind: "ENTRY_AT_PRICE",
        text:
          `The buy level ${fmt(entryPrice)} is the live price ${fmt(currentPrice)} — this plan has no entry. ` +
          `A buy condition that is already true fires the day it's written and re-fires forever, so nothing here is ever waiting for anything. ` +
          `Move it to a level the stock has not reached (a breakout above the tape, or a pullback below it), buy it now with place_trade if it is genuinely worth owning at this price, or stop watching.`,
      });
    }
  }

  if (targetPrice != null && targetPrice > 0) {
    const passed = isLong
      ? currentPrice >= targetPrice
      : currentPrice <= targetPrice;
    if (passed) {
      flags.push({
        kind: "TARGET_ALREADY_PASSED",
        text:
          `The live price ${fmt(currentPrice)} has already ${isLong ? "reached or passed" : "fallen to or through"} the target ${fmt(targetPrice)} — ` +
          `entering now would open at the finish line. Re-underwrite the target against today's tape, or archive the plan.`,
      });
    }
  }

  if (
    stopLoss != null &&
    stopLoss > 0 &&
    entryPrice != null &&
    entryPrice > 0 &&
    dayRangePct != null &&
    dayRangePct > 0
  ) {
    // The MNKD case: a stop closer to the entry than the stock's ordinary
    // daily wiggle stops out on noise, not on thesis failure.
    const stopDistancePct = (Math.abs(entryPrice - stopLoss) / entryPrice) * 100;
    if (stopDistancePct < dayRangePct) {
      flags.push({
        kind: "STOP_INSIDE_NOISE",
        text:
          `The stop ${fmt(stopLoss)} sits ${stopDistancePct.toFixed(1)}% from the buy level ${fmt(entryPrice)}, ` +
          `but this stock's ordinary daily move is ~${dayRangePct.toFixed(1)}%. Filled today, the plan would likely ` +
          `stop out on noise rather than thesis failure. Set the stop beneath real structure (below the range, a recent swing low), or rethink the entry.`,
      });
    }
  }

  if (stopLoss != null && stopLoss > 0) {
    const breached = isLong ? currentPrice <= stopLoss : currentPrice >= stopLoss;
    if (breached) {
      flags.push({
        kind: "STOP_ALREADY_BREACHED",
        text:
          `The live price ${fmt(currentPrice)} is already past the planned stop ${fmt(stopLoss)} — ` +
          `a fill would close on the next tick. The plan is incoherent at entry: move the levels to today's structure or stop watching.`,
      });
    }
  }

  return flags;
}
