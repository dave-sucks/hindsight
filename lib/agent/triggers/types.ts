/**
 * Thesis trigger types — the durable, machine-evaluable predicates that
 * connect signals to thesis re-evaluation.
 *
 * The router evaluates these deterministically on every new signal; no LLM
 * call to decide whether a trigger fired. The LLM only runs *after* a
 * trigger fires — to decide what to do about it (act, override, pass).
 *
 * Why structured predicates and not free text:
 *   - Cost: LLM-evaluated triggers don't scale. With M open theses and
 *     N signals/day we'd burn (M × N) calls just to decide if anything
 *     matched. Predicate matching is pure compute.
 *   - Determinism: a trigger that "kind of fired" is worse than one that
 *     fires exactly when the predicate evaluates true.
 *   - Testability: predicates can be unit-tested; "guidance cut" cannot.
 *
 * Each trigger has three parts:
 *   - predicate: what to check (this file)
 *   - action:    what to do when it fires (REVIEW / EXIT / ADD / TRIM) —
 *                the agent executes this in tactical mode
 *   - rationale: prose for the LLM to read when it acts
 *
 * The predicate union is intentionally narrow at v1. Add cases as needed,
 * but every new predicate kind needs a deterministic evaluator in
 * lib/agent/triggers/evaluate.ts (PR 2). Don't add predicates that require
 * a model call to evaluate.
 */

// ── Signal-side enums (mirrors of Signal table columns the router has) ──

import { shapeOf } from "./condition/valid";
import { isDirectEligible, isLevel, onTheClose, protectiveCloseReason } from "./condition/rules";
import type { Condition, When } from "./condition/types";

export type SignalType =
  | "NEWS"
  | "EARNINGS"
  | "FILING"
  | "SOCIAL"
  | "PRICE_ACTION"
  | "ANALYST_NOTE"
  | "OPTIONS"
  | "MACRO"
  | "SECTOR";

export type Sentiment = "BULLISH" | "BEARISH" | "NEUTRAL";

export type Urgency = "LOW" | "MEDIUM" | "HIGH" | "BREAKING";

/**
 * What to do when a trigger fires. The tactical agent reads this to decide
 * which tool path to take. Note: the agent CAN override (e.g. trigger said
 * EXIT but agent decides the move was overdone and chooses TRIM instead) —
 * the action is the default, not a hard rule.
 *
 * Action by thesis state:
 *   HELD positions    — EXIT, TRIM, ADD, REVIEW
 *   WATCHING theses   — ENTER, REVIEW
 *
 * ENTER fires when a watchlist entry condition is met (e.g. price breaks
 * above a target/breakout level). The tactical agent's typical response
 * is to consider INITIATE; ENTER is the trigger-side counterpart to the
 * decision-side INITIATE/ADD verbs. Without ENTER, watching theses can
 * only carry REVIEW triggers, which is too vague — REVIEW IF earnings
 * beat is housekeeping; ENTER IF price > $268 is the actionable signal.
 */
export type TriggerAction =
  | "REVIEW"
  | "EXIT"
  | "ENTER"
  | "ADD"
  | "TRIM"
  /**
   * Set the plan down: drop the buy / floor / target levels, keep watching.
   *
   * Never authored — it is CHOSEN AT FIRE TIME by `effectiveTriggerAction`
   * when a price level fires on a thesis we don't own. Storing it on the
   * trigger would mean every status change (buy, promote, opt-out) had to
   * rewrite trigger actions to stay correct, and the first path that forgot
   * would leave a "sell" armed on a watch item or a "demote" armed on a
   * live position.
   *
   * See docs/plans/LEVELS_AS_TRIGGERS.md (L5). DAV-209 calls the same write
   * for the on-demand version.
   */
  | "DEMOTE";

