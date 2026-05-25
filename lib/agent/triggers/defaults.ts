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

import { randomUUID } from "node:crypto";

const createId = () => randomUUID();
import type { Trigger, TriggerPredicate } from "./types";

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
// Direction matters here: LONG watches enter on PRICE_ABOVE target,
// SHORT watches enter on PRICE_BELOW target. PASS watches get only
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

/** Direction-aware ENTER trigger off targetPrice. Shared across horizons. */
function watchingEntryTrigger(
  thesis: ThesisShape,
  direction: ThesisDirection,
  cooldownDays: number,
): Trigger | null {
  if (thesis.targetPrice == null) return null;
  if (direction === "LONG") {
    return {
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level: thesis.targetPrice },
      action: "ENTER",
      rationale: `Entry trigger — price broke above $${thesis.targetPrice}. Validate setup and consider INITIATE.`,
      cooldownDays,
    };
  }
  if (direction === "SHORT") {
    return {
      id: createId(),
      predicate: { kind: "PRICE_BELOW", level: thesis.targetPrice },
      action: "ENTER",
      rationale: `Short entry trigger — price broke below $${thesis.targetPrice}. Validate setup and consider INITIATE short.`,
      cooldownDays,
    };
  }
  // PASS: the move we dismissed actually happened. Re-evaluate.
  return {
    id: createId(),
    predicate: { kind: "PRICE_ABOVE", level: thesis.targetPrice },
    action: "REVIEW",
    rationale: `Price hit the target we dismissed. Re-evaluate the PASS — was the rejection wrong?`,
    cooldownDays: 7,
  };
}

// reviewDateHitTrigger() removed 2026-05-20 (see header comment above).
// REVIEW_DATE_HIT predicate stays in types/evaluator for back-compat with
// existing rows; new theses no longer get it.

function watchingCatalystDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  const direction = thesis.direction ?? "LONG";

  const entry = watchingEntryTrigger(thesis, direction, 1);
  if (entry) out.push(entry);

  // Catalyst windows live and die on filings + earnings — those are
  // typically how the catalyst lands. No support-REVIEW: a binary
  // catalyst is either resolved or not, intermediate price wiggles
  // don't change the entry plan.
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
      rationale:
        direction === "PASS"
          ? `Material filing on a catalyst-PASS — the news may invalidate the rejection.`
          : `Material filing on a catalyst-watch — the filing may BE the catalyst.`,
      cooldownDays: 1,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale:
        direction === "PASS"
          ? `Beat — possibly a reason to flip the PASS.`
          : `Beat — possibly the catalyst. Validate before INITIATE.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 },
      action: "REVIEW",
      rationale:
        direction === "PASS"
          ? `Miss — confirms the PASS, possibly remove from watch.`
          : `Miss — possibly the inverse catalyst. Consider removing from watch.`,
      cooldownDays: 7,
    },
    {
      id: createId(),
      predicate: { kind: "TIME_ELAPSED", days: 14 },
      action: "REVIEW",
      rationale: `Catalyst-window hygiene — if we're still watching after 14 days, the setup is stale.`,
      cooldownDays: 12,
    },
  );

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
        return watchingCatalystDefaults(thesis);
      case "TRADE":
        return watchingTradeDefaults(thesis);
      case "TARGET":
        return watchingTargetDefaults(thesis);
      case "COMPOUNDER":
        return watchingCompounderDefaults(thesis);
    }
  }
  switch (horizon) {
    case "COMPOUNDER":
      return compounderDefaults(thesis);
    case "TARGET":
      return targetDefaults(thesis);
    case "TRADE":
      return tradeDefaults(thesis);
    case "CATALYST":
      return catalystDefaults(thesis);
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
 */
export function applyTriggerCooldownDefaults(triggers: Trigger[]): Trigger[] {
  return triggers.map((t) =>
    t.cooldownDays != null
      ? t
      : { ...t, cooldownDays: defaultCooldownDaysForPredicate(t.predicate) },
  );
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

function triggerBucket(t: Trigger): string {
  return `${predicateKey(t.predicate)}::${t.action}`;
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
