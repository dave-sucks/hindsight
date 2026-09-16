/**
 * Trigger-shape guard — symmetric correctness for WATCHING and ACTIVE theses.
 *
 * Used by both `record_thesis` (mint-time) and `update_thesis` (refresh-time)
 * to enforce that the resulting trigger list matches the thesis's state. Two
 * mirror-image structural rules:
 *
 *   WATCHING (no position yet) — a thesis carrying a PLAN LEVEL (a floor or
 *     a target) needs the buy level to reach it from, i.e. ≥1 ENTER. A name
 *     kept in view with no plan levels needs nothing at all, including no
 *     triggers (DAV-209).
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
        | "enter-actions-on-active"
        | "missing-exit-trigger-on-active";
      note: string;
    };

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
  // Symmetric to the WATCHING checks below. A held (HOLDING) thesis has an
  // open Alpaca position — the trigger list MUST carry EXIT (the automated
  // stop-loss path) and MUST NOT carry ENTER (already in the position).
  //
  // The notes name the ops that exist — add_triggers / remove_trigger_ids
  // (DAV-242) — and say "a stock we own", never the deleted ACTIVE status or
  // the deleted whole-list `triggers` argument (DAV-262: the CEG tactical run
  // was told to send the whole list on 2026-09-14).
  //
  // Production evidence: backfill 2026-05-26. The thesis-writer's
  // WATCHING-only prompt produced WATCHING-shape triggers on every ACTIVE
  // refresh, stripping EXIT predicates from 9 of 10 ACTIVE held paper
  // positions. The guard runs on the final list after every trigger op so
  // a refresh cannot strip the sell trigger from a held name.
  if (args.status === "HOLDING") {
    const enterOffenders = args.triggers.filter((t) => t.action === "ENTER");
    if (enterOffenders.length > 0) {
      return {
        ok: false,
        reason: "enter-actions-on-active",
        note:
          `This is a stock we already own, and the plan would still carry ` +
          `${enterOffenders.length} buy trigger(s) (action ENTER). A buy can't fire on a ` +
          `position we hold — the 5-minute check would only start runs that end ` +
          `"already in position".` +
          `\n\nFix: remove the buy trigger(s) by id — remove_trigger_ids: [${enterOffenders
            .map((t) => `"${t.id}"`)
            .join(", ")}]. A stock we own carries sells (EXIT), partial sales (TRIM), ` +
          `adds (ADD), stop moves (MOVE_STOP) and reviews (REVIEW); add those with add_triggers.`,
      };
    }
    const hasExit = args.triggers.some((t) => t.action === "EXIT");
    if (!hasExit) {
      return {
        ok: false,
        reason: "missing-exit-trigger-on-active",
        note:
          `A stock we own must carry at least one sell trigger (action EXIT) — that's the ` +
          `automated stop-loss path. Without it nothing sells the position when the ` +
          `price breaks the stop; the hourly price check is the only thing watching it.` +
          `\n\nFix: add one with add_triggers — action "EXIT" with a price predicate ` +
          `(PRICE_BELOW at the stop for a LONG position, PRICE_ABOVE at the stop for a ` +
          `SHORT), or set stop_loss, which is the same edit on the floor trigger.`,
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

  // A directional watch with NO plan level is a name being kept in view
  // without a buy plan — "not worth pricing right now." That is legal with
  // any triggers or none at all (DAV-209): a stock can be pinned with
  // nothing on it, and the only cost of doing so is that nothing wakes it.
  // What this guard still refuses is a HALF plan — a floor or a target
  // sitting on the row with no buy level to reach them from.
  const hasPlanLevel = args.triggers.some((t) =>
    isPlanLevel(t, args.direction),
  );
  if (!hasPlanLevel) return { ok: true };

  return {
    ok: false,
    reason: "missing-enter-trigger",
    note: `This thesis carries a plan level (a floor or a target) with no buy level to reach it from. Either finish the plan — set entry_price (the level the buy trigger fires on) — or remove the floor and target triggers and keep the name in view without a plan.`,
  };
}
