/**
 * `needsAction` — the per-thesis annotation get_theses puts on every row
 * so the daily-run agent doesn't have to cross-reference five different
 * prompt blocks to figure out what needs attention today.
 *
 * Three kinds, ALL trigger-driven. No hardcoded proximity thresholds, no
 * generic "within X% of level" math. If the agent wants warning at 5%
 * from stop, the agent should add a PRICE_BELOW REVIEW trigger when
 * minting the thesis — that's exactly what the trigger system is for.
 * Recreating proximity heuristics here would just relocate the
 * parallel-logic bug Fix #0 removes from price-monitor.
 *
 *   TRIGGER_FIRED       — there is a TRIGGER_FIRED ThesisUpdate row on
 *                         this thesis with no UPDATED/REVIEWED/CLOSED/
 *                         INVALIDATED follow-up newer than it. The
 *                         trigger evaluator already determined the
 *                         predicate matched; tactical-run either hasn't
 *                         spawned yet or didn't close out.
 *   TRIGGER_MATCHING_NOW — server-side `shouldFire` evaluation against
 *                         the fresh quote says one of the thesis's
 *                         price/time-side predicates is currently true.
 *                         Catches matches the cron may not have
 *                         delivered yet.
 *   REVIEW_DUE          — thesis.nextReviewAt < now. The agent SET this
 *                         cadence on the thesis (record_thesis uses
 *                         horizon-policy.ts defaults if the agent didn't
 *                         supply one explicitly).
 *
 * Precedence when multiple match: TRIGGER_FIRED > TRIGGER_MATCHING_NOW >
 * REVIEW_DUE. A thesis with no fires, no matches, and a future
 * nextReviewAt returns `null` — yesterday's thesis stands and the agent
 * doesn't need to touch it.
 *
 * Pure function. Caller supplies all data; no DB, no clock, no fetches.
 */

import { shouldFire } from "@/lib/agent/triggers/evaluate";
import type { Trigger, TriggerPredicate } from "@/lib/agent/triggers/types";

// ─── Public types ─────────────────────────────────────────────────────────────

export type NeedsActionVerb =
  | "ENTER"
  | "EXIT"
  | "REVIEW"
  | "ADD"
  | "TRIM"
  | "MOVE_STOP";

export type NeedsAction =
  | {
      kind: "TRIGGER_FIRED";
      triggerId: string;
      action: NeedsActionVerb;
      summary: string;
      firedAt: string;
    }
  | {
      kind: "TRIGGER_MATCHING_NOW";
      triggerId: string;
      action: NeedsActionVerb;
      predicateSummary: string;
      livePrice: number | null;
    }
  | {
      kind: "REVIEW_DUE";
      daysOverdue: number;
      /**
       * True when this is a PENDING thesis's first review — user/builder/
       * editor seeded the ticker and the agent hasn't researched it yet.
       * UI renders "Awaiting first research" instead of "Review overdue."
       */
      pendingFirstReview?: boolean;
    };

// ─── Predicate-side filters ──────────────────────────────────────────────────
// Mirror of trigger-evaluator's isPriceSidePredicate. A price-side
// predicate evaluates against a quote alone; a signal-side predicate
// needs a signal payload and we don't have one in this context, so we
// can't evaluate them inline at run-start. (Signal-side fires already
// arrive via the TRIGGER_FIRED audit row path.)

const PRICE_OR_TIME_KINDS = new Set([
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PRICE_MOVE_PCT",
  "VS_SMA",
  "RSI",
  "TIME_ELAPSED",
  "REVIEW_DATE_HIT",
]);

function isPriceOrTimePredicate(p: TriggerPredicate): boolean {
  if (PRICE_OR_TIME_KINDS.has(p.kind)) return true;
  if (p.kind === "AND" || p.kind === "OR") {
    return p.predicates.every(isPriceOrTimePredicate);
  }
  return false;
}

// ─── Predicate description (compact one-liner for the prompt) ───────────────

