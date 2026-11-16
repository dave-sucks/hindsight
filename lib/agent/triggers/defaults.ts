/**
 * The triggers code writes on its own, and the trigger defaults.
 *
 * A stock has triggers and nothing else: its buy, its floor and any upside
 * rule are written by an analyst or the owner, one trigger at a time, never
 * stamped from a template. What code still writes: a held stock's review
 * clock, keyed off its horizon (the morning run looks at a holding on that
 * schedule), the account's standing rules, and each trigger's cooldown and
 * fire mode when none is named.
 *
 * IDs are auto-assigned via randomUUID() — stable for the life of the
 * trigger so cooldown stamps survive subsequent merges.
 */

import { shapeOf } from "./condition/valid";
import { defaultCooldownDays, reviewClockDays } from "./condition/rules";
import { randomUUID } from "node:crypto";
import type { Trigger } from "./types";
import { triggerSlot } from "./condition/slot";
import { flooredCooldownDays } from "./state-cooldown";
import { withFireMode } from "./fire-mode";
import type { When } from "@/lib/agent/triggers/condition";

export { isStatePredicate, STATE_PREDICATE_MIN_COOLDOWN_DAYS } from "./state-cooldown";

const createId = () => randomUUID();

export type Horizon = "CATALYST" | "TARGET" | "TRADE" | "COMPOUNDER";

/** HELD gets the horizon's review clock; a stock we watch (or a promoted one) gets nothing. */
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
    // 3-day cooldown so a multi-day run doesn't re-propose an add every session.
    cooldownDays: 3,
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
    cooldownDays: 3,
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
 * On a watch a clock is chosen, never stamped: whoever creates the thesis
 * decides how often to look at it, or that nobody should, by including a
 * review-clock trigger or leaving it out. A position we own is reviewed on
 * its horizon's schedule by default (defaultTriggersForHorizon).
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
    cooldownDays: days,
  };
}

/** Days between reviews by horizon. Was HORIZON_REVIEW_DAYS. */
export const CADENCE_DAYS_BY_HORIZON: Record<Horizon, number> = {
  CATALYST: 1,
  TRADE: 1,
  TARGET: 7,
  COMPOUNDER: 30,
};

/**
 * When this thesis is next due, given when it was last actually looked at.
 *
 * This is the ONE place the review date comes from. The cached column this
 * used to feed is gone (DAV-221): it froze once when its writers were
 * deleted (DAV-195 L7) and every thesis past its last written date read as
 * overdue forever. A value derived at read time cannot freeze.
 *
 * Cadence comes from the thesis's own review trigger when it has one, and
 * from its horizon otherwise — which is exactly what the account rule would
 * hand it, so an inheriting thesis gets the same answer without resolving
 * the whole cascade on the hottest write path in the app.
 */
export function nextReviewFrom(
  lastReviewedAt: Date,
  triggers: Array<{ predicate: When }> | null | undefined,
  horizon: Horizon | null,
): Date {
  const own = resolvedCadenceDays(triggers ?? []);
  const days = own ?? CADENCE_DAYS_BY_HORIZON[horizon ?? "TARGET"];
  return new Date(lastReviewedAt.getTime() + days * 86_400_000);
}

/**
 * The review date every reporting surface shows, derived at read time.
 *
 * Null when there is no scheduled review: terminal rows, and WATCHING rows
 * with no clock of their own (DAV-209 — a watched name is reviewed iff it
 * carries a clock; inventing one from the horizon would display a review
 * that will never fire). Everything else falls through to `nextReviewFrom`, whose
 * horizon fallback matches what a held row inherits from the account rule
 * even when the caller only has the thesis's own trigger list.
 */
