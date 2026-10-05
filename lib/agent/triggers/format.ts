/**
 * Where a trigger lives, in words, for the popover of an inherited rule. The
 * trigger itself reads off the measure catalog (condition/describe.ts:
 * `sentenceOf`, "Sell if below $868"), the same words on the pill, in the
 * Activity feed and in what the agents read.
 *
 * Pure, safe to import anywhere.
 */

import { sentenceOf } from "./condition/describe";

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
  level: "THESIS" | "ANALYST" | "ACCOUNT" | undefined,
  analystName?: string | null,
): string {
  switch (level) {
    case "ANALYST":
      return analystName
        ? `Set on ${analystName} — applies to every thesis it covers`
        : "Set on this analyst — applies to every thesis it covers";
    case "ACCOUNT":
      return "Set account-wide — applies to every analyst";
    case "THESIS":
    default:
      return "Set on this thesis";
  }
}

/**
 * Short label for the level chip on an inherited rung's popover.
 */
export function levelBadgeLabel(
  level: "THESIS" | "ANALYST" | "ACCOUNT" | undefined,
): string {
  switch (level) {
    case "ANALYST":
      return "Analyst";
    case "ACCOUNT":
      return "Account";
    case "THESIS":
    default:
      return "This thesis";
  }
}

/**
 * A trigger as the agents read it: its id (what an edit names) and the
 * sentence on its pill, with why it was set and how it fires. The condition
 * itself is never sent as data: the sentence is the one vocabulary.
 */
export function triggerForAgent(
  t: { id: string; action: string; predicate: unknown; rationale?: string; fireMode?: string; lastFiredAt?: string; source?: string; cooldownDays?: number },
  sells: boolean,
) {
  return {
    id: t.id,
    says: sentenceOf(t, sells),
    ...(t.rationale ? { rationale: t.rationale } : {}),
    ...(t.fireMode === "DIRECT" ? { firesDirectly: true } : {}),
    ...(t.cooldownDays != null ? { cooldownDays: t.cooldownDays } : {}),
    ...(t.lastFiredAt ? { lastFiredAt: t.lastFiredAt } : {}),
    ...(t.source ? { setBy: t.source } : {}),
  };
}
