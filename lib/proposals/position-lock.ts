/**
 * The position lock, and what it protects: how much of a position can still
 * be sold or bought, and the sell proposals a sale makes moot.
 *
 * SMMT 2026-09-15 (LIVE): the $17.40 floor and the 8% trail fired on the same
 * check and two runs each staged a full 450-share close 180 ms apart — the old
 * duplicate check was a plain read before the write, so both got past it.
 * `lockPositionSales` locks the position row first, so two writers on one
 * position take turns and the second sees the first's order.
 */

import { prisma } from "@/lib/prisma";

type TransactionClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Lock the position row for the rest of the transaction, then read what can
 * still be sold: the shares held (0 unless OPEN), the sells already sent to
 * Alpaca (PENDING) and a full close waiting for approval. `sellable` is held
 * minus the shares in sent trims; a sent full close leaves nothing. Call it
 * first inside every transaction that queues, sizes or approves a sale — the
 * lock is what makes the read and the write one step.
 *
 * A trim is a plain market sell (closePositionPartial), same as a full close,
 * so either one sized past what is held opens a short on a margin account.
 */
export async function lockPositionRow(
  tx: TransactionClient,
  positionId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Position" WHERE id = ${positionId} FOR NO KEY UPDATE`;
}

export async function lockPositionSales(
  tx: TransactionClient,
  positionId: string,
  exceptOrderId?: string,
) {
  await lockPositionRow(tx, positionId);
  const position = await tx.position.findUnique({
    where: { id: positionId },
    select: { status: true, quantity: true },
  });
  const open = await tx.order.findMany({
    where: {
      positionId,
      status: { in: ["PENDING", "AWAITING_APPROVAL"] },
      intent: { in: ["CLOSE", "PARTIAL_CLOSE"] },
      ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, intent: true, quantity: true, expiresAt: true, rationale: true, idempotencyKey: true },
  });
  const sent = open.filter((o) => o.status === "PENDING");
  const sentClose = sent.find((o) => o.intent === "CLOSE") ?? null;
  const sentTrims = sent.filter((o) => o.intent === "PARTIAL_CLOSE");
  const held = position?.status === "OPEN" ? position.quantity : 0;
  const inSentTrims = sentTrims.reduce((n, o) => n + o.quantity, 0);
  return {
    held,
    sellable: sentClose ? 0 : Math.max(0, held - inSentTrims),
    sentClose,
    sentTrim: sentTrims[0] ?? null,
    waitingClose:
      open.find((o) => o.status === "AWAITING_APPROVAL" && o.intent === "CLOSE") ?? null,
  };
}

/**
 * Cancel the still-AWAITING_APPROVAL sell proposals on a position that a sale
 * made moot — it closed by another path (the price-monitor cron, a tactical
 * run, the user; SMTC + MTSI, 2026-06-17), or Alpaca just accepted an approved
 * full close of it.
 *
 * Call this AFTER the sale is committed / accepted (fail-soft side effect — a
 * cleanup failure must not undo a real sale). Idempotent: a no-op when there
 * are no open sell proposals.
 */
export async function cancelOrphanedSellProposals(
  positionId: string,
  /** The order that actually sold — never cancel it. */
  exceptOrderId?: string,
  why = "position closed by another path before this proposal was approved",
): Promise<number> {
  try {
    return await prisma.$transaction(async (tx) => {
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
    });
  } catch (err) {
    console.warn(
      `[cancelOrphanedSellProposals] failed for position ${positionId}:`,
      err instanceof Error ? err.message : err,
    );
    return 0;
  }
}

/**
 * Under the position lock: what this analyst already has in this stock — the
 * value of the shares held, at cost, and the shares in adds already sent to
 * Alpaca and not yet filled. The "most in one stock" limit is checked against
 * this at approval, because two adds queued while both fit can stop fitting
 * once one of them is sent (DAV-283).
 *
 * Held shares are valued at cost, the way the limit is checked when an add is
 * queued. Shares still being bought are the caller's to value — at the live
 * price, which is what they will actually cost.
 */
export async function lockPositionBuys(
  tx: TransactionClient,
  positionId: string,
  exceptOrderId?: string,
) {
  await lockPositionRow(tx, positionId);
  const position = await tx.position.findUnique({
    where: { id: positionId },
    select: { status: true, quantity: true, avgCost: true, analystId: true },
  });
  // Adds only: a position's own opening buy is already in its share count,
  // so counting that order too would charge the same shares twice.
  const sent = await tx.order.findMany({
    where: {
      positionId,
      status: "PENDING",
      intent: "ADD",
      ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}),
    },
    select: { quantity: true },
  });
  const costPrice = position?.avgCost ?? 0;
  const held = position && position.status !== "CLOSED" ? position.quantity : 0;
  return {
    costPrice,
    analystId: position?.analystId ?? null,
    heldValue: held * costPrice,
    sentShares: sent.reduce((n, o) => n + o.quantity, 0),
  };
}
