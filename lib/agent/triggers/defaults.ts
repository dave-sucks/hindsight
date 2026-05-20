/**
 * Horizon-keyed default trigger templates — mechanical safety net only.
 *
 * Every thesis carries a `triggers[]` array of structured predicates that
 * the router evaluates deterministically. This module supplies the
 * MECHANICAL minimum keyed off horizon and direction:
 *
 *   HELD LONG/SHORT     PRICE_BELOW(stop) → EXIT          (the hard stop)
 *   HELD TRADE          PRICE_ABOVE(target) → EXIT also    (mechanical target)
 *   WATCHING LONG       PRICE_ABOVE(target) → ENTER        (the entry trigger)
 *   WATCHING SHORT      PRICE_BELOW(target) → ENTER        (mirror)
 *
 * Everything else — earnings predicates, filing watches, guidance change,
 * scheduled hygiene reviews — is the AGENT'S to declare per-thesis. The
 * agent has the keyAssumptions and invalidationConds for THIS thesis, so
 * it knows what events would actually move the decision. Auto-attaching
 * 5-6 horizon-default triggers per thesis fired 358 monitors across the
 * book and produced ~9 of 16 tactical runs/day in busywork (see
 * docs/plans/SYSTEM_AUDIT_2026_05_19.md §5a for the diagnosis).
 *
 * REVIEW_DATE_HIT is INTENTIONALLY GONE from these defaults. The
 * `Thesis.nextReviewAt` field is still consumed by daily-run's
 * `get_theses.needsAction.REVIEW_DUE` path — the trigger version was
 * just a clock-check wrapper that duplicated work. Daily-run owns
 * scheduled reviews; tactical fires only on real events.
 *
 * Usage:
 *   const merged = mergeTriggers(
 *     defaultTriggersForHorizon("COMPOUNDER", thesis, "HELD"),
 *     args.triggers ?? [],
 *   );
 *
 * Merge rule: defaults fill gaps. Agent-supplied triggers take precedence
 * on the same (predicate.kind, action) key. The agent can override
 * "PRICE_BELOW $stop → EXIT" with a tighter level without producing two
 * contradictory exits.
 *
 * IDs are auto-assigned via randomUUID() — stable for the life of the
 * trigger so cooldown stamps survive subsequent merges.
 *
 * C1/C2 from docs/plans/SYSTEM_AUDIT_2026_05_19.md.
 */

import { randomUUID } from "node:crypto";

const createId = () => randomUUID();
import type { Trigger, TriggerPredicate } from "./types";

export type Horizon = "CATALYST" | "TARGET" | "TRADE" | "COMPOUNDER";

/**
 * Thesis state at the time defaults are derived. Drives the template
 * selection — held positions get EXIT/REVIEW templates around the open
 * position; watching theses get ENTER/REVIEW templates around the
 * watchlist entry condition.
 *
 * Without this distinction, watchlist theses end up with EXIT triggers
 * on stop-loss that can never fire usefully — there's no position to
 * exit. The agent then has no entry trigger to push it from WATCHING
 * → INITIATE, and the watchlist becomes inert.
 */
export type ThesisState = "HELD" | "WATCHING";

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

// ── Builders for each horizon (HELD — position open) ──────────────────
//
// Each builder emits ONLY the mechanical safety-net triggers — the
// minimum the system needs to behave deterministically regardless of
// whether the agent attached anything else. Event-driven REVIEW triggers
// (earnings, filings, guidance, scheduled hygiene) used to live here
// auto-attached; they now belong to the agent's per-thesis declaration
// based on the keyAssumptions / invalidationConds. The default set:
//
//   COMPOUNDER HELD   PRICE_BELOW(stop) → EXIT                     (1 trigger)
//   TARGET HELD       PRICE_BELOW(stop) → EXIT                     (1 trigger)
//   TRADE HELD        PRICE_BELOW(stop) → EXIT, PRICE_ABOVE(target) → EXIT  (2)
//   CATALYST HELD     PRICE_BELOW(stop) → EXIT                     (1 trigger)
//
// If the agent wants earnings-tied reviews or a guidance-change watch,
// it attaches those explicitly. The keyAssumptions on the thesis tell
// the agent what to watch for.

