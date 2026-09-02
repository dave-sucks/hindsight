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
import { isPlanLevel } from "./price-levels";

export interface EnterTriggerGuardArgs {
  /**
   * The resulting direction after the write. P1-24 B4: `null` is the
   * unresearched-seed sentinel (legacy 'PENDING' kept for the dual-read
   * window). Any non-LONG/SHORT value (PASS, PENDING, null) bypasses — a
   * seed/PASS never carries directional triggers.
   */
  direction: "LONG" | "SHORT" | "PASS" | null;
  /** The resulting status after the write (post-patch for updates). */
  status:
    | "WATCHING"
    | "HOLDING"
    | "PROMOTED"
    // PASSED (PASS theses) and RETIRED (terminal) both bypass like the other
    // terminal states — the guard returns ok:true for any non-LONG/SHORT
    // direction before it ever inspects status. Listed so
    // record_thesis/update_thesis can pass the post-write status without a cast.
    | "PASSED"
    | "RETIRED";
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
 * PASS and unresearched seeds (direction null/new or 'PENDING'/legacy) never
 * carry directional triggers. PROMOTED, CLOSED, INVALIDATED, ARCHIVED,
 * SUPERSEDED bypass — PROMOTED transitions resolve to ACTIVE or WATCHING and
 * run the check there; terminal rows are immutable history.
 */
export function validateEnterTriggerRequired(
  args: EnterTriggerGuardArgs,
): EnterTriggerGuardResult {
  // PASS / unresearched seeds (null or 'PENDING') never have directional
  // triggers by design — allowlist on LONG/SHORT catches every other value.
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
  if (args.status === "HOLDING") {
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

  // The HELD-action guard that used to sit here is GONE (DAV-195 L5).
  //
  // It refused EXIT/TRIM/ADD/MOVE_STOP on a WATCHING thesis, and its own
  // reason said why: "the trigger evaluator will spawn orphan tactical runs
  // that fail cleanly ('no position to close')". That was true — the system
  // had no verb for a price level firing on something we don't own, so the
  // only safe move was to forbid writing one.
  //
  // It also forbade the correct behaviour. A floor on a watch item is the
  // price at which the plan is wrong, and refusing to store it is why 19 of
  // 19 watchlist rows carry a stop that fires nothing (the KLAC shape: buy
  // $262, floor $225, price $184, breached in June, nothing happened).
  //
  // `effectiveTriggerAction` now resolves an EXIT on a non-held thesis to
  // DEMOTE — set the plan down, keep watching — inline, with no tactical
  // spawn. The orphan run the gate was protecting against cannot occur, so
  // the gate is deleted rather than relaxed. Per DAV-210: the missing thing
  // was a verb, not another rule.
  //
  // TRIM/ADD/MOVE_STOP on a watch item stay meaningless, but they are inert
  // rather than harmful (position-scoped, they evaluate false), and the
  // shape gate below still requires a real ENTER.

  // ENTER-presence guard.
  const hasEnter = args.triggers.some((t) => t.action === "ENTER");
  if (hasEnter) return { ok: true };

  // The set-down state (DAV-224, WATCHLIST_STATES.md §5). A directional
  // watch whose ladder carries NO plan level but ≥1 REVIEW-action wake is a
  // DEMOTED name — "not worth a priced plan right now; wake me if…" — the
  // same shape the automatic DEMOTE fire (L5) already leaves behind. The
  // guard exists to prevent INERT rows and half-plans, not to forbid
  // setting a plan down: no plan at all + a wake = legal; any plan level
  // present (isPlanLevel — the set the DEMOTE fire strips) = the full-plan
  // rules apply and an ENTER is required as before.
  const hasPlanLevel = args.triggers.some((t) =>
    isPlanLevel(t, args.direction),
  );
  const hasReviewWake = args.triggers.some((t) => t.action === "REVIEW");
  if (!hasPlanLevel && hasReviewWake) return { ok: true };

  const note =
    args.targetPrice == null
      ? `A directional WATCHING thesis needs a priced plan: entry_price (the buy level the ENTER trigger fires on) and target_price. Supply both, set direction to PASS for institutional-memory-only entries, or — to set the plan down and keep watching for free — resend triggers with the plan levels removed and at least one REVIEW-action wake condition ("review if the price crosses $X / moves 8% in a day / on the next earnings print").`
      : `Your supplied triggers[] array displaced the default ENTER trigger via the (predicate, action) merge bucket. Add a trigger with action: "ENTER" and a price predicate at the BUY level — PRICE_ABOVE when that level is above the live price (a breakout you want confirmed), PRICE_BELOW when it is below (a pullback you want to pay); a short mirrors. Without it the watchlist trigger pipeline can't promote this thesis. (If your intent is to STOP pricing this name, that's a demotion: resend with the plan levels removed entirely and keep ≥1 REVIEW-action wake.)`;

  return {
    ok: false,
    reason: "missing-enter-trigger",
    note,
  };
}
