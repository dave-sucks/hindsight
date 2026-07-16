/**
 * Horizon-keyed default trigger templates.
 *
 * Every thesis carries a `triggers[]` array of structured predicates that
 * the router evaluates deterministically. Most of those are universal —
 * "stop hit", "earnings dropped", "8-K filed", "quarterly hygiene check"
 * — and the agent shouldn't have to remember to attach them to every
 * thesis it mints. This module supplies the baseline keyed off horizon.
 *
 * Usage:
 *   const merged = mergeTriggers(
 *     defaultTriggersForHorizon("COMPOUNDER", thesis),
 *     args.triggers ?? [],
 *   );
 *
 * Merge rule (kept simple for v1): defaults fill gaps. Agent-supplied
 * triggers take precedence on the same (predicate.kind, action) key.
 * That way the agent can override "PRICE_BELOW $stop → EXIT" with a
 * tighter level without producing two contradictory exits.
 *
 * IDs are auto-assigned via randomUUID() — stable for the life of the
 * trigger so cooldown stamps survive subsequent merges.
 */

// Web Crypto (global since Node 19 + all browsers) instead of node:crypto —
// keeps this module importable from client components (the trigger popover
// reads defaultCooldownDaysForPredicate for its cooldown explainer line).
const createId = () => globalThis.crypto.randomUUID();
import type { Trigger, TriggerPredicate, TriggerSource } from "./types";

export type Horizon = "CATALYST" | "TARGET" | "TRADE" | "COMPOUNDER";

/**
 * Thesis state at the time defaults are derived. Drives the template
 * selection — held positions get EXIT/REVIEW templates around the open
 * position; watching theses get ENTER/REVIEW templates around the
 * watchlist entry condition; PROMOTED theses get the WATCHING-style
 * ENTER + REVIEW set (no EXIT — there's no live position to exit since
 * the paper position was force-closed at promotion).
 *
 * Without this distinction, watchlist theses end up with EXIT triggers
 * on stop-loss that can never fire usefully — there's no position to
 * exit. The agent then has no entry trigger to push it from WATCHING
 * → INITIATE, and the watchlist becomes inert. PROMOTED has the
 * symmetric trap: inheriting HELD-template EXIT triggers spawns an
 * orphan tactical EXIT run whenever price crosses the old stop.
 */
export type ThesisState = "HELD" | "WATCHING" | "PROMOTED";

export type ThesisDirection = "LONG" | "SHORT" | "PASS";

export interface ThesisShape {
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  maxHoldDays?: number | null;
  catalystDate?: Date | null;
  /** Direction colors entry-trigger semantics for watching theses. */
  direction?: ThesisDirection | null;
}

// ── Builders for each horizon ──────────────────────────────────────────

/**
 * Reactive strength-press rung (docs/plans/SCALE_INTO_WINNERS.md PR2).
 *
 * A strong single-day up-move on a HELD position spawns a tactical run to
 * evaluate pressing the winner. `ADD` is a held-only action and resolves to
 * fireMode TACTICAL by default (the agent decides + confirms; it never
 * auto-fills), and it is approval-gated, so a fire produces an add *proposal*.
 * `PRICE_MOVE_PCT{window:"1D"}` is cron-evaluable (reads the daily change), so
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
    predicate: {
      kind: "PRICE_MOVE_PCT",
      pct: SCALE_IN_MOVE_PCT,
      direction: "UP",
      window: "1D",
    },
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
 * thesis damage (don't add — hold/trim/exit). ADD is held-only + TACTICAL +
 * approval-gated, so a fire is a proposal the agent only makes after that check.
 *
 * Omitted for TRADE horizon on purpose: short-horizon momentum trades exit on
 * weakness, they don't average into a dip. Strength-press applies to all
 * horizons; pullback-add is for the conviction holds (COMPOUNDER/TARGET/CATALYST).
 */
function scaleInOnPullbackTrigger(): Trigger {
  return {
    id: createId(),
    predicate: {
      kind: "PRICE_MOVE_PCT",
      pct: SCALE_IN_MOVE_PCT,
      direction: "DOWN",
      window: "1D",
    },
    action: "ADD",
    rationale: `Down ${SCALE_IN_MOVE_PCT}% in a day — evaluate a pullback-add ONLY if the drop is market/sector-wide with the thesis intact. A company-specific drop is thesis damage: do not add — hold, trim, or exit. Approval-gated.`,
    cooldownDays: 3,
  };
}

// ── Standing protection minimums (docs/plans/THESIS_GAME_PLAN.md PR-D; GAPS P1-31) ──
//
// Three always-on protection rungs every HELD thesis carries, so no holding
// can quietly run up (or bleed) without forcing a decision. The motivating
// failure is the IONS autopsy: bought $73.83, day-one floor at $65, ran +17%,
// three rubber-stamp reviews, then crashed and fired the day-one floor for a
// LOSS. No level was ever re-earned. These rungs make that impossible to do
// silently: the gain milestone forces a re-underwrite, the trail banks the
// gain mechanically, and the drawdown rung forces a hold-vs-cut decision
// before the hard stop decides for us.
//
// GAIN_FROM_ENTRY / TRAILING_FROM_HIGH are HOLDING-only predicates (no open
// position ⇒ evaluate false), so these are wired into the HELD templates
// only — never WATCHING / PROMOTED.
//
// The three constants are PRINCIPAL-TUNABLE: change the number here and
// every future mint picks it up. Existing theses keep the value they were
// minted with (editable per-thesis in the trigger popover).

