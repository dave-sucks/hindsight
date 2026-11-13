/**
 * How a proposal is staged, and how a read finds one. Pure: imported by the
 * reads that build a stock's Activity and the agents' inputs.
 *
 * A buy, add, trim or sale a trigger's fire proposed carries the triggers it
 * answers and no deadline: it stays open while they hold
 * (./trigger-proposals.ts). Every other proposal lapses after
 * `PROPOSAL_TTL_MS`.
 */

/** How long a proposal nothing fired waits for the principal before it expires. */
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

/** An order that went through the approval seam: a deadline, or the triggers its proposal stays open for. */
export const PROPOSED = { OR: [{ expiresAt: { not: null } }, { triggerIds: { isEmpty: false } }] };

/** The trade a trigger run woke for, on its stock: a sale (EXIT, TRIM) or a buy (ENTER, ADD), and the triggers it answers. */
export interface FiredTrigger {
  ticker: string;
  side: "SELL" | "BUY";
  triggerIds: string[];
}

const SIDE: Readonly<Record<string, FiredTrigger["side"]>> = { EXIT: "SELL", TRIM: "SELL", ENTER: "BUY", ADD: "BUY" };

/** What a trigger run's trade answers: the fired trigger and its co-fires; none on a review. */
export function firedTrigger(ticker: string, fired: { id: string; action: string }, coFired: ReadonlyArray<{ triggerId: string }> = []): FiredTrigger | undefined {
  const side = SIDE[fired.action];
  return side ? { ticker, side, triggerIds: [fired.id, ...coFired.map((c) => c.triggerId)] } : undefined;
}

/** The triggers a proposal on this stock and side answers, when the run was woken for that trade. */
export function answers(fired: FiredTrigger | undefined, ticker: string, side: FiredTrigger["side"]): string[] | undefined {
  return fired && fired.ticker === ticker && fired.side === side ? fired.triggerIds : undefined;
}

/** How a proposal is staged: a trigger's stays open while the trigger holds; any other lapses in 24 hours. */
export function staged(triggerIds: readonly string[] | undefined, placedAt: Date): { expiresAt: Date | null; triggerIds?: string[] } {
  return triggerIds?.length ? { expiresAt: null, triggerIds: [...triggerIds] } : { expiresAt: new Date(placedAt.getTime() + PROPOSAL_TTL_MS) };
}