export type Trigger = {
  /** Stable cuid — same id across thesis updates so cooldown can be tracked. */
  id: string;
  /** The condition (./condition): stored and read in this shape since the cutover. */
  predicate: When;
  action: TriggerAction;
  /** The trigger's note: the owner reads it, and so does the agent acting on a fire. "A guidance cut means the multiple compresses, so I sell." */
  rationale: string;
  /** Don't re-fire same trigger more than once per N days. Optional, default no cooldown. */
  cooldownDays?: number;
  /** Set by the trigger evaluator; read for cooldown gating. */
  lastFiredAt?: string; // ISO timestamp
  /** filing only, evaluator-stamped: the filing IDs this trigger has fired on. */
  firedFilings?: string[];
  /**
   * before-earnings only, evaluator-stamped: the report dates this heads-up
   * has already fired for. A heads-up is once per REPORT, and the cooldown
   * is what enforces that inside one window — so a fire for a different date
   * is never in cooldown (DAV-293: a wrong calendar date fired the heads-up
   * on 09-21 and the 7-day cooldown then swallowed the real one).
   */
  firedReports?: string[];
  /**
   * ENTER only: when a trigger run last passed on this buy because the price
   * was back under its level, and left it armed (./rearm, DAV-343). A re-arm
   * newer than `lastFiredAt` lifts the cooldown. Kept in
   * `Thesis.triggerState` and merged on at resolve time — never stored on
   * the trigger, never written by a model.
   */
  rearmedAt?: string;
  /** ENTER only, server-stamped: the live price when written (./written-price). */
  writtenPrice?: number;
  writtenAt?: string; // ISO timestamp
  /**
   * How a fired trigger is acted on:
   *   TACTICAL — fan out `app/thesis.trigger.fired` → a GPT-5.5 tactical run
   *              evaluates and decides. The default; every trigger written
   *              before this field behaved this way.
   *   DIRECT   — skip the agent: a deterministic EXIT closes the paired
   *              position directly via `closeOpenPosition` (no tactical-run
   *              cost). Still routed through the approval gate
   *              (`maybeAwaitApproval`) — DIRECT saves the *agent* cost, not
   *              the approval step. EXIT-only; on any other action it's
   *              ignored and treated as TACTICAL (a non-EXIT trigger has no
   *              deterministic action to execute without judgment).
   * Absent ⇒ TACTICAL.
   */
  fireMode?: "TACTICAL" | "DIRECT";
  /**
   * Who authored this rung's VALUE. Informational only — it does NOT
   * determine the rung's level (see TriggerLevel in ./levels). Level comes
   * from which record the rung is stored on; `source` answers the softer
   * question the popover asks: "where did this number come from?"
   *
   *   DEFAULT   — minted by a code template in ./defaults
   *   AGENT     — authored by the writer / daily / tactical agent
   *   PRINCIPAL — added or edited through the UI
   *
   * Absent on every rung written before 2026-08-05; renders unlabeled.
   * Never fabricate a value for a legacy rung — absent is honest, a guess
   * is not.
   */
  source?: "DEFAULT" | "AGENT" | "PRINCIPAL";
};

/**
 * What gets stored on Thesis.triggers. Always an array; empty array is the
 * default for theses created before triggers were a thing.
 */
export type ThesisTriggers = Trigger[];

/**
 * A sale deterministic enough to close DIRECT (no agent): a typed price, or a
 * % from a close, our entry or the high. Everything else (earnings, filings,
 * RSI, time, composites) needs judgment, so a DIRECT fire mode is refused on
 * it — it always wakes a tactical run. Each measure says which of its
 * conditions qualify (./condition/measures).
 *
 * Single source for the gate, shared by the trigger dialog's "On fire"
 * control, the write paths, and the tactical-run short-circuit.
 */
export function isDirectEligiblePredicate(predicate: unknown): boolean {
  const w = shapeOf(predicate);
  return w != null && isDirectEligible(w);
}

/**
 * The STOP/TARGET close reason a protective/price EXIT carries — the single
 * source of truth for "what tag does a price-level protective exit close
 * with." Null for a judgment exit (earnings, filings, RSI, time, composites)
 * the agent tags itself.
 *
 * Why this exists: a price-level protective exit (trail-from-high give-back,
 * gain-from-entry lock, absolute stop/target, daily-% move) is a MATERIAL
 * risk event, not a discretionary re-pitch. The P1-28 unapproved-exit
 * cooldown (lib/proposals/maybe-await-approval.ts) exempts closes tagged
 * STOP/TARGET so a rejected protective exit still re-fires when price
 * re-crosses the level. Both close paths use this mapping so the tag never
 * depends on the LLM remembering to pick STOP:
 *   • DIRECT fire  → directExitReason() (tactical-run.ts) delegates here.
 *   • agent (TACTICAL) fire → precomputed here and threaded into the tool
 *     context (ToolContext.protectiveExitReason).
 *
 * STOP vs TARGET: adverse move → STOP; favourable → TARGET; a give-back from
 * our entry or the high → STOP. Each measure says which (./condition/measures).
 */
