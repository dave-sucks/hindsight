/**
 * The triggers code writes on its own, and the trigger defaults.
 *
 * A stock has triggers and nothing else: its buy, its floor and any upside
 * rule are written by an analyst or the owner, one trigger at a time, never
 * stamped from code. A playbook's lines are its templates, listed in
 * Settings → Playbook (lib/agent/knowledge/playbooks.ts). What code still
 * writes: the account's standing rules, and each trigger's fire mode when
 * none is named.
 *
 * IDs are auto-assigned via randomUUID() — stable for the life of the
 * trigger so its fire history survives subsequent merges.
 */

import { shapeOf } from "./condition/valid";
import { reviewClockDays } from "./condition/rules";
import { randomUUID } from "node:crypto";
import type { Trigger } from "./types";
import { triggerSlot } from "./condition/slot";
import { withFireMode } from "./fire-mode";
import type { When } from "@/lib/agent/triggers/condition";

const createId = () => randomUUID();

export type Horizon = "CATALYST" | "TARGET" | "TRADE" | "COMPOUNDER";

/** Which of a stock's states a trigger list is read in. */
export type ThesisState = "HELD" | "WATCHING" | "PROMOTED";

// ── The add prompts ────────────────────────────────────────────────────

/**
 * The account's old up-7% add (docs/plans/SCALE_INTO_WINNERS.md PR2). No
 * longer seeded (expert review 1.1, 2026-11-19): a one-day spike is a reason
 * to look, not to buy more. Kept so rows that still carry its note read as
 * code's (templateNotes).
 */
const SCALE_IN_MOVE_PCT = 7;

function scaleInOnStrengthTrigger(): Trigger {
  return {
    id: createId(),
    predicate: { watch: "move", is: "above", value: SCALE_IN_MOVE_PCT, variable: "prev_close" },
    action: "ADD",
    rationale: `Up ${SCALE_IN_MOVE_PCT}% in a day — strength on a held name. Evaluate pressing the winner (add + raise target/stop) if the move is thesis-confirming, not an exhaustion spike. Approval-gated.`,
  };
}

/**
 * Reactive pullback-add rung (docs/plans/SCALE_INTO_WINNERS.md PR4).
 *
 * A sharp single-day DOWN move on a held conviction name spawns a tactical run
 * to evaluate adding at the discount — but the tactical prompt runs the
 * make-or-break "market/sector-wide vs company-specific" check first. A
 * market-wide dip with the thesis intact is a gift; a company-specific drop is
 * thesis damage (don't add — hold/trim/exit). ADD is held-only, asks the analyst now,
 * approval-gated, so a fire is a proposal the agent only makes after that check.
 *
 * The Secular Compounder's own rule since the DAV-279 ruling (2026-09-17):
 * a compounder averages into a market-wide dip; a trade and a catalyst
 * position do not. It left the account's starting rules that day; the
 * analyst templates (DAV-280) write it onto that seat.
 */
export function scaleInOnPullbackTrigger(): Trigger {
  return {
    id: createId(),
    predicate: { watch: "move", is: "below", value: SCALE_IN_MOVE_PCT, variable: "prev_close" },
    action: "ADD",
    rationale: `Down ${SCALE_IN_MOVE_PCT}% in a day — evaluate a pullback-add ONLY if the drop is market/sector-wide with the thesis intact. A company-specific drop is thesis damage: do not add — hold, trim, or exit. Approval-gated.`,
  };
}

// ── Account-wide standing rules ──────────────────────────────────────────
//
// What every stock on the account gets, whatever its playbook (expert review
// unit 1.1, docs/plans/EXPERT_REVIEW_1_1.md):
// - the sale off the high, for every holding: "the account's 6% off the high
//   governs every holding" (the owner, 2026-10-27). In the 12 weeks to
//   2026-11-19 it would have sold 15 of the 18 positions, 14 of them for
//   more than they fetched or are worth now.
// - a look on a big day: 7% from yesterday's close on twice the normal
//   volume, up or down ("either one" is two triggers). 41 such days on the
//   book in 12 weeks outside report days, 21 with no other trigger that day.
// It no longer carries the up-7% add: a one-day spike is a reason to look,
// not to buy more (an add is the playbook's, on its own line). The rule is
// one trigger per stock, never stamped onto a thesis: a thesis trigger in the
// same slot beats it, so a stamped copy would freeze one number onto every
// holding (ASML/CEG/WST, 2026-09-08).

/** The give-back off the high since we bought that sells a holding (the account's trail). */
export const ACCOUNT_TRAIL_PCT = 6;
/** A big day: this % from yesterday's close, up or down. */
export const BIG_DAY_MOVE_PCT = 7;
/** A big day: at least this many times the normal (20-day average) volume. */
export const BIG_DAY_VOLUME_X = 2;

function bigDayTrigger(is: "above" | "below"): Trigger {
  return {
    id: createId(),
    predicate: {
      match: "all",
      conditions: [
        { watch: "move", is, value: BIG_DAY_MOVE_PCT, variable: "prev_close" },
        { watch: "volume", value: BIG_DAY_VOLUME_X },
      ],
    },
    action: "REVIEW",
    fireMode: "ASK_NOW",
    rationale:
      is === "above"
        ? "A big day up on heavy volume: something happened."
        : "A big day down on heavy volume: something happened.",
  };
}

