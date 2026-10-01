/**
 * A plan-sanity flag in three words.
 *
 * `PlanSanityFlag.text` is a paragraph written for the agent to act on — "Answer
 * it one of two ways — price the buy at a level you can name (the pivot, the
 * reclaim, the pullback) with its stop and a target at 2:1 or better, or let it
 * go." Correct instruction, wrong reader: it rendered at the top of the thesis
 * sheet, in the same amber as the work flag, telling the principal to go price a
 * buy.
 *
 * The label is what a person needs — WHICH check failed. The paragraph stays on
 * the flag for the agent, and sits under the label for anyone who wants it.
 *
 * Its own module so a client component can import it: plan-sanity.ts reaches the
 * trigger types, and only the label is needed on screen.
 */
const LABELS: Record<string, string> = {
  NOTHING_CAN_WAKE: "Nothing can wake this",
  NO_BUY_LEVEL: "No buy level",
  BUY_INSIDE_CUTOFF: "Buy inside the cutoff",
  ENTRY_FAR_FROM_PRICE: "Buy far from the price",
  ENTRY_STALE: "Buy level is stale",
  ENTRY_RAISED_AWAY: "Buy raised away from the price",
  BUY_FIRED_UNANSWERED: "Buy fired, unanswered",
  TARGET_ALREADY_PASSED: "Target already passed",
  STOP_ALREADY_BREACHED: "Stop already breached",
  STOP_INSIDE_NOISE: "Stop inside daily noise",
  FLOOR_INSIDE_NOISE: "Floor inside daily noise",
  PLAN_BELOW_RR_FLOOR: "Reward below 2:1",
  COMPOSITE_BELOW_MINIMUM: "Score below the minimum",
};

/** The check's name. Falls back to the raw kind rather than inventing one. */
export function planSanityLabel(kind: string): string {
  return LABELS[kind] ?? kind.toLowerCase().replace(/_/g, " ");
}