export function protectiveExitCloseReason(
  predicate: unknown,
  direction: string | null,
): "STOP" | "TARGET" | null {
  const w = shapeOf(predicate);
  return w == null ? null : protectiveCloseReason(w, direction);
}

/**
 * What a trigger actually means for a thesis in this state.
 *
 * A price level is written once and outlives the thesis's state changes, so
 * the same level has to mean different things depending on whether we own the
 * stock:
 *
 *                       HOLDING            WATCHING / PROMOTED
 *   floor breached      EXIT (sell)        DEMOTE — the plan's premise broke
 *   target reached      REVIEW (decide)    DEMOTE — it happened without us
 *   buy level hit       (no buy armed)     ENTER
 *
 * Real cases: KLAC (buy $262, floor $225, price $184 — floor breached in
 * June and nothing happened) and NTNX (buy $47.12, target $60.87, price
 * $67.64 — sailed past the target, never bought). Both should have set the
 * plan down; neither could, because "sell" is meaningless with nothing to
 * sell and there was no other verb.
 *
 * Deriving this instead of storing it is what keeps a promotion or an opt-out
 * from having to rewrite the ladder. Pure.
 */
export function effectiveTriggerAction(
  trigger: { action: TriggerAction; predicate: unknown },
  state: {
    status?: string | null;
    direction?: string | null;
    /**
     * Does the stock carry a buy (an ENTER trigger)? With none, a review at
     * any price is a wake, not a target: it fires as a review (QB ruling on
     * DAV-335, 2026-09-29). Absent ⇒ treated as having one, as before.
     */
    hasBuy?: boolean;
  },
): TriggerAction {
  if (state.status === "HOLDING") return trigger.action;

  // A sell on something we don't own can only mean the plan is wrong. This
  // covers judgment exits (earnings, signals) too — on an un-held thesis
  // those say the same thing.
  if (trigger.action === "EXIT") return "DEMOTE";

  // An upside price level reached before we bought: the move happened
  // without us, so the priced plan is stale. Housekeeping REVIEWs (earnings,
  // review cadence, news) are untouched — they still just want a look. With
  // no buy there is no priced plan to go stale: the level is a wake.
  const w = shapeOf(trigger.predicate);
  if (trigger.action === "REVIEW" && w != null && isLevel(w) && state.hasBuy !== false) {
    const above = (w as Condition).is === "above";
    const favourable = state.direction !== "SHORT" ? above : !above;
    if (favourable) return "DEMOTE";
  }

  return trigger.action;
}

/**
 * When a trigger is read, for a thesis in this state (DAV-337).
 *
 * On a stock we don't own, a sell trigger sets the plan down (above), and a
 * plan comes down only on a close past its floor — never an intraday touch.
 * An undercut of a low that is reclaimed the same day is a shakeout, not a
 * breakdown: TRV opened at $359.51 on 2026-09-29, under its $359.87 floor,
 * traded back to $363.83 that morning, and its plan was gone at 09:30. In
 * the 30 days to that day, three of six floor set-downs were dips like it.
 *
 * So on a thesis we don't hold, a sell trigger's typed price levels read the
 * day's close (the 16:20 pass). On a stock we hold the floor is a sale and
 * keeps its own timing. Resolved where triggers are read, never stored, so a
 * buy never has to rewrite it. The five-minute check, the morning run's
 * snapshot and the thesis sheet all call this one function. Pure.
 */
export function watchedFloorOnClose<T extends { action: string; predicate: unknown }>(
  trigger: T,
  state: { status?: string | null },
): T {
  if (state.status === "HOLDING" || trigger.action !== "EXIT") return trigger;
  const w = shapeOf(trigger.predicate);
  if (w == null) return trigger;
  const closed = onTheClose(w);
  if (closed === w) return trigger;
  return { ...trigger, predicate: closed } as T;
}
