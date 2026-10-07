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

import { MIN_RISK_REWARD, riskReward } from "@/lib/agent/thesis-shape";
import type { EntryRaiseAway } from "@/lib/agent/entry-raises";
import type { SpentBuyCrossing } from "@/lib/agent/buy-crossing";
import { CATALYST_WINDOW_DAYS, PRE_CATALYST_ENTRY_CUTOFF_DAYS, isPreCatalystPlay } from "@/lib/agent/knowledge/setups";

export type PlanSanityFlag = {
  kind:
    | "NOTHING_CAN_WAKE"
    | "NO_BUY_LEVEL"
    | "BUY_INSIDE_CUTOFF"
    | "ENTRY_FAR_FROM_PRICE"
    | "ENTRY_STALE"
    | "ENTRY_RAISED_AWAY"
    | "BUY_FIRED_UNANSWERED"
    | "TARGET_ALREADY_PASSED"
    | "STOP_ALREADY_BREACHED"
    | "STOP_INSIDE_NOISE"
    | "FLOOR_INSIDE_NOISE"
    | "PLAN_BELOW_RR_FLOOR"
    | "COMPOSITE_BELOW_MINIMUM";
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
 * A priced watch whose plan nobody has touched in this many calendar days
 * (~20 trading days) — the buy hasn't come and the chart it was priced
 * off has moved on. The run re-prices it from today's chart, or sets it
 * down. (The old ENTRY_AT_PRICE flag is gone, 2026-09-14: a buy at or near
 * the price is how buying now is written.)
 */
export const ENTRY_STALE_DAYS = 28;

const fmt = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Which rows live by the buying window is `isPreCatalystPlay` in setups.ts —
// the same function the sizing rule starts from, so the two cannot drift.
const isDatedBinary = isPreCatalystPlay;

const daysUntil = (d: Date, asOf: Date) => (d.getTime() - asOf.getTime()) / 86_400_000;

/**
 * The two honest ways to watch a stock with no buy level (QB ruling
 * 2026-09-27, checked against all 31 watched rows on the book).
 *
 *   1. A dated binary whose event is further out than the buying window.
 *      Pricing a level five months ahead is a guess. EXEL (156 days), BMRN,
 *      IBRX, PRAX, CORT.
 *   2. An earnings-drift name whose print is still ahead. The entry is
 *      above the gap-day low on days 1–3 AFTER the report; before the gap
 *      exists there is no level to write. AIR, JBL, KMX the day before.
 *
 * Neither needs a trigger to bring it back. This flag is computed when the
 * row is READ, on every run, so the first run after the window opens — or
 * after the print — sees NO_BUY_LEVEL on the row by itself. The first
 * version asked for a "70 days before the event" review on the thesis as
 * proof of a park; on the real book that parked nothing (no row carries
 * one) and would have had every run stamping a copy of a seat-level idea
 * onto five theses.
 */
function parkedUntil(
  args: { setupId?: string | null; horizon?: string | null; catalystDate?: Date | null },
  asOf: Date,
): "WINDOW_NOT_OPEN" | "PRINT_AHEAD" | null {
  if (!args.catalystDate) return null;
  const daysOut = daysUntil(args.catalystDate, asOf);
  if (isDatedBinary(args) && daysOut > CATALYST_WINDOW_DAYS[1]) return "WINDOW_NOT_OPEN";
  if (args.setupId === "PEAD" && daysOut >= 0) return "PRINT_AHEAD";
  return null;
}

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
  /** The thesis's 4-dimension composite, out of 10. Optional. */
  composite?: number | null;
  /** The analyst's minimum confidence to trade, 0–100. Optional. */
  minConfidence?: number | null;
  /** When the plan's levels were last written. Optional; absent ⇒ no staleness check. */
  lastLadderEditAt?: Date | null;
  /**
   * The buy level's moves away from the price in the last 30 days with no
   * structure cited (lib/agent/entry-raises). Optional; absent ⇒ no check.
   */
  entryRaisesAway?: EntryRaiseAway[] | null;
  /**
   * A buy that fired, was never bought, and that the price has since left
   * behind, so the crossing can never fire again (lib/agent/buy-crossing).
   * Optional; absent ⇒ no check. Suppressed by the caller while the analyst
   * is full — `buyBlockedByFull` owns the row on those days.
   */
  spentBuyCrossing?: SpentBuyCrossing | null;
  /**
   * How many triggers the stock carries of its OWN (not inherited from its
   * analyst or the account). Optional; absent ⇒ no check.
   */
  ownTriggerCount?: number | null;
  /**
   * Does the stock carry an ENTER trigger — the thing that can actually buy
   * it? Separate from `entryPrice`, which is a read model of the ladder and
   * can be stale. Optional; absent ⇒ no NO_BUY_LEVEL check.
   */
  hasEnterTrigger?: boolean | null;
  /**
   * Does the stock carry, of its OWN, a review at a price on the side a buy
   * would profit (above the price on a LONG) — a wake? With no buy that is
   * an answer to "can this ever be bought": look again there (QB ruling on
   * DAV-335, 2026-09-29). A review below the price is a "something broke"
   * line and does not count. Optional; absent ⇒ no wake.
   */
  hasPriceWake?: boolean | null;
  /**
   * The reviews the stock inherits from its analyst or the account. One on a
   * schedule or at a report date always comes in time, so the stock can come
   * back; one that waits on the price may stay silent for months, so it
   * only may. Optional; absent ⇒ only the stock's own triggers count.
   */
  inheritedWakes?: { always: boolean; mayWake: string[]; reportWithoutDate?: boolean } | null;
  /** The setup the plan is written on, for the pre-catalyst parking rule. */
  setupId?: string | null;
  /** The dated event, for the same rule. */
  catalystDate?: Date | null;
  /** The thesis horizon — a CATALYST row with no named setup is a dated binary too. */
  horizon?: string | null;
  now?: Date;
}): PlanSanityFlag[] {
  const {
    status,
    direction,
    entryPrice,
    targetPrice,
    stopLoss,
    currentPrice,
    dayRangePct,
    composite,
    minConfidence,
    lastLadderEditAt,
    entryRaisesAway,
    spentBuyCrossing,
    now,
  } = args;
  const asOf = now ?? new Date();
  if (status !== "WATCHING") return [];
  if (direction !== "LONG" && direction !== "SHORT") return [];

  const flags: PlanSanityFlag[] = [];
  // A directional watch with nothing of its own can never come back
  // (DAV-291: LUXE 2026-09-18, and six more on the PEAD analyst's list that
  // day). No buy price, no level to look again at, no review. The only
  // things that can touch it are the account's generic wakes. Needs no
  // live price, so it runs before the price guard.
  // An inherited review on a schedule or at a report date does reach it
  // (VST on 2026-09-23 carried this flag while an inherited review fired):
  // no flag then. One that waits on the price only may, and the flag says so.
  if (args.ownTriggerCount === 0 && entryPrice == null && !args.inheritedWakes?.always) {
    const may = args.inheritedWakes?.mayWake ?? [];
    const noDate = args.inheritedWakes?.reportWithoutDate ?? false;
    const ask = `Price the level you are waiting for (the pullback to a rising average, the base's pivot) with its stop and a target at 2:1 or better, or give it the wake that brings it back (a REVIEW at a price, or a short day-count review), or let it go.`;
    const head = may.length || noDate
      ? `${direction} with no buy price, no trigger and no review of its own.${
          noDate ? " Its earnings wake has no known date yet." : ""
        }${
          may.length ? ` The reviews it inherits wait on the price (${may.join("; ")}), so they may stay silent for months.` : ""
        }`
      : `${direction} with no buy price, no trigger and no review of its own: nothing can bring this stock back.`;
    flags.push({ kind: "NOTHING_CAN_WAKE", text: `${head} ${ask}` });
  }
  // ── NO_BUY_LEVEL (DAV-321) ──────────────────────────────────────────
  // A watched LONG/SHORT with no ENTER trigger cannot become a position, no
  // matter how often it is reviewed. 21 of 29 watched stocks were in this
  // state on 2026-09-26, including every Catalyst name but one, which is
  // why that seat held nothing. Eleven of them HAD a buy level and lost it
  // in an edit ("Removed: buy above $497" on MSFT); ten never had one.
  //
  // NOTHING_CAN_WAKE above asks "can anything reach this stock?" and every
  // one of the 21 passed it, because they all kept a review clock. This
  // asks the other question: "can this ever be bought?"
  //
  // Two honest ways to have no buy level, both dated — see `parkedUntil`.
  // A third, not dated: a review above the price (on a LONG), the wake the
  // stock is waiting for (QB ruling on DAV-335, 2026-09-29). VST's "review at $146 instead
  // of the buy while the score is under 7" is a plan to look again, not a
  // missing one; flagging it would tell every run to drop the wake update_thesis
  // now saves. Everything else owes an answer: price it, or let it go.
  if (args.hasEnterTrigger === false) {
    if (parkedUntil(args, asOf) == null && !args.hasPriceWake) {
      const daysOut = args.catalystDate ? Math.round(daysUntil(args.catalystDate, asOf)) : null;
      const windowOpen =
        isDatedBinary(args) && daysOut != null && daysOut >= 0 && daysOut <= CATALYST_WINDOW_DAYS[1];
      flags.push({
        kind: "NO_BUY_LEVEL",
        text:
          `${direction} on the watchlist with no buy trigger: nothing can turn this into a position, however often it is reviewed. ` +
          (windowOpen
            ? `The buying window is open — ${daysOut} days to the event. Price the buy now: the pivot or the pullback if the chart offers one, otherwise a close above the highest high of the last 20 sessions, with its stop under the last swing low and a target at 2:1 or better. If no level clears 2:1, let it go. `
            : "Answer it one of two ways — price the buy at a level you can name (the pivot, the reclaim, the pullback) with its stop and a target at 2:1 or better, or let it go. ") +
          "A rationale with no plan leaves it here tomorrow.",
      });
    }
  }

  // ── BUY_INSIDE_CUTOFF (DAV-321, ruling 4) ───────────────────────────
  // MIRM, 2026-09-17: a buy at $97.50 fired nine days before its FDA
  // decision and was proposed. The run-up trade sells one to two weeks
  // before the date; a buy still live inside the last three weeks is
  // holding the coin flip by accident.
  if (args.hasEnterTrigger === true && isDatedBinary(args) && args.catalystDate) {
    const daysOut = Math.round(daysUntil(args.catalystDate, asOf));
    if (daysOut >= 0 && daysOut <= PRE_CATALYST_ENTRY_CUTOFF_DAYS) {
      flags.push({
        kind: "BUY_INSIDE_CUTOFF",
        text: `The event is ${daysOut} day${daysOut === 1 ? "" : "s"} away and the buy is still live. Inside the last ${PRE_CATALYST_ENTRY_CUTOFF_DAYS} days a pre-catalyst entry is not a run-up trade, it is holding the decision. Set the plan down — remove the buy, the floor and the target by id — and say whether the name is worth a look after the event.`,
      });
    }
  }

  if (currentPrice == null || currentPrice <= 0) return flags;

  const isLong = direction === "LONG";

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
    }
  }

  if (entryPrice != null && entryPrice > 0 && lastLadderEditAt && now) {
    const days = Math.floor((now.getTime() - lastLadderEditAt.getTime()) / 86_400_000);
    if (days >= ENTRY_STALE_DAYS) {
      flags.push({
        kind: "ENTRY_STALE",
        text:
          `The buy level ${fmt(entryPrice)} was set ${days} days ago and hasn't filled — the chart it was priced from has moved on. ` +
          `Re-price it from today's Price structure (the setup's rule, today's numbers), or set the plan down.`,
      });
    }
  }

  // The MSFT shape: a fired buy answered by moving the level out of reach,
  // with no chart structure named. Not refused anywhere — said here, with
  // the count, so the pattern is loud.
  if (entryRaisesAway && entryRaisesAway.length > 0) {
    const n = entryRaisesAway.length;
    const moves = entryRaisesAway
      .map((r) => `${r.date}: ${r.from != null ? `${fmt(r.from)} → ` : ""}${fmt(r.to)} with the stock at ${fmt(r.price)}`)
      .join("; ");
    flags.push({
      kind: "ENTRY_RAISED_AWAY",
      text:
        `The buy level was moved ${isLong ? "above" : "below"} the price ${n === 1 ? "once" : `${n} times`} in the last 30 days with no structure cited (${moves}). ` +
        `A fired buy has two answers: buy it, or set the plan down and say why. A re-priced level names the structure it sits on — a pivot, an average, a swing — or it is the buy being avoided.`,
    });
  }

  // The ETN/ISRG shape: the buy fired, nothing bought it (both were refused
  // at the position limit), and the price walked away from the level. A buy
  // fires on the crossing, so the plan is now inert — and it clears none of
  // the other flags, because the level sits just UNDER the tape. See
  // lib/agent/buy-crossing.ts.
  if (spentBuyCrossing) {
    const c = spentBuyCrossing;
    // Which side the price is on is the buy trigger's to say: a breakout buy
    // is left behind when the price is ABOVE it, a pullback buy when the
    // price is BELOW it. See lib/agent/buy-crossing.ts.
    const past = `${c.pastPct.toFixed(1)}% ${c.crossing === "ABOVE" ? "above" : "below"} it`;
    // A breakout level the price cleared becomes support beneath a new entry;
    // a pullback level the price fell through becomes resistance above one.
    const oldLevel = c.crossing === "ABOVE" ? "the old level becomes support" : "the old level becomes resistance";
    const reAnchor = `re-anchor the buy to the current price — ${oldLevel} — with the stop and target that trade needs`;
    const chase = c.chaseLimitPct == null
      ? `This setup has no chase rule, so it is still buyable at today's price: ${reAnchor}.`
      : c.insideChase
        ? `This setup's chase limit is ${c.chaseLimitPct}% and the stock is ${past}, so it is still buyable at today's price: ${reAnchor}.`
        : `This setup's chase limit is ${c.chaseLimitPct}% and the stock is ${past}, so buying here is a chase: re-price the buy to the level this setup waits for, with the stop and target that trade needs.`;
    flags.push({
      kind: "BUY_FIRED_UNANSWERED",
      text:
        `The buy at ${fmt(c.level)} — which fires when the price ${c.crossing === "ABOVE" ? "rises through" : "falls to"} it — fired on ${c.firedAt} and this stock was never bought. ` +
        `It trades at ${fmt(currentPrice)} now, ${past}, ` +
        `so the buy cannot fire again — an ENTER fires on the crossing, and this one is spent. Nothing will act on this plan as written. ` +
        `${chase} If the move broke the setup instead, set the plan down and say what changed. Leaving the level where it is is not an answer.`,
    });
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

  // The HWM case: a watch floor parked within a normal day's move of the
  // live price. To the analyst it meant "if it can't hold today's level the
  // repair failed"; to the evaluator a floor is a tick-level tripwire that
  // sets the plan down the first print under it. HWM's was 0.35% under the
  // tape on 09-02 and gone 90 minutes later — the second time in two days.
  // The stop-vs-entry check above can't see this: it measures from the buy
  // level, which on a breakout plan sits well ABOVE the price.
  if (
    stopLoss != null &&
    stopLoss > 0 &&
    dayRangePct != null &&
    dayRangePct > 0
  ) {
    const floorGapPct = isLong
      ? ((currentPrice - stopLoss) / currentPrice) * 100
      : ((stopLoss - currentPrice) / currentPrice) * 100;
    if (floorGapPct > 0 && floorGapPct < dayRangePct) {
      flags.push({
        kind: "FLOOR_INSIDE_NOISE",
        text:
          `The floor ${fmt(stopLoss)} sits ${floorGapPct.toFixed(1)}% ${isLong ? "under" : "over"} the live price ${fmt(currentPrice)}, ` +
          `but this stock's ordinary daily move is ~${dayRangePct.toFixed(1)}%. A floor on a stock we don't own sets the plan down on the first tick through it, ` +
          `so an ordinary ${isLong ? "red" : "green"} day erases this plan. Put the floor under real structure with room, or say in one sentence that a break of today's level is meant to end the plan.`,
      });
    }
  }

  // The analyst's own bar. place_trade refuses any buy whose composite is
  // under the analyst's minimum confidence, so a priced plan below it can
  // never fill — and the agent found that out at the crossing (VST
  // 2026-09-08: 5/10 against a 78% bar, then moved the buy level instead
  // of the score). Say it on the row, before the crossing.
  // Only where there is a buy to refuse (decision 4, 2026-10-02): on a
  // stock with no buy level the warning describes a buy that does not exist,
  // and 17 of the 20 reviews this flag caused alone in September were that.
  if (
    composite != null &&
    minConfidence != null &&
    minConfidence > 0 &&
    composite * 10 < minConfidence &&
    (args.hasEnterTrigger === true || entryPrice != null)
  ) {
    flags.push({
      kind: "COMPOSITE_BELOW_MINIMUM",
      text:
        `This plan scores ${composite}/10 and this analyst only buys at ${(minConfidence / 10).toFixed(1)}/10 or better (its minimum confidence). ` +
        `The buy will be refused the day the level fires. Re-score honestly if the setup has improved, or set the plan down — moving the buy level does not change this.`,
    });
  }

  // The floor the write paths enforce, read back against what's stored:
  // rows written before the floor ran on every path (PLTR at 0.1:1) reach
  // the daily run this way instead of waiting for the next level edit.
  if (entryPrice != null && targetPrice != null && stopLoss != null) {
    const rr = riskReward(direction, entryPrice, targetPrice, stopLoss);
    if (rr != null && rr < MIN_RISK_REWARD) {
      flags.push({
        kind: "PLAN_BELOW_RR_FLOOR",
        text:
          `This plan pays ${rr.toFixed(1)}:1 — entry ${fmt(entryPrice)}, target ${fmt(targetPrice)}, stop ${fmt(stopLoss)} — under the ${MIN_RISK_REWARD}:1 floor every write path enforces. ` +
          `Any level edit will be refused until the plan clears it: raise the target to a cited level, tighten the stop to real structure, or set the plan down.`,
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
