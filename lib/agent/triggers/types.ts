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
  // The daily move — "the stock is up/down X% today", off the quote's own
  // change vs prior close. 5D and 30D windows were removed 2026-08-25: they
  // needed a close series the 5-minute evaluator never had, so they silently
  // evaluated false for their entire existence. Four theses carried one. A
  // predicate that cannot fire is worse than no predicate, because the ladder
  // says it is covered. Multi-day moves belong on the daily run, which reads
  // the numbers directly off the row.
  | { kind: "PRICE_MOVE_PCT"; pct: number; direction: "UP" | "DOWN"; window: "1D" }
  // Cumulative % vs the open position's avgCost (LONG: (price−avg)/avg;
  // SHORT inverted). UP = gain milestone ("we're up 10%" → checkpoint
  // re-underwrite); DOWN = drawdown-from-entry ("down 12%" → loser
  // attention). HOLDING-only: no open position in context → false.
  // Complements PRICE_MOVE_PCT, which only sees the single-day move —
  // this is what catches the quiet cumulative winner/bleeder (the IONS
  // +17%-then-loss failure; see docs/plans/THESIS_GAME_PLAN.md).
  | { kind: "GAIN_FROM_ENTRY"; pct: number; direction: "UP" | "DOWN" }
  // Give-back % off the position's tracked peak (Position.peakPrice —
  // high-water for LONG, low-water for SHORT, maintained by the price
  // monitor). The mechanical gain ratchet: the floor follows the high
  // with no agent memory required. Deliberately distinct from the
  // TRAILING_STOP removed in #458 (that removal traded peak-trailing for
  // daily-% moves; this reinstates cumulative protection ALONGSIDE the
  // daily-% predicate, not instead of it). HOLDING-only.
  | { kind: "TRAILING_FROM_HIGH"; pct: number }
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
export type TriggerAction =
  | "REVIEW"
  | "EXIT"
  | "ENTER"
  | "ADD"
  | "TRIM"
  | "MOVE_STOP"
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
  "PRICE_MOVE_PCT",
  "GAIN_FROM_ENTRY",
  "TRAILING_FROM_HIGH",
];

export function isDirectEligiblePredicate(kind: string): boolean {
  return DIRECT_ELIGIBLE_PREDICATE_KINDS.includes(kind);
}

/**
 * Map a protective/price EXIT predicate to the STOP/TARGET close reason it
 * should carry — the single source of truth for "what tag does a
 * price-level protective exit close with." Returns null for any predicate
 * that isn't a deterministic price/gain protective kind (earnings, signals,
 * RSI, time, composites) — those are judgment exits the agent tags itself.
 *
 * Why this exists: a price-level protective exit (trail-from-high give-back,
 * gain-from-entry lock, absolute stop/target, daily-% move) is a MATERIAL
 * risk event, not a discretionary re-pitch. The P1-28 unapproved-exit
 * cooldown (lib/proposals/maybe-await-approval.ts) exempts closes tagged
 * STOP/TARGET so a rejected protective exit still re-fires when price
 * re-crosses the level — exactly the re-alert the principal asked for. Both
 * close paths use this mapping so the tag is deterministic and never depends
 * on the LLM remembering to pick STOP:
 *   • DIRECT fire  → directExitReason() (tactical-run.ts) delegates here.
 *   • agent (TACTICAL) fire → the reason is precomputed here and threaded
 *     into the tool context (ToolContext.protectiveExitReason); close_position
 *     uses it in place of the model-chosen reason.
 *
 * STOP vs TARGET: adverse-direction move → STOP; favorable-direction → TARGET.
 * Both are cooldown-exempt; the split only affects the audit label. Trail /
 * gain-lock exits are protective give-backs → STOP.
 */
export function protectiveExitCloseReason(
  predicate: TriggerPredicate,
  direction: string | null,
): "STOP" | "TARGET" | null {
  if (!isDirectEligiblePredicate(predicate.kind)) return null;
  const isLong = direction !== "SHORT";
  switch (predicate.kind) {
    case "PRICE_BELOW":
      return isLong ? "STOP" : "TARGET";
    case "PRICE_ABOVE":
      return isLong ? "TARGET" : "STOP";
    case "PRICE_MOVE_PCT": {
      // Favorable (TARGET) when the move is WITH the position — LONG on an
      // up day, SHORT on a down day — adverse (STOP) otherwise.
      const up = predicate.direction === "UP";
      const favorable = isLong ? up : !up;
      return favorable ? "TARGET" : "STOP";
    }
    // GAIN_FROM_ENTRY (gain-lock) and TRAILING_FROM_HIGH (give-back) are
    // protective ratchets — treat as STOP so the gain is protected as a
    // material risk exit.
    case "GAIN_FROM_ENTRY":
    case "TRAILING_FROM_HIGH":
      return "STOP";
    default:
      return "STOP";
  }
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
  trigger: { action: TriggerAction; predicate: TriggerPredicate },
  state: { status?: string | null; direction?: string | null },
): TriggerAction {
  if (state.status === "HOLDING") return trigger.action;

  const kind = trigger.predicate.kind;
  const isPriceLevel = kind === "PRICE_ABOVE" || kind === "PRICE_BELOW";

  // A sell on something we don't own can only mean the plan is wrong. This
  // covers judgment exits (earnings, signals) too — on an un-held thesis
  // those say the same thing.
  if (trigger.action === "EXIT") return "DEMOTE";

  // An upside price level reached before we bought: the move happened
  // without us, so the priced plan is stale. Housekeeping REVIEWs (earnings,
  // review cadence, news) are untouched — they still just want a look.
  if (trigger.action === "REVIEW" && isPriceLevel) {
    const isLong = state.direction !== "SHORT";
    const favourable = isLong ? kind === "PRICE_ABOVE" : kind === "PRICE_BELOW";
    if (favourable) return "DEMOTE";
  }

  return trigger.action;
}
