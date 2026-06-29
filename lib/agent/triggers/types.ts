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
 *   - action:    what to do when it fires (REVIEW / EXIT / ADD / TRIM /
 *                MOVE_STOP) — the agent executes this in tactical mode
 *   - rationale: prose for the LLM to read when it acts
 *
 * The predicate union is intentionally narrow at v1. Add cases as needed,
 * but every new predicate kind needs a deterministic evaluator in
 * lib/agent/triggers/evaluate.ts (PR 2). Don't add predicates that require
 * a model call to evaluate.
 */

// ── Signal-side enums (mirrors of Signal table columns the router has) ──

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

// ── Predicate kinds ────────────────────────────────────────────────────

/**
 * The discriminated-union shape every trigger predicate takes. Stored on
 * Thesis.triggers as JSONB; validated by Zod when written via
 * record_thesis / update_thesis. Evaluated by lib/agent/triggers/evaluate
 * when a signal arrives or a periodic price-check fires.
 */
export type TriggerPredicate =
  // ── Price-based — periodic worker against latest quote ────────────────
  | { kind: "PRICE_ABOVE"; level: number }
  | { kind: "PRICE_BELOW"; level: number }
  // Trailing stop — EXIT when price falls `trailPct`% from the running peak
  // (LONG) / rises `trailPct`% from the trough (SHORT). A first-class trigger
  // like every other predicate: the trigger-evaluator evaluates it against the
  // paired Position's peakPrice (the price-monitor maintains that high-water
  // mark for every open position) and fires `app/thesis.trigger.fired` →
  // tactical run → close proposal → the normal approve/reject flow. HELD-only
  // (a trail needs an open position + a peak; no peak ⇒ never fires).
  | { kind: "TRAILING_STOP"; trailPct: number }
  | {
      kind: "PRICE_MOVE_PCT";
      pct: number;
      direction: "UP" | "DOWN";
      window: "1D" | "5D" | "30D";
    }
  | {
      kind: "VS_SMA";
      period: 50 | 200;
      direction: "ABOVE" | "BELOW";
    }
  | {
      kind: "RSI";
      threshold: number;
      direction: "ABOVE" | "BELOW";
    }

  // ── Signal-based — router on every new signal for this ticker ─────────
  | {
      kind: "SIGNAL_TYPE";
      signalType: SignalType;
      sentiment?: Sentiment;
      minUrgency?: Urgency;
    }
  | { kind: "EARNINGS_BEAT"; minSurprisePct?: number }
  | { kind: "EARNINGS_MISS"; minSurprisePct?: number }
  | { kind: "GUIDANCE_CHANGE"; direction: "UP" | "DOWN" }
  | {
      kind: "FILING";
      formType: "10-K" | "10-Q" | "8-K" | "FORM_4";
    }

  // ── Time-based — housekeeping or periodic worker ──────────────────────
  | { kind: "TIME_ELAPSED"; days: number }
  | { kind: "REVIEW_DATE_HIT" }

  // ── Composition ───────────────────────────────────────────────────────
  | { kind: "AND"; predicates: TriggerPredicate[] }
  | { kind: "OR"; predicates: TriggerPredicate[] };

/**
 * What to do when a trigger fires. The tactical agent reads this to decide
 * which tool path to take. Note: the agent CAN override (e.g. trigger said
 * EXIT but agent decides the move was overdone and chooses TRIM instead) —
 * the action is the default, not a hard rule.
 *
 * Action by thesis state:
 *   HELD positions    — EXIT, TRIM, ADD, MOVE_STOP, REVIEW
 *   WATCHING theses   — ENTER, REVIEW
 *
 * ENTER fires when a watchlist entry condition is met (e.g. price breaks
 * above a target/breakout level). The tactical agent's typical response
 * is to consider INITIATE; ENTER is the trigger-side counterpart to the
 * decision-side INITIATE/ADD verbs. Without ENTER, watching theses can
 * only carry REVIEW triggers, which is too vague — REVIEW IF earnings
 * beat is housekeeping; ENTER IF price > $268 is the actionable signal.
 */
export type TriggerAction = "REVIEW" | "EXIT" | "ENTER" | "ADD" | "TRIM" | "MOVE_STOP";

export type Trigger = {
  /** Stable cuid — same id across thesis updates so cooldown can be tracked. */
  id: string;
  predicate: TriggerPredicate;
  action: TriggerAction;
  /** Prose the LLM reads when acting. "Guidance cut means the multiple compresses → exit." */
  rationale: string;
  /** Don't re-fire same trigger more than once per N days. Optional, default no cooldown. */
  cooldownDays?: number;
  /** Set by the trigger evaluator; read for cooldown gating. */
  lastFiredAt?: string; // ISO timestamp
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
};

/**
 * What gets stored on Thesis.triggers. Always an array; empty array is the
 * default for theses created before triggers were a thing.
 */
export type ThesisTriggers = Trigger[];

/**
 * Predicate kinds whose EXIT is deterministic enough to close DIRECT (no
 * agent): the absolute price levels + the trailing stop. Everything else
 * (earnings, signals, RSI, time, composites) needs judgment, so a DIRECT
 * fire mode is refused on them — they always wake a tactical run.
 *
 * Single source for the gate, shared by the UI control, the
 * applyTriggerFireModeChange backend, and the tactical-run short-circuit.
 * Takes a plain string so the client-side (loosely-typed) trigger shape can
 * call it without a cast.
 */
export const DIRECT_ELIGIBLE_PREDICATE_KINDS: readonly string[] = [
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "TRAILING_STOP",
  "PRICE_MOVE_PCT",
];

export function isDirectEligiblePredicate(kind: string): boolean {
  return DIRECT_ELIGIBLE_PREDICATE_KINDS.includes(kind);
}