/** Gain milestone: up X% from entry → checkpoint re-underwrite (REVIEW). */
const PROTECT_CHECKPOINT_GAIN_PCT = 10;
/** Mechanical ratchet: give back X% off the tracked high → banked EXIT. */
const PROTECT_TRAIL_PCT = 8;
/** Loser attention: down X% from entry → hold-vs-cut REVIEW. */
const LOSER_ATTENTION_DRAWDOWN_PCT = 12;

function gainCheckpointTrigger(): Trigger {
  return {
    id: createId(),
    predicate: {
      kind: "GAIN_FROM_ENTRY",
      pct: PROTECT_CHECKPOINT_GAIN_PCT,
      direction: "UP",
    },
    action: "REVIEW",
    rationale: `Up ${PROTECT_CHECKPOINT_GAIN_PCT}% from entry — gain milestone checkpoint. Re-underwrite at the new price: raise the floor to lock the gain in, and arm the next milestone.`,
    // cooldownDays intentionally unset — per-kind default (GAIN_FROM_ENTRY:
    // 7d). The milestone latches once hit; the acting agent is expected to
    // replace the fired rung with the next checkpoint, and 7d stops a
    // same-week re-fire if it doesn't.
  };
}

function trailingRatchetTrigger(): Trigger {
  return {
    id: createId(),
    predicate: { kind: "TRAILING_FROM_HIGH", pct: PROTECT_TRAIL_PCT },
    action: "EXIT",
    rationale: `Gave back ${PROTECT_TRAIL_PCT}% from the high — mechanical gain ratchet. Bank the gain instead of round-tripping it (the IONS lesson: +17% became a loss because no level was ever re-earned).`,
    cooldownDays: 0, // explicit opt-out — terminal EXIT, same convention as the hard stop.
  };
}

function loserAttentionTrigger(): Trigger {
  return {
    id: createId(),
    predicate: {
      kind: "GAIN_FROM_ENTRY",
      pct: LOSER_ATTENTION_DRAWDOWN_PCT,
      direction: "DOWN",
    },
    action: "REVIEW",
    rationale: `Down ${LOSER_ATTENTION_DRAWDOWN_PCT}% from entry — loser attention. Decide hold-vs-cut deliberately, before the hard stop decides for us.`,
    // cooldownDays intentionally unset — per-kind default (GAIN_FROM_ENTRY: 7d).
  };
}

/**
 * The three standing protection minimums, fresh ids per call. Pushed into
 * every HELD horizon template below; also exported for
 * scripts/convert-static-floors-to-trails.ts, which retrofits them onto the
 * 2026-07-09 hand-backfilled live ladders (the `bf79-*` trigger ids).
 *
 * mergeTriggers dedup: an agent-authored rung in the same
 * (predicateKey, action) bucket wins over these — predicateKey is
 * `GAIN_FROM_ENTRY:UP` / `GAIN_FROM_ENTRY:DOWN` / `TRAILING_FROM_HIGH`, so
 * an agent that writes its own +15% gain checkpoint REVIEW replaces the
 * +10% default rather than stacking a second one, while a custom
 * GAIN_FROM_ENTRY DOWN rung leaves the UP default intact.
 */
export function standingProtectionTriggers(): Trigger[] {
  return stampSource(
    [gainCheckpointTrigger(), trailingRatchetTrigger(), loserAttentionTrigger()],
    "DEFAULT",
  );
}

/**
 * Provenance stamp for template-built rungs (TRIGGER_MODEL.md §5 gap 2).
 * Applied at the two public exits of this module — standingProtectionTriggers
 * and defaultTriggersForHorizon — so every rung a code template mints carries
 * `source: "DEFAULT"` regardless of which internal builder produced it.
 * Idempotent: a rung that already carries a source keeps it.
 */
function stampSource(triggers: Trigger[], source: TriggerSource): Trigger[] {
  return triggers.map((t) => (t.source ? t : { ...t, source }));
}

function compounderDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];

  if (thesis.stopLoss != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.stopLoss },
      action: "EXIT",
      rationale: `Hard stop at $${thesis.stopLoss}. If we hit it the thesis is broken; close and write up the lessons.`,
      cooldownDays: 0, // explicit opt-out — EXIT is terminal; the position closes and the cron's status:ACTIVE filter takes over.
    });
  }

  if (thesis.entryPrice != null) {
    const reviewLevel = +(thesis.entryPrice * 0.92).toFixed(2);
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: reviewLevel },
      action: "REVIEW",
      rationale: `8% drop from entry — something material happened. Re-evaluate before deciding to ride it out or trim.`,
      cooldownDays: 1,
    });
  }

  out.push(
    {
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale: `Earnings beat — re-score target. Beats often expand the multiple; consider scaling into the next rung.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale: `Earnings miss ≥ 3% — downside surprise tests the core belief. Validate or step back.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "GUIDANCE_CHANGE", direction: "DOWN" },
      action: "REVIEW",
      rationale: `Guidance cut compresses the multiple. For a long-horizon hold this is the single biggest non-price signal.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "FILING", formType: "8-K" },
      action: "REVIEW",
      rationale: `8-K filed — material event. Read the filing and update the thesis if anything changed.`,
      cooldownDays: 1,
    },
    {
      id: createId(),
      predicate: { kind: "TIME_ELAPSED", days: 90 },
      action: "REVIEW",
      rationale: `Quarterly hygiene check. Even with no fires, walk the thesis once a quarter.`,
      cooldownDays: 80,
    },
  );

  out.push(scaleInOnStrengthTrigger());
  out.push(scaleInOnPullbackTrigger());
  out.push(...standingProtectionTriggers());

  return out;
}

function targetDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  if (thesis.stopLoss != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.stopLoss },
      action: "EXIT",
      rationale: `Hard stop at $${thesis.stopLoss}.`,
      cooldownDays: 0, // explicit opt-out — terminal EXIT.
    });
  }
  if (thesis.targetPrice != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level: thesis.targetPrice },
      action: "REVIEW",
      rationale: `Target $${thesis.targetPrice} hit. Decide: close at target or trail higher with confidence intact.`,
      cooldownDays: 1,
    });
  }
  out.push(
    {
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale: `Beat — possibly a reason to extend the target.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale: `Miss ≥ 3% — re-evaluate target.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "TIME_ELAPSED", days: 30 },
      action: "REVIEW",
      rationale: `Monthly hygiene check.`,
      cooldownDays: 25,
    },
  );
  out.push(scaleInOnStrengthTrigger());
  out.push(scaleInOnPullbackTrigger());
  out.push(...standingProtectionTriggers());
  return out;
}

function tradeDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  if (thesis.stopLoss != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.stopLoss },
      action: "EXIT",
      rationale: `Tight stop at $${thesis.stopLoss}. Trade-horizon — get out fast on invalidation.`,
      cooldownDays: 0, // explicit opt-out — terminal EXIT.
    });
  }
  if (thesis.targetPrice != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level: thesis.targetPrice },
      action: "EXIT",
      rationale: `Target $${thesis.targetPrice} hit. Trade plan executed; close.`,
      cooldownDays: 0, // explicit opt-out — terminal EXIT.
    });
  }
  const maxDays = thesis.maxHoldDays ?? 14;
  out.push({
    id: createId(),
    predicate: { kind: "TIME_ELAPSED", days: maxDays },
    action: "REVIEW",
    rationale: `Max hold ${maxDays} days reached — TRADE horizons must close out by this point.`,
    // cooldownDays intentionally unset — falls back to the per-kind default
    // (~80% of `days`) which is the right shape: TIME_ELAPSED stays true
    // forever once the window is reached, so without ANY cooldown it would
    // re-fire on every signal-routed evaluation.
  });
  out.push(scaleInOnStrengthTrigger());
  out.push(...standingProtectionTriggers());
  return out;
}

function catalystDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  if (thesis.stopLoss != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.stopLoss },
      action: "EXIT",
      rationale: `Hard stop at $${thesis.stopLoss}.`,
      cooldownDays: 0, // explicit opt-out — terminal EXIT.
    });
  }
  // Any FILING is interesting on a catalyst trade — frequently the
  // catalyst arrives via a filing.
  out.push(
    {
      id: createId(),
      predicate: {
        kind: "OR",
        predicates: [
          { kind: "FILING", formType: "8-K" },
          { kind: "FILING", formType: "10-Q" },
          { kind: "FILING", formType: "10-K" },
        ],
      },
      action: "REVIEW",
      rationale: `Any material filing on a catalyst-horizon thesis warrants a look — the filing might BE the catalyst.`,
      cooldownDays: 1,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale: `Beat — possibly the catalyst.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale: `Miss ≥ 3% — possibly the inverse catalyst.`,
      cooldownDays: 7,
    },
  );
  out.push(scaleInOnStrengthTrigger());
  out.push(scaleInOnPullbackTrigger());
  out.push(...standingProtectionTriggers());
  return out;
}