function hardStopTrigger(stopLoss: number, label = "Hard stop"): Trigger {
  return {
    id: createId(),
    predicate: { kind: "PRICE_BELOW", level: stopLoss },
    action: "EXIT",
    rationale: `${label} at $${stopLoss}. If hit, close — the trade plan called for it.`,
    cooldownDays: 0, // terminal EXIT.
  };
}

function compounderDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  if (thesis.stopLoss != null) {
    out.push(hardStopTrigger(thesis.stopLoss, "Hard stop"));
  }
  return out;
}

function targetDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  if (thesis.stopLoss != null) {
    out.push(hardStopTrigger(thesis.stopLoss));
  }
  return out;
}

function tradeDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  if (thesis.stopLoss != null) {
    out.push(hardStopTrigger(thesis.stopLoss, "Tight stop"));
  }
  // TRADE is unique among horizons in that target IS an exit (the plan
  // commits to closing at target, not trailing it). Mechanical exit,
  // not a judgment call.
  if (thesis.targetPrice != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level: thesis.targetPrice },
      action: "EXIT",
      rationale: `Target $${thesis.targetPrice} hit. Trade plan executed; close.`,
      cooldownDays: 0, // terminal EXIT.
    });
  }
  return out;
}

function catalystDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  if (thesis.stopLoss != null) {
    out.push(hardStopTrigger(thesis.stopLoss));
  }
  return out;
}

// ── Watching templates ─────────────────────────────────────────────────
// For NON-HELD theses on the watchlist. The ENTRY trigger off targetPrice
// is the mechanical default — that's the breakout level the agent staked
// the WATCHING thesis on. Everything else (earnings predicates, filing
// watches, hygiene timers) is the agent's job to declare per-thesis.
//
// REVIEW_DATE_HIT triggers are intentionally NOT attached. Daily-run reads
// `Thesis.nextReviewAt` via `get_theses.needsAction.REVIEW_DUE` and walks
// any overdue thesis as part of its weekday cron. Spawning a separate
// tactical run on the same field was duplicate work.
//
// Direction-aware entry:
//   LONG  → PRICE_ABOVE(target) → ENTER  (breakout)
//   SHORT → PRICE_BELOW(target) → ENTER  (breakdown)
//   PASS  → no entry trigger (PASS is institutional memory, not waiting
//                              for re-entry. If conditions change enough
//                              for a re-look, Discovery will re-encounter
//                              the ticker via signal flow.)

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
  // PASS: terminal-at-write institutional memory. No re-entry trigger.
  return null;
}

function watchingCatalystDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  const direction = thesis.direction ?? "LONG";
  const entry = watchingEntryTrigger(thesis, direction, 1);
  if (entry) out.push(entry);
  return out;
}

function watchingTradeDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  const direction = thesis.direction ?? "LONG";
  const entry = watchingEntryTrigger(thesis, direction, 1);
  if (entry) out.push(entry);
  return out;
}

function watchingTargetDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  const direction = thesis.direction ?? "LONG";
  const entry = watchingEntryTrigger(thesis, direction, 1);
  if (entry) out.push(entry);
  return out;
}

function watchingCompounderDefaults(thesis: ThesisShape): Trigger[] {
  const out: Trigger[] = [];
  const direction = thesis.direction ?? "LONG";
  // COMPOUNDER entry uses a 7d cooldown — short-term spikes through the
  // breakout level are noise on a multi-year hold. A single fleeting
  // cross shouldn't spam tactical runs; if price holds above the level
  // over a week the cron will re-fire.
  const entry = watchingEntryTrigger(thesis, direction, 7);
  if (entry) out.push(entry);
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns the horizon-keyed default trigger array for this thesis.
 * Pure function — no DB, no clock; delegates ID generation to cuid.
 *
 * @param horizon  Trade structure (CATALYST/TARGET/TRADE/COMPOUNDER)
 * @param state    HELD vs WATCHING — determines whether to emit EXIT
 *                 triggers (held) or ENTER triggers (watching). Defaults
 *                 to HELD for backward compatibility with callers minted
 *                 before the split. New callers should pass explicitly.
 * @param thesis   Thesis fields used to parameterize the templates
 */
export function defaultTriggersForHorizon(
  horizon: Horizon,
  thesis: ThesisShape,
  state: ThesisState = "HELD",
): Trigger[] {
  if (state === "WATCHING") {
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
