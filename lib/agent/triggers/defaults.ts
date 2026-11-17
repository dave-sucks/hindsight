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
 * Reactive strength-press rung (docs/plans/SCALE_INTO_WINNERS.md PR2).
 *
 * A strong single-day up-move on a HELD position spawns a tactical run to
 * evaluate pressing the winner. `ADD` is a held-only action and asks the
 * analyst now by default (the agent decides + confirms), and it is
 * approval-gated, so a fire produces an add *proposal*.
 * a move from yesterday's close is cron-evaluable (reads the daily change), so
 * this fires intraday — the reactive complement to PR3's morning RUNNING_WINNER
 * flag.
 *
 * Deliberately UP-only for now. The pullback (down-day) add rung waits for PR4,
 * where the tactical run gains the market-wide-vs-company-specific judgment
 * needed to add into a dip without buying into thesis damage. Threshold tunable.
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
// What every holding on the account gets: the +7% add prompt. The −7% add
// is the Compounder's own (DAV-279: a trade doesn't average down). Sell
// rules are NOT here and are NOT stamped onto theses at mint or fill — a
// thesis rung beats every rule above it, so a stamped copy froze one 8%
// sell onto every holding (ASML/CEG/WST, 2026-09-08). An analyst's own
// sell rules live on the analyst (its Triggers tab), where its style is.

/** The account's universal add prompt. Fresh id per call. */
export function accountStandingRules(): Trigger[] {
  return [{ ...scaleInOnStrengthTrigger(), source: "DEFAULT" }];
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
  return [...accountStandingRules(), scaleInOnPullbackTrigger(), reviewCadenceTrigger(1), reviewCadenceTrigger(2)].map((t) => t.rationale ?? "");
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
