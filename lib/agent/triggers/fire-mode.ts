/**
 * On fire, the same three choices on every trigger (docs/TRIGGERS.md §4): DO_IT the trade with no
 * analyst, ASK_NOW a trigger run now, NEXT_MORNING the next morning run. Pure and client-safe.
 */

export const FIRE_MODES = ["DO_IT", "ASK_NOW", "NEXT_MORNING"] as const;
export type FireMode = (typeof FIRE_MODES)[number];

export function isFireMode(v: unknown): v is FireMode {
  return typeof v === "string" && (FIRE_MODES as readonly string[]).includes(v);
}

/** Unset, a sale goes right away, a review waits for the morning run, and a buy, an add or a trim asks the analyst now. */
export function defaultFireMode(action: string): FireMode {
  return action === "EXIT" ? "DO_IT" : action === "REVIEW" ? "NEXT_MORNING" : "ASK_NOW";
}

export function fireModeOf(t: { action: string; fireMode?: FireMode | null }): FireMode {
  return t.fireMode ?? defaultFireMode(t.action);
}

/** The trigger with its mode written down: the one it names, else its action's default. */
export function withFireMode<T extends { action: string; fireMode?: FireMode | null }>(t: T): T & { fireMode: FireMode } {
  return { ...t, fireMode: fireModeOf(t) };
}

/** A review is asking the analyst, so it can't be done without one. */
export function canDoIt(action: string): boolean {
  return action !== "REVIEW";
}

export const DO_IT_REVIEW = "A review asks the analyst, so it can't be done right away. Choose Ask the analyst now or At the next morning run.";

/** Why a trigger can't take this mode, or null. */
export function fireModeProblem(action: string, mode: FireMode | null | undefined): string | null {
  return mode === "DO_IT" && !canDoIt(action) ? DO_IT_REVIEW : null;
}

/** The fire waits for the next morning run. A red filing on a stock we hold is looked at the same day whatever is set. */
export function waitsForMorning(t: { action: string; fireMode?: FireMode | null }, sameDayLook = false): boolean {
  return fireModeOf(t) === "NEXT_MORNING" && !sameDayLook;
}

export type DoIt = "SELL" | "TRIM" | "BUY" | "ADD";

/** The trade a trigger set to Do it makes with no analyst, or null when an analyst is asked (nothing to sell, already held, a review). */
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

/** The share of the position a trim set to Do it sells, when the trigger names none: half, as manage_position's trim. */
export const DEFAULT_TRIM_PCT = 50;

export function trimPctOf(t: { trimPct?: number | null }): number {
  return t.trimPct ?? DEFAULT_TRIM_PCT;
}

const VERB: Readonly<Record<string, string>> = { ENTER: "Buy", ADD: "Add", TRIM: "Trim", EXIT: "Sell" };

/** The choice in the dialog: "Sell right away", "Ask the analyst now", "At the next morning run". */
export function fireModeLabel(mode: FireMode, action: string): string {
  if (mode === "ASK_NOW") return "Ask the analyst now";
  if (mode === "NEXT_MORNING") return "At the next morning run";
  return `${VERB[action] ?? "Act"} right away`;
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

const DONE: Readonly<Record<string, string>> ={ ENTER: "Buys", ADD: "Adds", TRIM: "Trims", EXIT: "Sells" };

/** What it does when it fires, in a phrase: "Sells right away", "Trims 30% right away", "Asks the analyst now". */
export function fireModeWords(t: { action: string; fireMode?: FireMode | null; trimPct?: number | null }, sells = true): string {
  const mode = fireModeOf(t);
  // A sale on a stock we don't own takes the plan down when it fires, whatever is set.
  if (t.action === "EXIT" && !sells) return "Takes the plan down when it fires";
  if (mode === "ASK_NOW") return "Asks the analyst now";
  if (mode === "NEXT_MORNING") return "Waits for the next morning run";
  return t.action === "TRIM" ? `Trims ${trimPctOf(t)}% right away` : `${DONE[t.action] ?? "Acts"} right away`;
}