// ── Watching templates ─────────────────────────────────────────────────
// For NON-HELD theses on the watchlist. Also reused for PROMOTED theses
// (post-paper-graduation, awaiting first-live re-entry) — same semantic:
// no open position, so no EXIT; ENTER on the target level is the way
// price-crossings re-engage tactical. Semantic shift vs HELD:
//   - No EXIT triggers (nothing to exit)
//   - The TARGET price is the ENTRY-trigger threshold ("waiting for
//     price to break above X to consider INITIATE")
//   - The STOP price becomes a REVIEW threshold for LONG ("price
//     fell to support — better entry or thesis weakening?") and an
//     ENTRY threshold for SHORT (mirror semantics)
//   - News/event triggers stay as REVIEW
//   - REVIEW_DATE_HIT trigger REMOVED from watching templates 2026-05-20.
//     It was duplicating daily-run's needsAction.REVIEW_DUE check —
//     daily-run reads Thesis.nextReviewAt directly every morning and
//     decides REVIEW_DUE without needing a trigger. Auto-attaching the
//     trigger meant the 5-min cron also spawned a TACTICAL run on every
//     overdue WATCHING thesis intra-day, which produced almost zero
//     state changes (28 of 35 tactical runs on 2026-05-18 were
//     REVIEW_DATE_HIT, 0 produced state changes). The intra-day
//     "review" was pure busywork — the agent wasn't going to make a
//     different decision at 11 AM than it would the next morning at
//     8 AM. The predicate kind stays in the schema + evaluator for
//     backwards compat with existing rows; cleanup script
//     scripts/dedupe-review-date-hit-triggers.ts strips it from
//     existing WATCHING theses.
//
// Direction matters here: LONG watches enter on PRICE_ABOVE entryPrice,
// SHORT watches enter on PRICE_BELOW entryPrice. PASS watches get only
// REVIEW triggers ("the move I dismissed actually happened — re-look").
//
// Per-horizon shape (matches the held side's per-horizon split):
//   CATALYST    — entry trigger + filing/earnings REVIEW + tight 14d
//                 hygiene (catalyst windows are short)
//   TRADE       — entry trigger + 14d REVIEW (matches max-hold; if a
//                 watch is stale after the trade window, kill it)
//   TARGET      — current shape: entry + support REVIEW + 30d hygiene
//   COMPOUNDER  — entry trigger with longer cooldown (ignore noise) +
//                 90d hygiene; no support REVIEW (compounders shouldn't
//                 react to short-term wiggles)

/**
 * Direction-aware ENTER trigger keyed off `entryPrice`. Shared across
 * horizons.
 *
 * 2026-05-31 (P1-3 fix): this used to read `targetPrice`, which was the
 * structural bug GAPS P1-3 tracked — targetPrice was the take-profit
 * level when ACTIVE, so defaulting the ENTER trigger to
 * PRICE_ABOVE(targetPrice) on WATCHING meant the agent would literally
 * buy at the take-profit level (production evidence: MDB 2026-05-25).
 * The fix is one line: read `entryPrice` instead. The schema already had
 * `entryPrice` as a distinct column meaning "where you'd buy / did buy."
 * Two separate fields, two separate purposes — the bug was just the
 * default reading the wrong column. See docs/plans/PRICE_LEVEL_SEMANTICS.md.
 */
function watchingEntryTrigger(
  thesis: ThesisShape,
  direction: ThesisDirection,
  cooldownDays: number,
): Trigger | null {
  if (thesis.entryPrice == null) return null;
  if (direction === "LONG") {
    return {
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level: thesis.entryPrice },
      action: "ENTER",
      rationale: `Entry trigger — price broke above $${thesis.entryPrice}. Validate setup and consider INITIATE.`,
      cooldownDays,
    };
  }
  if (direction === "SHORT") {
    return {
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.entryPrice },
      action: "ENTER",
      rationale: `Short entry trigger — price broke below $${thesis.entryPrice}. Validate setup and consider INITIATE short.`,
      cooldownDays,
    };
  }
  // PASS: the move we dismissed actually happened. Re-evaluate.
  return {
    id: createId(),
    predicate: { kind: "PRICE_ABOVE", level: thesis.entryPrice },
    action: "REVIEW",
    rationale: `Price hit the entry level we dismissed. Re-evaluate the PASS — was the rejection wrong?`,
    cooldownDays: 7,
  };
}

// reviewDateHitTrigger() removed 2026-05-20 (see header comment above).
// REVIEW_DATE_HIT predicate stays in types/evaluator for back-compat with
// existing rows; new theses no longer get it.

function watchingCatalystDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  const direction = thesis.direction ?? "LONG";

  // ── Setup-aware default ENTER trigger for CATALYST ────────────────────
  // When the catalyst date is within 7 trading days, the typical CATALYST
  // play is pre-event accumulation (buy now or on the event print), NOT
  // breakout-above-entry-level. In that window the right default is
  // event-based: EARNINGS_BEAT for an earnings catalyst (the most common
  // case in our roster). This fires on the post-print signal and lets
  // tactical decide whether to INITIATE.
  //
  // When the catalyst date is further out (>7 days) OR not set, default
  // back to the breakout-pattern entry (PRICE_ABOVE(entryPrice) for LONG)
  // — covers the rare CATALYST case where the writer wants "buy on
  // breakout that confirms the setup, then ride into the catalyst."
  //
  // 2026-05-31: the long comment block that used to live here flagged
  // the now-fixed P1-3 bug ("PRICE_ABOVE(target) as ENTER is structurally
  // wrong"). watchingEntryTrigger now reads entryPrice, not targetPrice,
  // so the default is no longer broken — the event-based fallback for
  // catalystSoon is kept anyway because it's a better setup match for
  // pre-event accumulation than a breakout entry would be.
  //
  // Agent can always override either default via the (predicate, action)
  // merge bucket.
  const catalystSoon =
    thesis.catalystDate != null &&
    thesis.catalystDate.getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;

  if (catalystSoon && (direction === "LONG" || direction === "SHORT")) {
    // Event-based ENTER — fires on the catalyst event itself.
    // EARNINGS_BEAT for LONG, EARNINGS_MISS for SHORT (the catalyst
    // confirming the directional thesis).
    out.push({
      id: createId(),
      predicate:
        direction === "LONG"
          ? { kind: "EARNINGS_BEAT" }
          : { kind: "EARNINGS_MISS" },
      action: "ENTER",
      rationale:
        direction === "LONG"
          ? `Catalyst within 7d — enter on earnings beat confirmation. Tactical validates the post-print tape before INITIATE.`
          : `Catalyst within 7d — short-side entry on earnings miss confirmation. Tactical validates the post-print tape before INITIATE short.`,
      cooldownDays: 7,
    });
  } else {
    const entry = watchingEntryTrigger(thesis, direction, 1);
    if (entry) out.push(entry);
  }

  // Catalyst windows live and die on filings + earnings — those are
  // typically how the catalyst lands. No support-REVIEW: a binary
  // catalyst is either resolved or not, intermediate price wiggles
  // don't change the entry plan.
  //
  // When the ENTER trigger above is the matching earnings predicate
  // (LONG → EARNINGS_BEAT, SHORT → EARNINGS_MISS), skip the REVIEW on
  // the SAME predicate to avoid the trigger evaluator firing both ENTER
  // and REVIEW on the same earnings signal (redundant tactical-run
  // spawn — the ENTER already handles the post-print decision).
  const earningsBeatIsEntry = catalystSoon && direction === "LONG";
  const earningsMissIsEntry = catalystSoon && direction === "SHORT";

  out.push({
    id: createId(),
    predicate: {
      kind: "OR",
      predicates: [
        { kind: "FILING", formType: "8-K" },
        { kind: "FILING", formType: "10-Q" },
        { kind: "FILING", formType: "10-K" },
      ],
    },
    action: "REVIEW",
    rationale:
      direction === "PASS"
        ? `Material filing on a catalyst-PASS — the news may invalidate the rejection.`
        : `Material filing on a catalyst-watch — the filing may BE the catalyst.`,
    cooldownDays: 1,
  });
  if (!earningsBeatIsEntry) {
    out.push({
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale:
        direction === "PASS"
          ? `Beat — possibly a reason to flip the PASS.`
          : `Beat — possibly the catalyst. Validate before INITIATE.`,
      cooldownDays: 7,
    });
  }
  if (!earningsMissIsEntry) {
    out.push({
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale:
        direction === "PASS"
          ? `Miss — confirms the PASS, possibly remove from watch.`
          : `Miss — possibly the inverse catalyst. Consider removing from watch.`,
      cooldownDays: 7,
    });
  }
  out.push({
    id: createId(),
    predicate: { kind: "TIME_ELAPSED", days: 14 },
    action: "REVIEW",
    rationale: `Catalyst-window hygiene — if we're still watching after 14 days, the setup is stale.`,
    cooldownDays: 12,
  });

  return out;
}

function watchingTradeDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  const direction = thesis.direction ?? "LONG";

  // TRADE-horizon entries are tight by design — the agent set a specific
  // breakout level on a known short-term setup. Cooldown 1d so an
  // intraday cross fires once and tactical-run takes it from there.
  const entry = watchingEntryTrigger(thesis, direction, 1);
  if (entry) out.push(entry);

  // No support-REVIEW for TRADE: the setup IS the entry plan; if price
  // drops to "support" the setup is gone, the thesis should age out via
  // TIME_ELAPSED rather than fire a noisy mid-window REVIEW.
  out.push(
    {
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale: `Beat — short-term tape may flip in our favor before the entry trigger.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale: `Miss — entry conditions deteriorating. Consider removing.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "TIME_ELAPSED", days: 14 },
      action: "REVIEW",
      rationale: `Trade-window hygiene — TRADE setups stale after 14 days. Confirm or remove.`,
      cooldownDays: 12,
    },
  );

  return out;
}

function watchingTargetDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  const direction = thesis.direction ?? "LONG";

  const entry = watchingEntryTrigger(thesis, direction, 1);
  if (entry) out.push(entry);

  // Support-REVIEW for LONG: a pullback to the stop level is either
  // a better entry or evidence the thesis is breaking. Worth a look.
  // (SHORT mirror omitted — kept lean.)
  if (thesis.stopLoss != null && direction === "LONG") {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.stopLoss },
      action: "REVIEW",
      rationale: `Price dropped to support level $${thesis.stopLoss}. Better entry, or thesis weakening?`,
      cooldownDays: 1,
    });
  }

  out.push(
    {
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale:
        direction === "PASS"
          ? `Beat — possibly a reason to flip the PASS.`
          : `Beat — possible entry catalyst. Validate before INITIATE.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale:
        direction === "PASS"
          ? `Miss — confirms the PASS, possibly remove from watch.`
          : `Miss — entry conditions worsening. Consider removing.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "TIME_ELAPSED", days: 30 },
      action: "REVIEW",
      rationale: `Monthly hygiene — is this still worth tracking?`,
      cooldownDays: 25,
    },
  );

  return out;
}

function watchingCompounderDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  const direction = thesis.direction ?? "LONG";

  // COMPOUNDER entry requires patience — short-term spikes through the
  // breakout level are noise on a multi-year hold. 7d cooldown means a
  // single fleeting cross doesn't spam tactical runs; if price holds
  // above the level over a week the cron will re-fire.
  const entry = watchingEntryTrigger(thesis, direction, 7);
  if (entry) out.push(entry);

  // No support-REVIEW. Compounder watches don't react to intra-month
  // price moves — only to fundamental events (earnings/guidance) or
  // the scheduled hygiene check.
  out.push(
    {
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale:
        direction === "PASS"
          ? `Beat — possibly a reason to flip the PASS.`
          : `Beat — long-term entry validation. Re-evaluate.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale:
        direction === "PASS"
          ? `Miss — confirms the PASS.`
          : `Miss — does this break the compounder thesis?`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "GUIDANCE_CHANGE", direction: "DOWN" },
      action: "REVIEW",
      rationale: `Guidance cut on a compounder watch — biggest signal that the long-term thesis is flawed. Re-evaluate.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "TIME_ELAPSED", days: 90 },
      action: "REVIEW",
      rationale: `Quarterly hygiene — even compounders get a periodic look.`,
      cooldownDays: 80,
    },
  );

  return out;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns the horizon-keyed default trigger array for this thesis.
 * Pure function — no DB, no clock; delegates ID generation to cuid.
 *
 * @param horizon  Trade structure (CATALYST/TARGET/TRADE/COMPOUNDER)
 * @param state    HELD vs WATCHING vs PROMOTED — determines whether to
 *                 emit EXIT triggers (held), ENTER triggers (watching),
 *                 or the no-EXIT/ENTER-as-re-entry shape (promoted).
 *                 Defaults to HELD for backward compatibility with callers
 *                 minted before the split. New callers should pass
 *                 explicitly.
 * @param thesis   Thesis fields used to parameterize the templates
 *
 * PROMOTED note: a PROMOTED thesis was an ACTIVE paper position that
 * the user just graduated PAPER→LIVE. The paper position was
 * force-closed; the thesis itself still carries full conviction (entry,
 * target, stop, belief) and is awaiting first-live-run re-entry.
 * Trigger shape mirrors WATCHING — ENTER on the target level so a
 * matching price crossing wakes tactical-run which calls place_trade
 * (place_trade auto-flips PROMOTED → ACTIVE in the same tx per PR #324).
 * Critically, NO EXIT/TRIM/ADD/MOVE_STOP — those operate on positions
 * and a PROMOTED thesis has none.
 */
export function defaultTriggersForHorizon(
  horizon: Horizon,
  thesis: ThesisShape,
  state: ThesisState = "HELD",
): Trigger[] {
  if (state === "WATCHING" || state === "PROMOTED") {
    // PROMOTED reuses the WATCHING template family: no EXIT (there's no
    // open position), an ENTER trigger off the target level (the re-entry
    // path that wakes tactical → place_trade → atomic PROMOTED→ACTIVE
    // flip), plus the same news/earnings/hygiene REVIEW set. The
    // WATCHING templates already produce exactly this shape so the
    // PROMOTED branch is a straight delegation.
    switch (horizon) {
      case "CATALYST":
        return stampSource(watchingCatalystDefaults(thesis), "DEFAULT");
      case "TRADE":
        return stampSource(watchingTradeDefaults(thesis), "DEFAULT");
      case "TARGET":
        return stampSource(watchingTargetDefaults(thesis), "DEFAULT");
      case "COMPOUNDER":
        return stampSource(watchingCompounderDefaults(thesis), "DEFAULT");
    }
  }
  switch (horizon) {
    case "COMPOUNDER":
      return stampSource(compounderDefaults(thesis), "DEFAULT");
    case "TARGET":
      return stampSource(targetDefaults(thesis), "DEFAULT");
    case "TRADE":
      return stampSource(tradeDefaults(thesis), "DEFAULT");
    case "CATALYST":
      return stampSource(catalystDefaults(thesis), "DEFAULT");
  }
}

// ── Cooldown defaults ──────────────────────────────────────────────────
//
// Triggers without a `cooldownDays` value used to fire forever — the
// `shouldFire` gate only enforces cooldown when both `cooldownDays` and
// `lastFiredAt` are set, so an unset cooldown silently disabled rate
// limiting. Observed in production: agent-supplied EARNINGS_BEAT trigger
// on AMZN with no cooldown fired 10 tactical runs over 12.5 hours on a
// single earnings signal that the router (correctly) re-evaluated each
// time a new intel batch landed.
//
// We now apply a sane per-predicate-kind default at write time in
// record_thesis / update_thesis. The values mirror the conventions
// already baked into the horizon templates above (EARNINGS_*: 7,
// FILING: 1, etc.) so behavior of a default-minted trigger doesn't
// change — these only kick in when an agent-supplied trigger is
// missing the field.

/**
 * Default cooldown (days) for a predicate when the agent didn't specify
 * one. Mirrors the conventions in the horizon templates: earnings-class
 * predicates rate-limit at the quarterly cycle (7d caps the
 * "earnings-beat aftershocks" window); filings/news/price predicates
 * rate-limit at 1 day so they don't fan out on every quote tick or
 * intel batch; review-cadence predicates rate-limit closer to their
 * window (TIME_ELAPSED 30 ⇒ 25, etc.).
 */
export function defaultCooldownDaysForPredicate(p: TriggerPredicate): number {
  switch (p.kind) {
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
    case "GUIDANCE_CHANGE":
      return 7;
    case "FILING":
      return 1;
    case "SIGNAL_TYPE":
      return 1;
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
    case "PRICE_MOVE_PCT":
    case "VS_SMA":
    case "RSI":
      return 1;
    case "GAIN_FROM_ENTRY":
      // A gain milestone LATCHES (up 10% stays up 10%): the acting agent
      // is expected to replace the fired rung with the next checkpoint;
      // 7d stops a same-week re-fire if it doesn't.
      return 7;
    case "TRAILING_FROM_HIGH":
      // Also latches while price sits below the trail. EXIT is terminal
      // anyway; REVIEW/TRIM rungs get one nudge per day, matching the
      // other price predicates.
      return 1;
    case "TIME_ELAPSED":
      // Most TIME_ELAPSED predicates fire once and stay fired; pick a
      // cooldown ~80% of the window so they don't re-fire every tick once
      // elapsed but allow re-firing if the agent's window is short.
      return Math.max(1, Math.round(p.days * 0.8));
    case "REVIEW_DATE_HIT":
      return 7;
    case "AND":
    case "OR":
      // Composite: pick the max child cooldown. If a composite contains
      // an EARNINGS_BEAT, use 7 — the more conservative default wins.
      return Math.max(
        1,
        ...p.predicates.map(defaultCooldownDaysForPredicate),
      );
  }
}

/**
 * Fill in `cooldownDays` on every trigger in the array that doesn't
 * already have one. Pure; returns a fresh array. Call this in the write
 * path (record_thesis / update_thesis) before persistence so disk state
 * always has cooldown bookkeeping.
 *
 * `cooldownDays: 0` is legitimate ONLY on EXIT triggers — those are
 * terminal (the position closes and the cron's `status:ACTIVE` filter
 * takes over), so re-firing isn't a runaway risk. On any other action
 * (REVIEW, ENTER, TRIM) `0` is structurally invalid against a sticky
 * predicate (TIME_ELAPSED, PRICE_ABOVE/BELOW, VS_SMA, RSI, AND/OR
 * composites of the same) — once the condition is true it stays true,
 * and a 5-min trigger-evaluator tick re-fires every cycle until
 * intervention. Treat `0` on non-EXIT as "needs default" and overwrite
 * with the per-predicate cooldown.
 *
 * Background: 2026-06-02 NVDA tactical runaway — agent-supplied
 * `update_thesis` triggers stamped `cooldownDays: 0` on a TIME_ELAPSED
 * 14d REVIEW, the old `!= null` check walked past it, and the loop
 * fired 15 times in 70 min before manual hotfix. See `docs/GAPS.md`.
 */
/**
 * Default fire mode for a manually-added trigger, keyed off action. A
 * deterministic EXIT (hard stop / trailing stop / take-profit level) has
 * nothing for an agent to decide, so it closes DIRECT — skipping the
 * GPT-5.5 tactical run (the principal's cost driver, TRIGGER_FOLLOWUPS #3).
 * It still flows through the approval gate. Every other action keeps the
 * judgment-bearing TACTICAL path.
 *
 * Scope note: this drives the UI add-path + popover only. The horizon
 * default templates intentionally do NOT call it — they omit fireMode, so
 * agent-minted EXIT stops stay on the historical TACTICAL behavior until
 * the principal opts a specific trigger into DIRECT. Changing the mass-mint
 * default is a separate decision.
 */
export function defaultFireModeForAction(
  action: Trigger["action"],
): "TACTICAL" | "DIRECT" {
  return action === "EXIT" ? "DIRECT" : "TACTICAL";
}

export function applyTriggerCooldownDefaults(triggers: Trigger[]): Trigger[] {
  return triggers.map((t) => {
    const needsDefault =
      t.cooldownDays == null || (t.cooldownDays === 0 && t.action !== "EXIT");
    return needsDefault
      ? { ...t, cooldownDays: defaultCooldownDaysForPredicate(t.predicate) }
      : t;
  });
}

/**
 * Stable key for the precedence rule: agent-supplied triggers win on
 * the same (predicate.kind, action) bucket, defaults fill the rest.
 *
 * AND/OR composites use a structural fingerprint so an agent's custom
 * "OR(FILING 8-K, FILING 10-Q)" doesn't get duplicated by the catalyst
 * default's similar OR — same intent, same key.
 */
function predicateKey(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return p.kind;
    case "PRICE_MOVE_PCT":
      return `${p.kind}:${p.window}:${p.direction}`;
    case "GAIN_FROM_ENTRY":
      return `${p.kind}:${p.direction}`;
    case "TRAILING_FROM_HIGH":
      return p.kind;
    case "VS_SMA":
      return `${p.kind}:${p.period}:${p.direction}`;
    case "RSI":
      return `${p.kind}:${p.direction}`;
    case "SIGNAL_TYPE":
      return `${p.kind}:${p.signalType}:${p.sentiment ?? ""}`;
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
      return p.kind;
    case "GUIDANCE_CHANGE":
      return `${p.kind}:${p.direction}`;
    case "FILING":
      return `${p.kind}:${p.formType}`;
    case "TIME_ELAPSED":
      return p.kind;
    case "REVIEW_DATE_HIT":
      return p.kind;
    case "AND":
    case "OR":
      return `${p.kind}:${p.predicates.map(predicateKey).sort().join("|")}`;
  }
}

