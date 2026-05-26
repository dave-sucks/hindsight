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
      reason: "missing-enter-trigger" | "held-actions-on-watching";
      note: string;
    };

/**
 * Action kinds that only make sense on HELD positions (ACTIVE status) — they
 * all operate on an open Alpaca position. A WATCHING thesis has no position,
 * so any of these on a WATCHING row is structurally wrong:
 *
 *   - EXIT       → close a position that doesn't exist
 *   - TRIM       → reduce a position that doesn't exist
 *   - ADD        → scale into a position that doesn't exist
 *   - MOVE_STOP  → adjust the stop on a position that doesn't exist
 *
 * Production evidence on MDB 2026-05-25: the thesis-writer's refresh path
 * landed a WATCHING thesis with 3 EXIT triggers (earnings_miss, guidance
 * cut, price_below stop). Trigger evaluator would have spawned orphan
 * tactical EXIT runs the moment price crossed the stop — close_position
 * refuses cleanly ("no position"), but the noisy logs on day 1 of live
 * trading are exactly what we don't want. ENTER + REVIEW are the only
 * legal actions on WATCHING.
 */
const HELD_ONLY_ACTIONS = ["EXIT", "TRIM", "ADD", "MOVE_STOP"] as const;
type HeldOnlyAction = (typeof HELD_ONLY_ACTIONS)[number];

/**
 * Returns ok:true unless the resulting thesis is WATCHING + LONG/SHORT with
 * a structurally-wrong trigger array — either missing the required ENTER
 * action, OR carrying any HELD-only action (EXIT/TRIM/ADD/MOVE_STOP) that
 * can't logically fire when there's no position. PASS / PENDING /
 * non-WATCHING statuses bypass.
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

  // HELD-action guard — reject EXIT/TRIM/ADD/MOVE_STOP on WATCHING.
  // Checked BEFORE the ENTER-presence guard so the error message points
  // at the bigger structural problem first (a WATCHING thesis with EXIT
  // triggers is almost certainly the agent applying the HELD template
  // wholesale, which the ENTER-presence message doesn't surface).
  const heldOffenders = args.triggers.filter((t) =>
    (HELD_ONLY_ACTIONS as readonly string[]).includes(t.action),
  );
  if (heldOffenders.length > 0) {
    const offenderKinds = Array.from(
      new Set(heldOffenders.map((t) => t.action as HeldOnlyAction)),
    ).join(", ");
    return {
      ok: false,
      reason: "held-actions-on-watching",
      note:
        `Your triggers[] array contains ${heldOffenders.length} HELD-only action(s) ` +
        `(${offenderKinds}) on a WATCHING thesis. WATCHING means we don't own ` +
        `the position yet — EXIT/TRIM/ADD/MOVE_STOP can only fire when an ` +
        `Alpaca position is open (ACTIVE status). The trigger evaluator will ` +
        `spawn orphan tactical runs that fail cleanly ("no position to close") ` +
        `but generate noisy production logs. ` +
        `\n\nFix: remove the ${offenderKinds} trigger(s) from your triggers[] array. ` +
        `If you want to express "remove this name from the watchlist if X happens," ` +
        `use update_thesis(change_status: "INVALIDATED" | "ARCHIVED") at the ` +
        `moment X happens, not a pre-positioned EXIT trigger. If you want ` +
        `"re-evaluate this entry decision if X happens," use action: "REVIEW".`,
    };
  }

  // ENTER-presence guard — the existing check.
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
