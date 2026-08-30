/**
 * Human-readable formatters for trigger predicates and actions.
 *
 * Used by:
 *  - lib/inngest/functions/tactical-run.ts — writes the TRIGGER_FIRED
 *    audit row's `summary` field at fire time, so persisted text is
 *    already English (not SCREAMING_SNAKE_CASE).
 *  - components/agent/sheets/ThesisSheet.tsx — renders the
 *    "most recent trigger" banner. Composes condition + action.
 *  - components/agent/sheets/ThesisTriggersSection.tsx — re-exports
 *    these so the trigger pills, popover descriptions, and banner all
 *    share one source.
 *
 * Pure functions, no React, safe to import server-side.
 */

import type { Trigger, TriggerPredicate } from "@/lib/agent/triggers/types";

/**
 * One sentence describing what the predicate evaluates. Used in pills
 * and as the leading clause of the trigger-fired banner.
 *
 *   PRICE_BELOW $5.92            → "Price below $5.92"
 *   EARNINGS_BEAT ≥3%            → "Earnings beat ≥3%"
 *   SIGNAL_TYPE NEWS BULLISH     → "Bullish news"
 */
export function predicateSentence(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_BELOW":
      return `Price below $${p.level}`;
    case "PRICE_ABOVE":
      return `Price above $${p.level}`;
    case "PRICE_MOVE_PCT":
      return `Price ${p.direction === "UP" ? "up" : "down"} ${p.pct}% over ${p.window}`;
    case "GAIN_FROM_ENTRY":
      return p.direction === "UP"
        ? `Up ${p.pct}% from entry`
        : `Down ${p.pct}% from entry`;
    case "TRAILING_FROM_HIGH":
      // Same vocabulary as the trigger editor ("Trailing from high") — the
      // feed once said "Gives back X% from the high" and read as a trigger
      // type that doesn't exist in the builder.
      return `Trailing ${p.pct}% from high`;
    case "VS_SMA":
      return `Price ${p.direction.toLowerCase()} ${p.period}-day SMA`;
    case "RSI":
      return `RSI ${p.direction.toLowerCase()} ${p.threshold}`;
    case "SIGNAL_TYPE": {
      const parts: string[] = [];
      if (p.sentiment) parts.push(p.sentiment.toLowerCase());
      const kind = p.signalType.toLowerCase().replace(/_/g, " ");
      parts.push(kind);
      let s = parts.join(" ");
      if (p.minUrgency) s += ` ≥${p.minUrgency.toLowerCase()} urgency`;
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    case "EARNINGS_BEAT":
      return p.minSurprisePct
        ? `Earnings beat ≥${p.minSurprisePct}%`
        : "Any earnings beat";
    case "EARNINGS_MISS":
      return p.minSurprisePct
        ? `Earnings miss ≥${p.minSurprisePct}%`
        : "Any earnings miss";
    case "GUIDANCE_CHANGE":
      return `Guidance ${p.direction.toLowerCase()}`;
    case "FILING":
      return `${p.formType} filed`;
    case "TIME_ELAPSED":
      return `${p.days} days elapsed`;
    case "REVIEW_CADENCE":
      return `Every ${p.days} days since the last review`;
    case "AND":
      return `All of ${p.predicates.length} conditions`;
    case "OR":
      return `Any of ${p.predicates.length} conditions`;
  }
}

/**
 * Imperative phrase for what the agent should DO when the trigger fires.
 *
 *   EXIT       → "exit position"
 *   ADD        → "scale in"
 *   TRIM       → "trim position"
 *   MOVE_STOP  → "move stop"
 *   REVIEW     → "review"
 *
 * `held` (pass false for a thesis we don't own) makes EXIT honest: on an
 * un-held thesis a floor break can't sell anything — `effectiveTriggerAction`
 * resolves it to DEMOTE, so the label says what actually happens. Omitted ⇒
 * the historical held-side wording, so no caller changes by accident.
 */
export function actionLabel(action: string, held?: boolean): string {
  if (action === "EXIT" && held === false) return "take the plan down";
  switch (action) {
    case "EXIT":
      return "exit position";
    case "ENTER":
      return "consider entry";
    case "ADD":
      return "scale in";
    case "TRIM":
      return "trim position";
    case "MOVE_STOP":
      return "move stop";
    case "REVIEW":
    default:
      return "review";
  }
}

