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
import { protectiveCloseReason, risesWith } from "./condition/rules";
import type { When } from "./condition/types";
import type { FireMode } from "./fire-mode";

/**
 * What to do when a trigger fires. The tactical agent reads this to decide
 * which tool path to take. Note: the agent CAN override (e.g. trigger said
 * EXIT but agent decides the move was overdone and chooses TRIM instead) —
 * the action is the default, not a hard rule.
 *
 * Action by thesis state:
 *   HELD positions    — EXIT, TRIM, ADD, REVIEW
 *   WATCHING theses   — ENTER, STOP_WATCHING, REVIEW
 *
 * EXIT ("Sell if") exists only on a stock we hold; STOP_WATCHING ("Stop
 * watching if") only on one we don't. Each is its own stored action, so a
 * trigger means what it says whatever the stock's state (./condition/actions).
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
  | "STOP_WATCHING";

export type Trigger = {
  /** Stable cuid — same id across thesis updates so its fire history can be tracked. */
  id: string;
  /** The condition (./condition): stored and read in this shape since the cutover. */
  predicate: When;
  action: TriggerAction;
  /** The trigger's note: the owner reads it, and so does the agent acting on a fire. "A guidance cut means the multiple compresses, so I sell." */
  rationale: string;
  /** When it last fired. Set by the trigger evaluator; cleared when its condition or action is changed. */
  lastFiredAt?: string; // ISO timestamp
  /**
   * When a market close (the 16:20 ET pass) last found its condition false
   * after it fired. A trigger fires when it becomes true, and once fired it
   * fires again only after a close like this (./evaluate). Evaluator-stamped.
   */
  falseAtCloseAt?: string; // ISO timestamp
  /** filing only, evaluator-stamped: the filing IDs this trigger has fired on. */
  firedFilings?: string[];
  /**
   * before-earnings only, evaluator-stamped: the report dates this heads-up
   * has already fired for. A heads-up is once per REPORT: it doesn't hold for
   * a report it fired for, and one for a new date fires (DAV-293: a wrong
   * calendar date fired the heads-up on 09-21, and the real 09-29 must still fire).
   */
  firedReports?: string[];
  /** On fire: DO_IT, ASK_NOW or NEXT_MORNING (./fire-mode). Every stored trigger names one. */
  fireMode?: FireMode;
  /** TRIM only: the % of the position a trim set to DO_IT sells (default 50). */
  trimPct?: number;
  /**
   * Who authored this rung's VALUE. Informational only — it does NOT
   * determine the rung's level (see TriggerLevel in ./levels). Level comes
   * from which record the rung is stored on; `source` answers the softer
   * question the popover asks: "where did this number come from?"
   *
   *   DEFAULT   — written from a template: the account seed (./defaults) or a playbook's (Settings → Playbook)
   *   AGENT     — authored by the writer / daily / tactical agent
   *   PRINCIPAL — added or edited through the UI
   *
   * Absent on every rung written before 2026-08-05; renders unlabeled.
   * Never fabricate a value for a legacy rung — absent is honest, a guess
   * is not.
   */
  source?: "DEFAULT" | "AGENT" | "PRINCIPAL";
  /**
   * Written from one of the stock's playbook's lists (Settings → Playbook):
   * its watch triggers (the Writer), the triggers that come with the buy (the
   * proposal), or the triggers written at the fill. At the fill the WATCH
   * ones come off with the buy and Stop watching triggers; a trigger without
   * it was written by hand and stays.
   */
  playbook?: "WATCH" | "PROPOSAL" | "FILL";
};

/**
 * The STOP/TARGET close reason a protective/price EXIT carries — the single
 * source of truth for "what tag does a price-level protective exit close
 * with." Null for a judgment exit (earnings, filings, RSI, time, composites)
 * the agent tags itself.
 *
 * Why this exists: a price-level protective exit (trail-from-high give-back,
 * gain-from-entry lock, absolute stop/target, daily-% move) is a MATERIAL
 * risk event, not a discretionary re-pitch, and the label decides what
 * follows: a declined STOP is a declined sale the next run must answer (lib/agent/declined-sale.ts), and a TARGET sale sends the stock back to watching (lib/proposals/thesis-flips.ts).
 * Both close paths use this mapping so the tag never depends on the LLM
 * remembering to pick STOP:
 *   • an Auto-sell → directExitReason() (tactical-run.ts) delegates here.
 *   • a sale that asks the analyst → precomputed here and threaded into the
 *     tool context (ToolContext.protectiveExitReason).
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
 * The label an Auto-sell closes with: its condition's own protective label, else TARGET when the condition is a
 * rise with the position (a profit-take goes back on watch), else STOP.
 */
export function autoSellCloseReason(predicate: unknown, direction: string | null): "STOP" | "TARGET" {
  const w = shapeOf(predicate);
  if (w == null) return "STOP";
  const rise = risesWith(w);
  return protectiveCloseReason(w, direction) ?? (rise != null && rise === (direction !== "SHORT") ? "TARGET" : "STOP");
}
