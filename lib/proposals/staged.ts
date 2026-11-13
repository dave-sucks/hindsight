/**
 * How a proposal is staged, and how a read finds one. Pure: imported by the
 * reads that build a stock's Activity and the agents' inputs.
 *
 * A sale or trim a trigger's fire proposed carries the triggers it answers and
 * no deadline: it stays open while they hold (./sale-card.ts). Every other
 * proposal lapses after `PROPOSAL_TTL_MS`.
 */

/** How long a proposal nothing fired waits for the principal before it expires. */
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

/** An order that went through the approval seam: a deadline, or the triggers its card stays open for. */
export const PROPOSED = { OR: [{ expiresAt: { not: null } }, { triggerIds: { isEmpty: false } }] };

const SALE = new Set(["EXIT", "TRIM"]);

/** The sale and trim triggers among a fire and its co-fires: what a sale the run proposes answers. */
export function saleTriggerIds(fired: { id: string; action: string }, coFired: ReadonlyArray<{ triggerId: string }> = []): string[] {
  return SALE.has(fired.action) ? [fired.id, ...coFired.map((c) => c.triggerId)] : [];
}

/** How a sale proposal is staged: a trigger's stays open while the trigger holds; any other lapses in 24 hours. */
export function staged(triggerIds: readonly string[] | undefined, placedAt: Date): { expiresAt: Date | null; triggerIds?: string[] } {
  return triggerIds?.length ? { expiresAt: null, triggerIds: [...triggerIds] } : { expiresAt: new Date(placedAt.getTime() + PROPOSAL_TTL_MS) };
}