/**
 * Single-sentence summary suitable for the TRIGGER_FIRED audit row's
 * `summary` field and for the sheet's banner: "{condition} — {action}".
 *
 *   PRICE_BELOW $5.92 + REVIEW → "Price below $5.92 — review"
 *   EARNINGS_BEAT ≥3% + ADD    → "Earnings beat ≥3% — scale in"
 */
export function describeTriggerFire(trigger: Trigger, held?: boolean): string {
  return `${predicateSentence(trigger.predicate)} — ${actionLabel(trigger.action, held)}`;
}

/**
 * Group-header label for the sheet's Triggers section. One label per
 * TriggerAction — each action gets its own group instead of the previous
 * 3-bucket collapse (which conflated ADD with ENTER and TRIM with EXIT
 * and dropped MOVE_STOP into REVIEW). Pairs with the new popover title
 * "{ActionVerb} if {predicate}".
 *
 *   ENTER     → "Buy if"
 *   ADD       → "Add if"
 *   TRIM      → "Trim if"
 *   MOVE_STOP → "Move stop if"
 *   EXIT      → "Exit if"
 *   REVIEW    → "Review if"
 */
/**
 * Label for a trigger's fire mode — used in the trigger popover's "On fire"
 * control and the add-trigger form. Uses the app's own verbs:
 *
 *   TACTICAL → "Trigger Tactical Run"   (wake the agent to decide)
 *   DIRECT   → "Automatically Exit" / "Automatically Enter"  (no agent),
 *              keyed off the action so the label names what actually happens.
 *
 * DIRECT is only offered on a deterministic EXIT (the control is gated on it),
 * so the action is normally EXIT; ENTER/ADD are handled for completeness.
 */
export function fireModeLabel(
  mode: "TACTICAL" | "DIRECT",
  action?: string,
): string {
  if (mode === "DIRECT") {
    return action === "ENTER" || action === "ADD"
      ? "Automatically Enter"
      : "Automatically Exit";
  }
  return "Trigger Tactical Run";
}

/**
 * Where a rung lives, in the second person. Shown in the popover of an
 * inherited (dotted) rung so "why can't I edit this here?" answers itself.
 *
 * Deliberately names the SCOPE rather than the mechanism — "every thesis
 * this analyst covers" beats "AgentConfig.triggers" for the person
 * deciding whether to change it. The analyst's own name is substituted
 * when the caller knows it.
 */
export function levelScopeLabel(
  level: "THESIS" | "ANALYST" | "ACCOUNT" | "DEFAULT" | undefined,
  analystName?: string | null,
): string {
  switch (level) {
    case "ANALYST":
      return analystName
        ? `Set on ${analystName} — applies to every thesis it covers`
        : "Set on this analyst — applies to every thesis it covers";
    case "ACCOUNT":
      return "Set account-wide — applies to every analyst";
    case "DEFAULT":
      return "Applies automatically to every holding — not configured";
    case "THESIS":
    default:
      return "Set on this thesis";
  }
}

/**
 * Short label for the level chip on an inherited rung's popover.
 * "Default" reads as the honest answer to "who set this?" — nobody did.
 */
export function levelBadgeLabel(
  level: "THESIS" | "ANALYST" | "ACCOUNT" | "DEFAULT" | undefined,
): string {
  switch (level) {
    case "ANALYST":
      return "Analyst";
    case "ACCOUNT":
      return "Account";
    case "DEFAULT":
      return "Automatic";
    case "THESIS":
    default:
      return "This thesis";
  }
}

export function actionGroupLabel(action: string, held?: boolean): string {
  // Same honesty rule as actionLabel: a floor/target EXIT on a thesis we
  // don't own resolves to DEMOTE at fire time — the plan comes down,
  // nothing is sold. Omitted `held` keeps the historical "Exit if".
  if (action === "EXIT" && held === false) return "Take the plan down if";
  switch (action) {
    case "ENTER":
      return "Buy if";
    case "ADD":
      return "Add if";
    case "TRIM":
      return "Trim if";
    case "MOVE_STOP":
      return "Move stop if";
    case "EXIT":
      return "Exit if";
    case "REVIEW":
    default:
      return "Review if";
  }
}
