/**
 * Sell orders on one position — whether a sale is already under way, and
 * clearing the sell proposals a sale makes moot.
 *
 * SMMT 2026-09-15 (LIVE): the $17.40 floor and the 8% trail fired on the same
 * check and two runs each staged a full 450-share close 180 ms apart — the old
 * duplicate check was a plain read before the write, so both got past it.
 * `findSaleUnderWay` locks the position row first, so two writers on one
 * position take turns and the second sees the first's order.
 */

import { prisma } from "@/lib/prisma";

type TransactionClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Lock the position row for the rest of the transaction, then return a sell
 * order already under way on it (or null). Call it first inside the
 * transaction that creates or approves a sale — the lock is what makes the
 * check and the write one step.
 */
export async function findSaleUnderWay(
  tx: TransactionClient,
  positionId: string,
  opts: {
    statuses: ("AWAITING_APPROVAL" | "PENDING")[];
    intents: ("CLOSE" | "PARTIAL_CLOSE")[];
    exceptOrderId?: string;
  },
) {
  await tx.$queryRaw`SELECT 1 FROM "Position" WHERE id = ${positionId} FOR NO KEY UPDATE`;
  return tx.order.findFirst({
    where: {
      positionId,
      status: { in: opts.statuses },
      intent: { in: opts.intents },
      ...(opts.exceptOrderId ? { id: { not: opts.exceptOrderId } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, intent: true, expiresAt: true, rationale: true, idempotencyKey: true },
  });
}

/**
 * Cancel every still-AWAITING_APPROVAL CLOSE / PARTIAL_CLOSE on the position
 * except `exceptOrderId`, and log one PositionEvent. Runs inside the caller's
 * transaction; returns how many it cancelled.
 */
export async function cancelSellProposals(
  tx: TransactionClient,
  positionId: string,
  exceptOrderId: string | undefined,
  why: string,
): Promise<number> {
  const { count } = await tx.order.updateMany({
    where: {
      positionId,
      status: "AWAITING_APPROVAL",
      intent: { in: ["CLOSE", "PARTIAL_CLOSE"] },
      ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}),
    },
    data: {
      status: "CANCELLED",
      alpacaConfirmedAt: new Date(),
      rejectionMessage: `Auto-cancelled — ${why}.`,
    },
  });
  if (count > 0) {
    await tx.positionEvent.create({
      data: {
        positionId,
        eventType: "PRICE_CHECK",
        description: `Auto-cancelled ${count} pending sell proposal(s) — ${why}.`,
        priceAt: null,
      },
    });
  }
  return count;
}

/**
 * Cancel orphaned sell proposals on a position that just closed by another
 * path (the price-monitor cron, a tactical run, the user) — there is nothing
 * left to sell (SMTC + MTSI, 2026-06-17).
 *
 * Call this AFTER the close transaction commits (fail-soft side effect, never
 * inside the close tx — a cleanup failure must not roll back a real fill).
 * Idempotent: a no-op when there are no open sell proposals.
 */
export async function cancelOrphanedSellProposals(
  positionId: string,
  /** The order that actually closed the position — never cancel it. */
  exceptOrderId?: string,
): Promise<number> {
  try {
    return await prisma.$transaction((tx) =>
      cancelSellProposals(
        tx,
        positionId,
        exceptOrderId,
        "position closed by another path before this proposal was approved",
      ),
    );
  } catch (err) {
    console.warn(
      `[cancelOrphanedSellProposals] failed for position ${positionId}:`,
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}