export function derivedNextReviewAt(thesis: {
  status: string | null;
  lastReviewedAt: Date | null;
  createdAt: Date;
  /** Trigger list — resolved ladder where the caller has one, else the raw column. */
  triggers: unknown;
  horizon: string | null;
}): Date | null {
  if (thesis.status === "RETIRED" || thesis.status === "PASSED") return null;
  const triggers = Array.isArray(thesis.triggers)
    ? (thesis.triggers as Array<{ predicate: When }>)
    : [];
  if (thesis.status === "WATCHING" && resolvedCadenceDays(triggers) == null) {
    return null;
  }
  return nextReviewFrom(
    thesis.lastReviewedAt ?? thesis.createdAt,
    triggers,
    (thesis.horizon ?? null) as Horizon | null,
  );
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

// ── Public API ─────────────────────────────────────────────────────────

/**
 * What code writes on a thesis by its horizon: a held stock's review clock
 * (a CATALYST or TRADE daily, a TARGET weekly, a COMPOUNDER monthly), source
 * DEFAULT. A stock we watch, or a promoted one, gets nothing: its triggers are
 * the ones its analyst wrote. No buy, floor or target is ever stamped here.
 */
export function defaultTriggersForHorizon(horizon: Horizon, state: ThesisState = "HELD"): Trigger[] {
  if (state !== "HELD") return [];
  return [{ ...reviewCadenceTrigger(CADENCE_DAYS_BY_HORIZON[horizon]), source: "DEFAULT" as const }];
}

/** Every note the code in this file writes. Older rows carry them with no source, so note.ts matches the words. */
export function templateNotes(): string[] {
  return [...accountStandingRules(), scaleInOnPullbackTrigger(), reviewCadenceTrigger(1), reviewCadenceTrigger(2)].map((t) => t.rationale ?? "");
}

// ── Cooldown defaults ──────────────────────────────────────────────────
//
// Triggers without a `cooldownDays` value used to fire forever — the
// `shouldFire` gate only enforces cooldown when both `cooldownDays` and
// `lastFiredAt` are set, so an unset cooldown silently disabled rate
// limiting. Observed in production: agent-supplied earnings-beat trigger
// on AMZN with no cooldown fired 10 tactical runs over 12.5 hours on a
// single earnings signal that the router (correctly) re-evaluated each
// time a new intel batch landed.
//
// We now apply a sane per-predicate-kind default at write time in
// record_thesis / update_thesis. The values mirror the conventions
// already baked into the horizon templates above (EARNINGS_*: 7,
// price and chart kinds: 1, etc.) so behavior of a default-minted trigger doesn't
// change — these only kick in when an agent-supplied trigger is
// missing the field.

/**
 * Default cooldown (days) for a predicate when the agent didn't specify
 * one. Mirrors the conventions in the horizon templates: earnings-class
 * predicates rate-limit at the quarterly cycle (7d caps the
 * "earnings-beat aftershocks" window); filings/news/price predicates
 * rate-limit at 1 day so they don't fan out on every quote tick or
 * intel batch; a review cadence rate-limits at its own interval.
 */
export function defaultCooldownDaysForPredicate(
  p: When,
  action?: Trigger["action"],
): number {
  // Each measure carries its own default (./condition/measures): no cooldown
  // on a filing (one fire per filing), 7 on a beat/miss, 30 on a report
  // window or an insider cluster, a day on price and chart lines, a week on a
  // state a review asks about (DAV-329), a week on a gain milestone (it
  // latches), one fire per gap, and a schedule's own interval.
  const w = shapeOf(p);
  return w == null ? 1 : defaultCooldownDays(w, action ?? "");
}

/**
 * Fill in `cooldownDays` on every trigger in the array that doesn't
 * already have one. Pure; returns a fresh array. Call this in the write
 * path (record_thesis / update_thesis) before persistence so disk state
 * always has cooldown bookkeeping.
 *
 * `cooldownDays: 0` is not a wait, on any action. A sticky condition (a
 * price level, vs-average, RSI, the review clock, AND/OR composites of
 * the same) stays true once true, and a 5-min check re-fires it every
 * pass until something intervenes. Treat `0` as "needs default" and
 * overwrite with the per-predicate cooldown; `effectiveCooldownDays` then
 * floors a trade at a day.
 *
 * Background: 2026-06-02 NVDA tactical runaway — agent-supplied
 * `update_thesis` triggers stamped `cooldownDays: 0` on a review
 * 14d REVIEW, the old `!= null` check walked past it, and the loop
 * fired 15 times in 70 min before manual hotfix. Until 2026-11-02 an
 * EXIT at 0 was allowed, on the theory that a waiting sale drops the
 * repeats; a run that holds leaves nothing waiting, and CEG's sale woke
 * a run at 9:30, 9:35 and 9:40.
 */
/**
 * The cooldown a rung actually fires on — the one number `shouldFire` uses.
 *
 * Three layers:
 *   1. What is written on the rung.
 *   2. The per-predicate default, when nothing is written, or when a 0 is
 *      written (a 0 means "nag every five minutes").
 *   3. A FLOOR: a week on a review of a state, a day on any trade.
 *
 * Layer 3 is the DAV-329 fix and it has to be a floor, not a default:
 * #719 set the default for vs-average to 7 and it changed nothing, because
 * the Secular Compounder's "below the 200-day → review" rule carries an
 * explicit `cooldownDays: 1`, and a written 1 beats any default. ABT sat
 * under its 200-day from 09-15 to 09-25 and that rule fired all nine
 * trading days. Without the floor the only fix is deleting and re-adding
 * the rule by hand.
 *
 * Only a REVIEW is floored. A BUY on one of these reads the price, so it
 * fires on the crossing already; a week's cooldown there wouldn't quiet a
 * nag, it would swallow the second crossing, and GD, GEV and SYK all buy
 * on "back above the 50-day". A SALE — EXIT or TRIM — keeps DAV-229's
 * standing-order semantics untouched: a protective rung asks every day its
 * condition holds, and a decline means "did nothing today". Slowing one
 * down to weekly would turn a declined sell into a silent one.
 */
export function effectiveCooldownDays(trigger: Trigger): number {
  // A wait of zero is not a wait: it reads as unset, and the floor below keeps a trade to once a day.
  const isInvalidZero = trigger.cooldownDays === 0;
  const written =
    trigger.cooldownDays != null && !isInvalidZero
      ? trigger.cooldownDays
      : defaultCooldownDaysForPredicate(trigger.predicate, trigger.action);

  return flooredCooldownDays(trigger, written);
}

/** Also writes each trigger's fire mode down: the one it names, else its action's default (./fire-mode). */
export function applyTriggerDefaults(triggers: Trigger[]): Trigger[] {
  return triggers.map((t) => {
    const needsDefault = t.cooldownDays == null || t.cooldownDays === 0;
    return withFireMode(needsDefault ? { ...t, cooldownDays: defaultCooldownDaysForPredicate(t.predicate, t.action) } : t);
  });
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
