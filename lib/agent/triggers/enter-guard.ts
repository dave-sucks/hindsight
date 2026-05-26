/**
 * Trigger-shape guard — symmetric correctness for WATCHING and ACTIVE theses.
 *
 * Used by both `record_thesis` (mint-time) and `update_thesis` (refresh-time)
 * to enforce that the triggers[] array matches the thesis's state. Two
 * mirror-image structural rules:
 *
 *   WATCHING (no position yet) — needs ≥1 ENTER, must not carry any HELD-only
 *     action (EXIT/TRIM/ADD/MOVE_STOP). Without ENTER the watchlist sits
 *     inert. With EXIT/TRIM/etc on WATCHING, the trigger evaluator would
 *     spawn orphan tactical EXIT runs on a position that doesn't exist.
 *
 *   ACTIVE (held position) — needs ≥1 EXIT (the automated stop-loss path),
 *     must not carry any ENTER action (already in, nothing to enter).
 *     Without EXIT the live position has no automated stop. With ENTER on
 *     ACTIVE, the evaluator would spawn orphan tactical ENTER runs on a
 *     position we already hold.
 *
 * The check is structural — does the array carry the required action and
 * not carry the forbidden ones? The horizon-aware predicate shapes
 * (PRICE_ABOVE target for LONG ENTER, PRICE_BELOW stop for LONG EXIT, etc.)
 * are supplied by `defaultTriggersForHorizon` in defaults.ts — this gate
 * just makes sure the right action kinds landed.
 *
 * Why a shared helper: record_thesis had a WATCHING-side guard inline since
 * the watchlist collapse; update_thesis was missing it. The XPEV/MDB
 * 2026-05-25 production evidence forced the WATCHING-side guard to cover
 * both write surfaces. The ACTIVE-side guard was added 2026-05-26 after the
 * backfill exposed the symmetric bug: the thesis-writer's WATCHING-only
 * prompt wrote WATCHING-shape triggers (1 ENTER, 0 EXIT) onto 9 of 10 ACTIVE
 * held paper positions. PR `claude/active-triggers-fix` shipped the
 * ENTER-on-ACTIVE rejection + missing-EXIT-on-ACTIVE rejection so the same
 * guard surface covers both states.
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
      reason:
        | "missing-enter-trigger"
        | "held-actions-on-watching"
        | "enter-actions-on-active"
        | "missing-exit-trigger-on-active";
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
 * Returns ok:true unless the resulting thesis is LONG/SHORT and one of:
 *   - WATCHING with no ENTER trigger, or carrying HELD-only actions
 *     (EXIT/TRIM/ADD/MOVE_STOP) that can't fire without a position
 *   - ACTIVE with an ENTER trigger (already in), or with no EXIT trigger
 *     (no automated stop-loss path)
 * PASS / PENDING never carry directional triggers. PROMOTED, CLOSED,
 * INVALIDATED, ARCHIVED, SUPERSEDED bypass — PROMOTED transitions resolve
 * to ACTIVE or WATCHING and run the check there; terminal rows are
 * immutable history.
 */
export function validateEnterTriggerRequired(
  args: EnterTriggerGuardArgs,
): EnterTriggerGuardResult {
  // PASS / PENDING never have directional triggers by design.
  if (args.direction !== "LONG" && args.direction !== "SHORT") {
    return { ok: true };
  }

  // ── ACTIVE-side checks ─────────────────────────────────────────────────
  // Symmetric to the WATCHING checks below. An ACTIVE thesis has an open
  // Alpaca position — the trigger array MUST carry EXIT (the automated
  // stop-loss path) and MUST NOT carry ENTER (already in the position).
  //
  // Production evidence: backfill 2026-05-26. The thesis-writer's
  // WATCHING-only prompt produced WATCHING-shape triggers on every ACTIVE
  // refresh, stripping EXIT predicates from 9 of 10 ACTIVE held paper
  // positions. Without this guard, the corruption survives any refresh
  // path that wholesale-replaces triggers (update_thesis with a triggers
  // arg). place_trade re-regenerates HELD triggers on the WATCHING/PROMOTED
  // → ACTIVE flip, but theses that are ALREADY ACTIVE and get refreshed
  // mid-flight are exposed in the gap.
  if (args.status === "ACTIVE") {
    const enterOffenders = args.triggers.filter((t) => t.action === "ENTER");
    if (enterOffenders.length > 0) {
      return {
        ok: false,
        reason: "enter-actions-on-active",
        note:
          `Your triggers[] array contains ${enterOffenders.length} ENTER action(s) ` +
          `on an ACTIVE thesis. ACTIVE means we already own the position — ENTER ` +
          `triggers fire on entry conditions but there's nothing to enter. The ` +
          `trigger evaluator would spawn orphan tactical ENTER runs that fail ` +
          `cleanly ("already in position") but generate noisy production logs.` +
          `\n\nFix: remove the ENTER trigger(s). For a held position use EXIT ` +
          `(stop-loss / target exit), TRIM (partial exit), ADD (scale in), ` +
          `MOVE_STOP (trail stop), or REVIEW (re-evaluate without auto-acting). ` +
          `The canonical shape is defaultTriggersForHorizon(horizon, prices, "HELD") ` +
          `— pass that array and the gate is satisfied.`,
      };
    }
    const hasExit = args.triggers.some((t) => t.action === "EXIT");
    if (!hasExit) {
      return {
        ok: false,
        reason: "missing-exit-trigger-on-active",
        note:
          `An ACTIVE thesis MUST carry at least one EXIT trigger — that's the ` +
          `automated stop-loss path. Without it, the trigger evaluator has no ` +
          `way to fire a tactical EXIT run when price hits the stop, and the ` +
          `position is exposed to manual oversight only (hourly price-monitor ` +
          `cron).\n\nFix: add a trigger with action: "EXIT" and a price predicate ` +
          `(PRICE_BELOW for LONG positions at stop_loss, PRICE_ABOVE for SHORT ` +
          `positions at stop_loss). For TRADE-horizon theses, also add an EXIT ` +
          `on target_price (auto-take-profit). The default HELD template at ` +
          `defaultTriggersForHorizon(horizon, prices, "HELD") produces the ` +
          `canonical shape — pass that array and the gate is satisfied.`,
      };
    }
    return { ok: true };
  }

  // ── WATCHING-side checks ───────────────────────────────────────────────
  if (args.status !== "WATCHING") return { ok: true };

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

  // ENTER-presence guard.
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
