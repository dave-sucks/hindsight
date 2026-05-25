/**
 * ENTER-trigger guard — required ENTER action on directional WATCHING theses.
 *
 * Used by both `record_thesis` (mint-time) and `update_thesis` (refresh-time)
 * to keep the watching → tactical wake-up path alive. Without an ENTER
 * trigger, a WATCHING LONG/SHORT thesis sits inert: the trigger evaluator
 * has no entry predicate to fire on, the daily-run promotion path has no
 * level to compare current price against, and the thesis can never graduate
 * to ACTIVE without a manual override.
 *
 * The check itself is structural ("is there at least one t.action === 'ENTER'
 * in the final triggers array?"). The horizon-aware shape of the trigger
 * (PRICE_ABOVE target for LONG, PRICE_BELOW target for SHORT, with the right
 * cooldown per horizon) is supplied by `defaultTriggersForHorizon` in
 * defaults.ts — this gate just makes sure SOMETHING with action="ENTER"
 * landed in the row.
 *
 * Why a shared helper: record_thesis had this guard inline since the
 * watchlist collapse; update_thesis was missing it, which let the
 * thesis-writer's refresh path overwrite a valid WATCHING trigger set with
 * the HELD-template shape (EXIT on stop, REVIEW on target). Production
 * evidence on XPEV 2026-05-25 — the second write surface needed the same
 * Layer-1 enforcement as the first.
 */

import type { Trigger } from "./types";

export interface EnterTriggerGuardArgs {
  /** The resulting direction after the write. */
  direction: "LONG" | "SHORT" | "PASS" | "PENDING";
  /** The resulting status after the write (post-patch for updates). */
  status:
    | "WATCHING"
    | "ACTIVE"
    | "PROMOTED"
    | "CLOSED"
    | "INVALIDATED"
    | "ARCHIVED"
    | "SUPERSEDED";
  /** The resulting triggers array (after horizon merge + agent overlay). */
  triggers: Trigger[];
  /** The resulting target_price after the write — drives the error message. */
  targetPrice: number | null;
}

export type EnterTriggerGuardResult =
  | { ok: true }
  | {
      ok: false;
      reason: "missing-enter-trigger";
      note: string;
    };

/**
 * Returns ok:true unless the resulting thesis is WATCHING + LONG/SHORT with
 * no ENTER trigger in its final triggers array. PASS / PENDING / non-WATCHING
 * statuses bypass — only the watchlist-with-a-view shape requires ENTER.
 */
export function validateEnterTriggerRequired(
  args: EnterTriggerGuardArgs,
): EnterTriggerGuardResult {
  // PASS / PENDING never have ENTER triggers by design. ACTIVE has EXIT
  // triggers around the open position (HELD template). PROMOTED and the
  // terminal statuses (CLOSED / INVALIDATED / ARCHIVED / SUPERSEDED) are
  // also out of scope: PROMOTED transitions resolve to ACTIVE or WATCHING
  // and run the check there; terminal rows are immutable history.
  if (args.status !== "WATCHING") return { ok: true };
  if (args.direction !== "LONG" && args.direction !== "SHORT") {
    return { ok: true };
  }

  const hasEnter = args.triggers.some((t) => t.action === "ENTER");
  if (hasEnter) return { ok: true };

  const note =
    args.targetPrice == null
      ? `target_price is required on a directional WATCHING thesis — that's the level the ENTER trigger fires on. Either supply target_price (the breakout level for LONG, the breakdown level for SHORT) or set direction to PASS for institutional-memory-only entries.`
      : `Your supplied triggers[] array displaced the default ENTER trigger via the (predicate, action) merge bucket. Add a trigger with action: "ENTER" and a price predicate (PRICE_ABOVE for LONG, PRICE_BELOW for SHORT) at the entry level — without it the watchlist trigger pipeline can't promote this thesis.`;

  return {
    ok: false,
    reason: "missing-enter-trigger",
    note,
  };
}