/**
 * The merge bucket for one trigger — `(predicateKey, action)`. Two triggers
 * in the same bucket express the same intent (mergeTriggers keeps only one:
 * agent-supplied wins). Exported for
 * scripts/convert-static-floors-to-trails.ts, which needs "is a same-bucket
 * rung already present?" WITHOUT mergeTriggers' within-list dedup (the
 * hand-written ladders must be preserved verbatim, duplicates and all).
 */
export function triggerBucket(t: Trigger): string {
  return `${predicateKey(t.predicate)}::${t.action}`;
}

/**
 * Merge agent-supplied triggers with horizon defaults. Agent wins per
 * (predicate, action) bucket; defaults fill the gaps. Returns a fresh
 * array; never mutates inputs.
 */
/**
 * Reconcile an agent's wholesale trigger REPLACE (update_thesis) against the
 * on-disk array — the two server-managed fields must survive the swap, keyed
 * by trigger id:
 *
 *   1. `lastFiredAt` — the cooldown stamp. The agent never sees nor reasons
 *      about it; trusting its payload verbatim wipes firing memory on every
 *      update and the next signal re-fires the trigger. (An agent-provided
 *      value is respected — the evaluator itself resends triggers with the
 *      stamp intact.)
 *
 *   2. `source` — provenance (TRIGGER_MODEL.md §5 gap 2). A resent trigger
 *      whose id matches an existing one KEEPS the existing rung's source
 *      (including "no source" on legacy rungs — we never fabricate
 *      provenance); only genuinely new ids are stamped "AGENT". Without
 *      this, every agent review — which resends the full array by design —
 *      would silently relabel default/principal rungs as agent rungs.
 *      The existing value is authoritative over anything the agent sent
 *      (source is server-owned metadata, not agent input).
 *
 * Pure; returns a fresh array. Caller still runs
 * applyTriggerCooldownDefaults afterwards (same as before).
 */
