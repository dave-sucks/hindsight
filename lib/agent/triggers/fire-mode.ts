/**
 * On fire, the same three choices on every trigger (docs/TRIGGERS.md §4): DO_IT "Auto" (the trade with no
 * agent), ASK_NOW "Send to Agent" (a trigger run now), NEXT_MORNING "Flag for Review" (the morning run). Pure.
 */

import { sentenceOf } from "./condition/describe";

export const FIRE_MODES = ["DO_IT", "ASK_NOW", "NEXT_MORNING"] as const;
export type FireMode = (typeof FIRE_MODES)[number];

export function isFireMode(v: unknown): v is FireMode {
  return typeof v === "string" && (FIRE_MODES as readonly string[]).includes(v);
}

/** Unset, a review is flagged for the morning run and everything else is sent to the agent. Auto is only ever chosen. */
export function defaultFireMode(action: string): FireMode {
  return action === "REVIEW" ? "NEXT_MORNING" : "ASK_NOW";
}

export function fireModeOf(t: { action: string; fireMode?: FireMode | null }): FireMode {
  return t.fireMode ?? defaultFireMode(t.action);
}

/** The trigger with its mode written down: the one it names, else its action's default. */
export function withFireMode<T extends { action: string; fireMode?: FireMode | null }>(t: T): T & { fireMode: FireMode } {
  return { ...t, fireMode: fireModeOf(t) };
}

export const AUTO_REVIEW = "A review asks the agent, so it can't be Auto. Choose Send to Agent or Flag for Review.";
export const AUTO_OWNER_ONLY = "Only the owner can make a buy, add or trim Auto. Use Send to Agent or Flag for Review.";
export const AUTO_STANDING_SALE_ONLY = "Account and analyst rules can be Auto only for a sale. Set Auto on the stock's own trigger.";

/**
 * Why a trigger can't take this mode, or null. `standing`: an account or analyst rule. `agent`: an agent sets
 * it, outside the owner's chat. Auto on a buy, add or trim is a one-time order only the owner places on a stock.
 */
export function fireModeProblem(action: string, mode: FireMode | null | undefined, who: { standing?: boolean; agent?: boolean } = {}): string | null {
  if (mode !== "DO_IT") return null;
  if (action === "REVIEW") return AUTO_REVIEW;
  if (action === "EXIT") return null;
  if (who.standing) return AUTO_STANDING_SALE_ONLY;
  return who.agent ? AUTO_OWNER_ONLY : null;
}

/** The fire waits for the next morning run. A red filing on a stock we hold is looked at the same day whatever is set. */
export function waitsForMorning(t: { action: string; fireMode?: FireMode | null }, sameDayLook = false): boolean {
  return fireModeOf(t) === "NEXT_MORNING" && !sameDayLook;
}

export type DoIt = "SELL" | "TRIM" | "BUY" | "ADD";

/** The trade a trigger set to Auto makes with no agent, or null when the agent is asked (nothing to sell, already held, a review). */
export function doItTrade(t: { action: string; fireMode?: FireMode | null }, held: boolean): DoIt | null {
  if (fireModeOf(t) !== "DO_IT") return null;
  if (t.action === "EXIT" && held) return "SELL";
  if (t.action === "TRIM" && held) return "TRIM";
  if (t.action === "ADD" && held) return "ADD";
  if (t.action === "ENTER" && !held) return "BUY";
  return null;
}

/** How soon a fire is acted on. An agent may not slow a protective sale on a stock we own. */
export const FIRE_MODE_SPEED: Readonly<Record<FireMode, number>> = { DO_IT: 2, ASK_NOW: 1, NEXT_MORNING: 0 };

export { DEFAULT_TRIM_PCT, trimPctOf } from "./condition/describe";

const AUTO: Readonly<Record<string, string>> = { ENTER: "Auto-buy", ADD: "Auto-add", TRIM: "Auto-trim", EXIT: "Auto-sell" };

/** The choice in the dialog: "Auto-sell", "Send to Agent", "Flag for Review". */
export function fireModeLabel(mode: FireMode, action: string): string {
  if (mode === "ASK_NOW") return "Send to Agent";
  if (mode === "NEXT_MORNING") return "Flag for Review";
  return AUTO[action] ?? "Auto";
}

/** The account's approval switch for the trade's side, in a line under On fire; null when nothing waits, or for a review. */
export function approvalLine(
  action: string,
  s: { requireApprovalBuysLive: boolean; requireApprovalSellsLive: boolean; requireApprovalBuysPaper: boolean; requireApprovalSellsPaper: boolean } | null,
): string | null {
  if (!s || action === "REVIEW") return null;
  const buys = action === "ENTER" || action === "ADD";
  const live = buys ? s.requireApprovalBuysLive : s.requireApprovalSellsLive;
  const paper = buys ? s.requireApprovalBuysPaper : s.requireApprovalSellsPaper;
  return live && paper ? "Waits for your approval." : live ? "Waits for your approval on Live." : paper ? "Waits for your approval on Paper." : null;
}

/** The Activity line when an Auto buy, add or trim is used and comes off the stock: "Used once: Trim 30% if above $150 (Auto-trim)". */
export function usedOnceLine(t: { action: string; predicate: unknown; trimPct?: number | null }, held: boolean): string {
  return `Used once: ${sentenceOf(t, held)} (${fireModeLabel("DO_IT", t.action)})`;
}

/** What it does when it fires, as the pill and Activity say it: "Auto-sell", "Auto-trim", "Send to Agent". A trim's size is in its sentence. */
export function fireModeWords(t: { action: string; fireMode?: FireMode | null }, sells = true): string {
  // A sale on a stock we don't own takes the plan down when it fires, whatever is set.
  if (t.action === "EXIT" && !sells) return "Takes the plan down when it fires";
  return fireModeLabel(fireModeOf(t), t.action);
}