/** The account's universal rules: the trail on every holding, and a look on a big day. Fresh ids per call. */
export function accountStandingRules(): Trigger[] {
  const trail: Trigger = {
    id: createId(),
    predicate: { watch: "move", is: "below", value: ACCOUNT_TRAIL_PCT, variable: "peak" },
    action: "EXIT",
    fireMode: "ASK_NOW",
    rationale: "Protects the gain off the high since we bought.",
  };
  return [trail, bigDayTrigger("above"), bigDayTrigger("below")].map((t) => ({ ...t, source: "DEFAULT" as const }));
}

/**
 * "Look at this again every N days", counted from the last actual review.
 *
 * The review clock, and the ONLY thing that decides whether an analyst
 * spends money reviewing a watched name (DAV-209). With one, the daily run
 * picks the name up on that schedule; without one, nothing touches it until
 * one of its own triggers fires.
 *
 * A clock is chosen, never stamped: whoever writes the stock's lines (the
 * owner, an analyst, or its playbook's templates) decides how often to look
 * at it. A holding with none inherits the account's.
 */
export function reviewCadenceTrigger(days: number): Trigger {
  return {
    id: createId(),
    predicate: { watch: "repeat", value: days },
    action: "REVIEW",
    rationale:
      days === 1
        ? `Look at this every day.`
        : `Look at this every ${days} days, counting from the last real review.`,
  };
}

/**
 * When this thesis is next due, given when it was last actually looked at.
 *
 * This is the ONE place the review date comes from. The cached column this
 * used to feed is gone (DAV-221): it froze once when its writers were
 * deleted (DAV-195 L7) and every thesis past its last written date read as
 * overdue forever. A value derived at read time cannot freeze.
 *
 * The cadence is the clock on the list it is given (the resolved ladder, so
 * an inherited account clock counts); with none there is no review date.
 */
export function nextReviewFrom(
  lastReviewedAt: Date,
  triggers: Array<{ predicate: When }> | null | undefined,
): Date | null {
  const days = resolvedCadenceDays(triggers ?? []);
  return days == null ? null : new Date(lastReviewedAt.getTime() + days * 86_400_000);
}

/**
 * The review date every reporting surface shows, derived at read time.
 *
 * Null when there is no scheduled review: terminal rows, and any row whose
 * resolved ladder carries no clock (DAV-209 — inventing one would display a
 * review that will never fire).
 */
export function derivedNextReviewAt(thesis: {
  status: string | null;
  lastReviewedAt: Date | null;
  createdAt: Date;
  /** The resolved ladder, so a clock inherited from the analyst or the account counts. */
  triggers: unknown;
}): Date | null {
  if (thesis.status === "RETIRED" || thesis.status === "PASSED") return null;
  const triggers = Array.isArray(thesis.triggers) ? (thesis.triggers as Array<{ predicate: When }>) : [];
  return nextReviewFrom(thesis.lastReviewedAt ?? thesis.createdAt, triggers);
}

/** The cadence in force on a resolved ladder; null when nothing sets one. */
export function resolvedCadenceDays(
  triggers: Array<{ predicate: When }>,
): number | null {
  for (const t of triggers ?? []) {
    // Defensive: legacy rows carry malformed triggers (that is why
    // parseTriggersResilient exists), and this runs on the review-stamp path
    // of the most-called tool in the app. One bad trigger must not fail an
    // otherwise valid thesis update — it just doesn't supply the cadence.
    const w = shapeOf(t?.predicate);
    const days = w == null ? null : reviewClockDays(w);
    if (days != null && days > 0) return days;
  }
  return null;
}

/** Every note the code in this file writes. Older rows carry them with no source, so note.ts matches the words. */
export function templateNotes(): string[] {
  return [...accountStandingRules(), scaleInOnStrengthTrigger(), scaleInOnPullbackTrigger(), reviewCadenceTrigger(1), reviewCadenceTrigger(2)].map((t) => t.rationale ?? "");
}

/** Every write path saves each trigger with its fire mode: the one it names, else its action's default (./fire-mode). */
export function applyTriggerDefaults(triggers: Trigger[]): Trigger[] {
  return triggers.map((t) => withFireMode(t));
}

/**
 * Merge agent-supplied triggers with horizon defaults. Agent wins per
 * (predicate, action) bucket; defaults fill the gaps. Returns a fresh
 * array; never mutates inputs.
 */
export function mergeTriggers(
  defaults: Trigger[],
  agentSupplied: Trigger[],
): Trigger[] {
  const seen = new Set<string>();
  const out: Trigger[] = [];

  for (const t of agentSupplied) {
    const key = triggerSlot(t);
    if (seen.has(key)) continue; // dedupe within agent's own list
    seen.add(key);
    out.push(t.id ? t : { ...t, id: createId() });
  }
  for (const t of defaults) {
    const key = triggerSlot(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
