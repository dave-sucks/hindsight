/**
 * Cancel orphaned sell proposals on a position that just closed by another path.
 *
 * The daily-run agent can propose a stop-close (Order → AWAITING_APPROVAL) on a
 * position that, in the same window, the price-monitor cron / a tactical run /
 * the user closes DIRECTLY. The proposed sell is now moot — there is nothing
 * left to sell — but it lingers as an AWAITING_APPROVAL order until its 24h
 * expiry, showing the user a stale "Approve / Reject" card for a position that
 * is already gone (observed on Momentum Breakout's SMTC + MTSI, 2026-06-17).
 *
 * Call this AFTER the close transaction commits (fail-soft side effect, never
 * inside the close tx — a cleanup failure must not roll back a real fill). It
 * flips every still-AWAITING_APPROVAL CLOSE / PARTIAL_CLOSE order on the
 * position to CANCELLED and logs one PositionEvent. Idempotent: a no-op when
 * there are no open sell proposals.
 */

import { prisma } from "@/lib/prisma";

export async function cancelOrphanedSellProposals(
  positionId: string,
  /** The order that actually closed the position — never cancel it. */
  exceptOrderId?: string,
): Promise<number> {
  try {
    const orphans = await prisma.order.findMany({
      where: {
        positionId,
        status: "AWAITING_APPROVAL",
        intent: { in: ["CLOSE", "PARTIAL_CLOSE"] },
        ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}),
      },
      select: { id: true },
    });
    if (orphans.length === 0) return 0;

    const ids = orphans.map((o) => o.id);
    await prisma.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { id: { in: ids } },
        data: {
          status: "CANCELLED",
          alpacaConfirmedAt: new Date(),
          rejectionMessage:
            "Auto-cancelled — position closed by another path before this proposal was approved.",
        },
      });
      await tx.positionEvent.create({
        data: {
          positionId,
          eventType: "PRICE_CHECK",
          description: `Auto-cancelled ${ids.length} pending sell proposal(s) — position closed by another path.`,
          priceAt: null,
        },
      });
    });
    return ids.length;
  } catch (err) {
    console.warn(
      `[cancelOrphanedSellProposals] failed for position ${positionId}:`,
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}
