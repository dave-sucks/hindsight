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

export interface ThesisShape {
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  maxHoldDays?: number | null;
  catalystDate?: Date | null;
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
      // No cooldown on EXIT triggers — terminal action, must always fire.
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
      // No cooldown on EXIT — terminal.
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
      // No cooldown on EXIT — terminal.
    });
  }
  if (thesis.targetPrice != null) {
    out.push({
      id: createId(),
      predicate: { kind: "PRICE_ABOVE", level: thesis.targetPrice },
      action: "EXIT",
      rationale: `Target $${thesis.targetPrice} hit. Trade plan executed; close.`,
      // No cooldown on EXIT — terminal.
    });
  }
  const maxDays = thesis.maxHoldDays ?? 14;
  out.push({
    id: createId(),
    predicate: { kind: "TIME_ELAPSED", days: maxDays },
    action: "REVIEW",
    rationale: `Max hold ${maxDays} days reached — TRADE horizons must close out by this point.`,
    // No cooldown — TIME_ELAPSED only fires once anyway (after the
    // window is reached); cooldown is irrelevant.
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
      // No cooldown on EXIT — terminal.
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

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Returns the horizon-keyed default trigger array for this thesis.
 * Pure function — no DB, no clock; delegates ID generation to cuid.
 */
export function defaultTriggersForHorizon(
  horizon: Horizon,
  thesis: ThesisShape,
): Trigger[] {
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