export function reconcileTriggerReplace(
  existing: Trigger[],
  incoming: Trigger[],
): Trigger[] {
  const byId = new Map(existing.filter((t) => t.id).map((t) => [t.id, t]));
  return incoming.map((t) => {
    const prior = t.id ? byId.get(t.id) : undefined;
    const next: Trigger = { ...t };
    // (1) lastFiredAt — agent-provided wins, else carry the prior stamp.
    if (next.lastFiredAt == null && prior?.lastFiredAt != null) {
      next.lastFiredAt = prior.lastFiredAt;
    }
    // (2) source — prior rung's provenance is authoritative on a resend
    // (absent stays absent); a genuinely new id is agent-authored.
    if (prior) {
      if (prior.source) next.source = prior.source;
      else delete next.source;
    } else {
      next.source = "AGENT";
    }
    return next;
  });
}

export function mergeTriggers(
  defaults: Trigger[],
  agentSupplied: Trigger[],
): Trigger[] {
  const seen = new Set<string>();
  const out: Trigger[] = [];

  for (const t of agentSupplied) {
    const key = triggerBucket(t);
    if (seen.has(key)) continue; // dedupe within agent's own list
    seen.add(key);
    out.push(t.id ? t : { ...t, id: createId() });
  }
  for (const t of defaults) {
    const key = triggerBucket(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
