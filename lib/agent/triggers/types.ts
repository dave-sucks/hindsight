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

/** "intraday" (default): the live quote. "close": the day's close, read once at 16:20 ET. */
export type PriceBasis = "intraday" | "close";
export type MoveWindow = "1D" | "5D" | "20D";
export type SmaPeriod = 20 | 50 | 150 | 200;

/**
 * The discriminated-union shape every trigger predicate takes. Stored on
 * Thesis.triggers as JSONB; validated by Zod when written via
 * record_thesis / update_thesis. Evaluated by lib/agent/triggers/evaluate
 * when a signal arrives or a periodic price-check fires.
 */
export type TriggerPredicate =
  // ── Price-based — periodic worker against latest quote ────────────────
  // `basis: "close"` means "the day CLOSES past the level": the 5-minute
  // passes skip it and one pass at 16:20 ET evaluates it against the day's
  // close (DAV-247). An intraday poke through a breakout level fails about
  // half the time (TRADING_PLAYBOOK.md D1); a close is the confirmation.
  // Absent = intraday, the behaviour every rung before DAV-247 had.
  | { kind: "PRICE_ABOVE"; level: number; basis?: PriceBasis }
  | { kind: "PRICE_BELOW"; level: number; basis?: PriceBasis }
  // The move over a window. 1D reads the quote's own change vs the prior
  // close. 5D and 20D read the close N sessions back off the daily
  // indicator snapshot (TickerIndicators) — the windows removed 2026-08-25
  // because nothing supplied a close series are back now that something
  // does.
  | { kind: "PRICE_MOVE_PCT"; pct: number; direction: "UP" | "DOWN"; window: MoveWindow }
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

  // ── Chart-based — the live quote against the daily indicator snapshot ──
  // Every kind below reads lib/market-data/price-structure.ts numbers the
  // 06:30 ET job stores in TickerIndicators (completed sessions through
  // yesterday). No snapshot for the ticker → false: a missed trigger,
  // never a crash. docs/plans/AGENT_REBUILD.md §3.
  //
  // Price above / below a moving average. Until DAV-247 nothing ever
  // supplied the average, so this was false for its entire existence
  // (GD and SYK carried buy rungs that could not fire).
  | { kind: "VS_SMA"; period: SmaPeriod; direction: "ABOVE" | "BELOW" }
  // Within withinPct% of a moving average, either side — the pullback arm.
  | { kind: "NEAR_SMA"; period: SmaPeriod; withinPct: number }
  // Today's volume so far ÷ the 20-session average. No projection: a
  // morning can't look heavy until it is, so intraday this only turns true
  // once the real volume is there. Read at the close it is the day's ratio.
  | { kind: "VOLUME_RATIO"; min: number }
  // Price above the highest high of the prior 20 sessions / 52 weeks.
  | { kind: "NEW_HIGH"; window: "20D" | "52W" }
  // Price within max% of the 52-week high.
  | { kind: "PCT_FROM_52W_HIGH"; max: number }
  // Return over the window minus SPY's, in percentage points, as of the
  // last close (daily resolution).
  | { kind: "RS_VS_SPY"; window: "1M" | "3M" | "6M"; min: number }
  // Opened ≥ minPct% over the prior close on ≥ minVolRatio× average volume,
  // today or within the last withinDays sessions (default 1 = today).
  | { kind: "GAP_UP"; minPct: number; minVolRatio: number; withinDays?: number }
  // RSI over the snapshot's closes with the live price as today's close.
  // period defaults to 14; RSI(2) is the mean-reversion read (D6).
  | {
      kind: "RSI";
      period?: 2 | 14;
      threshold: number;
      direction: "ABOVE" | "BELOW";
    }

  // ── Calendar-based ────────────────────────────────────────────────────
  // EARNINGS_BEAT / EARNINGS_MISS are NOT signal-dependent any more. They
  // evaluate on the price cron off the published earnings calendar —
  // reported EPS against estimate, arithmetic, no router (see
  // lib/agent/triggers/earnings.ts). They spent months inert waiting on a
  // producer to stamp a surprise figure onto a Signal that never came. The
  // signal branch in evaluate.ts is kept as a fallback for a restored
  // router; it is not what fires them today.
  | { kind: "EARNINGS_BEAT"; minSurprisePct?: number }
  | { kind: "EARNINGS_MISS"; minSurprisePct?: number }
  // "This stock reports within N days." The heads-up BEFORE a report, read
  // off the same calendar call as beat/miss. A holding about to report is a
  // sizing question — trim, hold through, or don't add until after — and
  // nothing else in the ladder asks it. Fires once per approaching report
  // (30-day default cooldown ≫ the window, ≪ a quarter). Added 2026-09-10;
  // see docs/plans/MARKET_DATA.md §3.
  | { kind: "EARNINGS_WITHIN"; days: number }
  // "This stock reported between min and max days ago." The mirror of
  // EARNINGS_WITHIN, off the same calendar: the post-report window where a
  // drift trade is entered — day 1 to 3 after the print, once the reaction
  // is known. Fires once per report (30-day cooldown). Bounded above by
  // the evaluator's lookback (EARNINGS_LOOKBACK_DAYS).
  | { kind: "EARNINGS_SINCE"; min: number; max: number }

  // ── Time-based — housekeeping or periodic worker ──────────────────────
  // "Look at this again every N days", counted from when it was last
  // ACTUALLY reviewed (Thesis.lastReviewedAt). Replaced REVIEW_DATE_HIT on
  // 2026-08-25, which read a date column the agent set by hand — two stores
  // of one idea, and the column was the one nothing fired on.
  //
  // Cascades like every other trigger: the account says every 7 days, an
  // analyst can say every day, one thesis can say every 3. That is the whole
  // review system; there is no separate review-date concept any more.
  //
  // A DECLINE IS NOT A REVIEW. Declining a sell proposal leaves the market
  // condition true, so that fires again — standing order, unchanged. This is
  // a clock about US, and the daily run looking at the thesis satisfies it
  // even if it concludes nothing changed. If the run skips it or crashes,
  // nothing is stamped and it stays due.
  | { kind: "REVIEW_CADENCE"; days: number }

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
   * ENTER only: fire on the first check where the condition is true, even
   * if it was already true at the prior close. An ENTER otherwise fires on
   * the CROSSING of its level (DAV-229), so a buy-now plan — a level the
   * price is already past — would never fire on a flat or down day. After
   * the first fire the rung behaves like any other ENTER (crossing +
   * cooldown). Written by the buy-now path (PR 4); ignored on every other
   * action. DAV-247.
   */
  fireOnMatch?: boolean;
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
