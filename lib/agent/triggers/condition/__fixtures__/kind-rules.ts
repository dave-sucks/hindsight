/**
 * The trigger rules as the kinds answered them, frozen as they stood on
 * 2026-10-04 (the commit before the cutover's first stage). rules.test.ts
 * checks the measure catalog against them over every stored trigger.
 *
 * Test-only, and never edited to make a test pass: a disagreement is a
 * change in how a trigger behaves, which is decided on its own, never inside
 * a refactor.
 */

import type { TriggerAction, TriggerPredicate } from "../../types";

/** The cascade bucket's predicate half (bucket.ts). */
export function predicateKey(p: TriggerPredicate): string {
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
    case "NEAR_SMA":
      return `${p.kind}:${p.period}`;
    case "VOLUME_RATIO":
    case "PCT_FROM_52W_HIGH":
    case "GAP_UP":
    case "INSIDER_CLUSTER":
      return p.kind;
    case "NEW_HIGH":
    case "RS_VS_SPY":
      return `${p.kind}:${p.window}`;
    case "RSI":
      return `${p.kind}:${p.period ?? 14}:${p.direction}`;
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
    case "EARNINGS_WITHIN":
    case "EARNINGS_SINCE":
      return p.kind;
    case "SEC_EVENT":
      return p.tier
        ? `${p.kind}:tier`
        : `${p.kind}:${[...(p.items ?? []), ...(p.forms ?? [])].sort().join("|")}`;
    case "REVIEW_CADENCE":
      return (p.from ?? "LAST_REVIEW") === "LAST_REVIEW"
        ? p.kind
        : `${p.kind}:${p.from}:${p.from === "EVENT" ? (p.side ?? "AFTER") : ""}`;
    case "AND":
    case "OR":
      return `${p.kind}:${p.predicates.map(predicateKey).sort().join("|")}`;
  }
}

/** The cascade bucket (bucket.ts): a buy on a typed price is one bucket whichever way it's set. */
export function triggerBucket(t: { predicate: TriggerPredicate; action: TriggerAction }): string {
  if (t.action === "ENTER" && (t.predicate.kind === "PRICE_ABOVE" || t.predicate.kind === "PRICE_BELOW")) {
    return "PRICE_LEVEL::ENTER";
  }
  return `${predicateKey(t.predicate)}::${t.action}`;
}

/** The default cooldown (defaults.ts). */
export function defaultCooldownDaysForPredicate(p: TriggerPredicate, action?: TriggerAction): number {
  switch (p.kind) {
    case "SEC_EVENT":
      return 0;
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
      return 7;
    case "EARNINGS_WITHIN":
    case "EARNINGS_SINCE":
    case "INSIDER_CLUSTER":
      return 30;
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
    case "PRICE_MOVE_PCT":
    case "NEAR_SMA":
    case "VOLUME_RATIO":
    case "NEW_HIGH":
    case "RSI":
      return 1;
    case "RS_VS_SPY":
      return 7;
    case "VS_SMA":
    case "PCT_FROM_52W_HIGH":
      return action === "REVIEW" ? 7 : 1;
    case "GAP_UP":
      return Math.max(1, p.withinDays ?? 1);
    case "GAIN_FROM_ENTRY":
      return 7;
    case "TRAILING_FROM_HIGH":
      return 1;
    case "REVIEW_CADENCE":
      return p.days;
    case "AND":
    case "OR":
      return Math.max(1, ...p.predicates.map((child) => defaultCooldownDaysForPredicate(child, action)));
  }
}

/** A state, not a moment (state-cooldown.ts). */
export function isStatePredicate(p: { kind: string; predicates?: readonly { kind: string }[] }): boolean {
  switch (p.kind) {
    case "VS_SMA":
    case "PCT_FROM_52W_HIGH":
    case "RS_VS_SPY":
      return true;
    case "AND":
    case "OR": {
      const children = p.predicates ?? [];
      return children.length > 0 && children.every(isStatePredicate);
    }
    default:
      return false;
  }
}

/** The weekly floor on a state review (state-cooldown.ts). */
export function flooredCooldownDays(trigger: { action: string; predicate: TriggerPredicate }, days: number): number {
  return trigger.action === "REVIEW" && isStatePredicate(trigger.predicate) ? Math.max(days, 7) : days;
}

/** A sale that can go straight to a proposal (types.ts). */
export function isDirectEligiblePredicate(kind: string): boolean {
  return ["PRICE_ABOVE", "PRICE_BELOW", "PRICE_MOVE_PCT", "GAIN_FROM_ENTRY", "TRAILING_FROM_HIGH"].includes(kind);
}

/** The label a protective sale closes with (types.ts). */
export function protectiveExitCloseReason(predicate: TriggerPredicate, direction: string | null): "STOP" | "TARGET" | null {
  if (!isDirectEligiblePredicate(predicate.kind)) return null;
  const isLong = direction !== "SHORT";
  switch (predicate.kind) {
    case "PRICE_BELOW":
      return isLong ? "STOP" : "TARGET";
    case "PRICE_ABOVE":
      return isLong ? "TARGET" : "STOP";
    case "PRICE_MOVE_PCT": {
      const up = predicate.direction === "UP";
      const favorable = isLong ? up : !up;
      return favorable ? "TARGET" : "STOP";
    }
    case "GAIN_FROM_ENTRY":
    case "TRAILING_FROM_HIGH":
      return "STOP";
    default:
      return "STOP";
  }
}

/** What a trigger does on a stock we don't hold (types.ts). */
export function effectiveTriggerAction(
  trigger: { action: TriggerAction; predicate: TriggerPredicate },
  state: { status?: string | null; direction?: string | null; hasBuy?: boolean },
): TriggerAction {
  if (state.status === "HOLDING") return trigger.action;
  const kind = trigger.predicate.kind;
  const isPriceLevel = kind === "PRICE_ABOVE" || kind === "PRICE_BELOW";
  if (trigger.action === "EXIT") return "DEMOTE";
  if (trigger.action === "REVIEW" && isPriceLevel && state.hasBuy !== false) {
    const isLong = state.direction !== "SHORT";
    const favourable = isLong ? kind === "PRICE_ABOVE" : kind === "PRICE_BELOW";
    if (favourable) return "DEMOTE";
  }
  return trigger.action;
}

type TimedPredicate = { kind: string; basis?: string; predicates?: TimedPredicate[] };

/** A watched stock's floor reads the close (types.ts). */
export function watchedFloorOnClose<T extends { action: string; predicate: TimedPredicate }>(
  trigger: T,
  state: { status?: string | null },
): T {
  if (state.status === "HOLDING" || trigger.action !== "EXIT") return trigger;
  const onClose = (p: TimedPredicate): TimedPredicate =>
    p.kind === "PRICE_ABOVE" || p.kind === "PRICE_BELOW"
      ? { ...p, basis: "close" }
      : (p.kind === "AND" || p.kind === "OR") && p.predicates
        ? { ...p, predicates: p.predicates.map(onClose) }
        : p;
  const predicate = onClose(trigger.predicate);
  return JSON.stringify(predicate) === JSON.stringify(trigger.predicate) ? trigger : ({ ...trigger, predicate } as T);
}