export function describePredicate(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_BELOW":
      return `price < $${p.level}`;
    case "PRICE_ABOVE":
      return `price > $${p.level}`;
    case "PRICE_MOVE_PCT":
      return `${p.direction === "UP" ? "+" : "−"}${p.pct}% over ${p.window}`;
    case "VS_SMA":
      return `${p.direction.toLowerCase()} ${p.period}-day SMA`;
    case "RSI":
      return `RSI ${p.direction.toLowerCase()} ${p.threshold}`;
    case "TIME_ELAPSED":
      return `${p.days}d elapsed since thesis creation`;
    case "REVIEW_DATE_HIT":
      return "scheduled review date reached";
    case "SIGNAL_TYPE":
      return `${p.signalType} signal${p.sentiment ? ` (${p.sentiment.toLowerCase()})` : ""}`;
    case "EARNINGS_BEAT":
      return `earnings beat${p.minSurprisePct ? ` ≥ ${p.minSurprisePct}%` : ""}`;
    case "EARNINGS_MISS":
      return `earnings miss${p.minSurprisePct ? ` ≥ ${p.minSurprisePct}%` : ""}`;
    case "GUIDANCE_CHANGE":
      return `guidance ${p.direction.toLowerCase()}`;
    case "FILING":
      return `${p.formType} filing`;
    case "AND":
      return `(${p.predicates.map(describePredicate).join(" AND ")})`;
    case "OR":
      return `(${p.predicates.map(describePredicate).join(" OR ")})`;
  }
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface NeedsActionInput {
  thesis: {
    id: string;
    /**
     * Direction is needed so PENDING theses (user/builder/editor seeds
     * awaiting first research) surface as REVIEW_DUE with the
     * `pendingFirstReview` discriminator.
     */
    direction?: string;
    triggers: Trigger[];
    createdAt: Date;
    nextReviewAt: Date | null;
  };
  /** Most recent ThesisUpdate row for this thesis, if any. */
  latestUpdate?: {
    type: string;
    triggerId?: string | null;
    timestamp: Date;
  } | null;
  /** Fresh quote — null when we couldn't fetch one for the ticker. */
  latestQuote?: { price: number; changePct: number } | null;
  /** Caller-supplied `now` keeps the function pure and testable. */
  now: Date;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function computeNeedsAction(
  input: NeedsActionInput,
): NeedsAction | null {
  const { thesis, latestUpdate, latestQuote, now } = input;

  // 1) TRIGGER_FIRED — most recent update is a fire that hasn't been
  //    answered by the agent. Tactical-run writes its UPDATED/REVIEWED/
  //    CLOSED/INVALIDATED row at completion, so seeing TRIGGER_FIRED at
  //    the top of the stack means the fire is still open work.
  if (latestUpdate?.type === "TRIGGER_FIRED" && latestUpdate.triggerId) {
    const t = thesis.triggers.find((x) => x.id === latestUpdate.triggerId);
    return {
      kind: "TRIGGER_FIRED",
      triggerId: latestUpdate.triggerId,
      action: (t?.action as NeedsActionVerb) ?? "REVIEW",
      summary: t ? describePredicate(t.predicate) : "(predicate removed)",
      firedAt: latestUpdate.timestamp.toISOString(),
    };
  }

  // 2) TRIGGER_MATCHING_NOW — server-side eval against the fresh quote
  //    + time-based predicates. Same `shouldFire` the trigger evaluator
  //    runs every 5 minutes; we just want the run-start snapshot too.
  //    Cooldown gating respected — a match within the cooldown window
  //    returns false from shouldFire, which is correct (the cron will
  //    re-fire when cooldown expires).
  for (const trigger of thesis.triggers) {
    if (!isPriceOrTimePredicate(trigger.predicate)) continue;
    const result = shouldFire(trigger, {
      latestQuote: latestQuote ?? undefined,
      thesis: {
        createdAt: thesis.createdAt,
        nextReviewAt: thesis.nextReviewAt,
      },
      now,
    });
    if (result.fires) {
      return {
        kind: "TRIGGER_MATCHING_NOW",
        triggerId: trigger.id,
        action: (trigger.action as NeedsActionVerb) ?? "REVIEW",
        predicateSummary: describePredicate(trigger.predicate),
        livePrice: latestQuote?.price ?? null,
      };
    }
  }

  // 3) REVIEW_DUE — agent-set cadence (nextReviewAt) elapsed. The agent
  //    chose this clock when minting the thesis; surfacing it is showing
  //    the agent its own schedule, not imposing a generic rule.
  //    Special case: PENDING theses (user/builder/editor seeds) carry
  //    nextReviewAt = createdAt so they surface as REVIEW_DUE on the
  //    next daily run with the pendingFirstReview discriminator.
  if (thesis.nextReviewAt && thesis.nextReviewAt.getTime() <= now.getTime()) {
    const daysOverdue = Math.floor(
      (now.getTime() - thesis.nextReviewAt.getTime()) / 86_400_000,
    );
    const result: NeedsAction = { kind: "REVIEW_DUE", daysOverdue };
    if (thesis.direction === "PENDING") {
      result.pendingFirstReview = true;
    }
    return result;
  }

  // Nothing to act on. Yesterday's thesis stands.
  return null;
}
