/**
 * Trigger-shape guard — symmetric correctness for WATCHING and ACTIVE theses.
 *
 * Used by both `record_thesis` (mint-time) and `update_thesis` (refresh-time)
 * to enforce that the resulting trigger list matches the thesis's state. Two
 * mirror-image structural rules:
 *
 *   WATCHING (no position yet) — nothing: a watch may carry a buy, a Stop
 *     watching line, reviews, or no triggers at all (DAV-209).
 *
 *   ACTIVE (held position) — needs ≥1 EXIT (the automated stop-loss path),
 *     must not carry any ENTER action (already in, nothing to enter).
 *     Without EXIT the live position has no automated stop. With ENTER on
 *     ACTIVE, the evaluator would spawn orphan tactical ENTER runs on a
 *     position we already hold.
 *
 * The check is structural — does the array carry the required action and
 * not carry the forbidden ones? The analyst writes the conditions; this gate
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
  /** The resulting triggers array. */
  triggers: Trigger[];
}

export type EnterTriggerGuardResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "enter-actions-on-active"
        | "missing-exit-trigger-on-active";
      note: string;
    };

/**
 * Returns ok:true unless the resulting thesis is LONG/SHORT and HOLDING with
 *   an ENTER trigger (already in), or with no EXIT trigger
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
          `This is a stock we already own, and its triggers would still carry ` +
          `${enterOffenders.length} buy trigger(s) (action ENTER). A buy can't fire on a ` +
          `position we hold — the 5-minute check would only start runs that end ` +
          `"already in position".` +
          `\n\nFix: remove the buy trigger(s) by id — remove_trigger_ids: [${enterOffenders
            .map((t) => `"${t.id}"`)
            .join(", ")}]. A stock we own carries sells (EXIT), partial sales (TRIM), ` +
          `adds (ADD) and reviews (REVIEW); add those with add_triggers.`,
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
          `price breaks the stop.` +
          `\n\nFix: add one with add_triggers — action "EXIT" with a price below the stop ` +
          `for a LONG position ({ watch: "price", is: "below", value: stop }; above it for ` +
          `a SHORT).`,
      };
    }
    return { ok: true };
  }

  // A watch needs nothing: a buy, a Stop watching line, a review, or none of
  // them (DAV-209). A Stop watching line needs no buy, and a sale is refused
  // on a watch per op (./condition/actions), so there is no watch rule here.
  return { ok: true };
}
