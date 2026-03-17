"use server";

import { prisma } from "@/lib/prisma";
import { closePosition as closeAlpacaPosition, getLatestPrice, cancelOrder } from "@/lib/alpaca";
import { inngest } from "@/lib/inngest/client";
import { sendEmail, getUserEmail } from "@/lib/email";
import { tradeClosedHtml } from "@/lib/emails/trade-closed";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClosedPositionResult {
  positionId: string;
  closePrice: number;
  realizedPnl: number;
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
}

// ─── Action ───────────────────────────────────────────────────────────────────

/**
 * Close an open position — called by auto-close logic and manual close button.
 *
 * @param positionId      Prisma Position ID
 * @param reason          Why it's being closed
 * @param closePriceOverride  Current price if already known (skips Alpaca lookup)
 */
export async function closeOpenPosition(
  positionId: string,
  reason: "TARGET" | "STOP" | "TIME" | "MANUAL",
  closePriceOverride?: number
): Promise<ClosedPositionResult> {
  // 1. Load the position
  const position = await prisma.position.findUniqueOrThrow({
    where: { id: positionId },
  });

  if (position.status !== "OPEN") {
    throw new Error(`Position ${positionId} is not OPEN (status: ${position.status})`);
  }

  // 2. Close the Alpaca paper position
  let closePrice = closePriceOverride;

  if (!closePrice) {
    try {
      const alpacaOrder = await closeAlpacaPosition(position.symbol);
      closePrice = alpacaOrder.filled_avg_price
        ? parseFloat(alpacaOrder.filled_avg_price)
        : await getLatestPrice(position.symbol);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("404") || msg.includes("position does not exist")) {
        closePrice = await getLatestPrice(position.symbol);
      } else {
        throw err;
      }
    }
  }

  // 3. Calculate realized P&L
  const realizedPnl =
    position.direction === "LONG"
      ? (closePrice - position.avgCost) * position.quantity
      : (position.avgCost - closePrice) * position.quantity;

  // 4. Determine outcome (1% threshold)
  const positionCost = position.avgCost * position.quantity;
  const outcome: "WIN" | "LOSS" | "BREAKEVEN" =
    realizedPnl > 0.01 * positionCost
      ? "WIN"
      : realizedPnl < -0.01 * positionCost
        ? "LOSS"
        : "BREAKEVEN";

  // 5. Create closing sell Order
  await prisma.order.create({
    data: {
      positionId,
      userId: position.userId,
      symbol: position.symbol,
      side: position.direction === "LONG" ? "SELL" : "BUY",
      orderType: "MARKET",
      quantity: position.quantity,
      status: "FILLED",
      filledPrice: closePrice,
      filledQty: position.quantity,
      filledAt: new Date(),
    },
  });

  // 6. Update Position record
  await prisma.position.update({
    where: { id: positionId },
    data: {
      status: "CLOSED",
      closePrice,
      closeReason: reason,
      realizedPnl,
      outcome,
      closedAt: new Date(),
    },
  });

  // 7. Write CLOSED PositionEvent
  const sign = realizedPnl >= 0 ? "+" : "";
  await prisma.positionEvent.create({
    data: {
      positionId,
      eventType: "CLOSED",
      description: `Position closed (${reason}) at $${closePrice.toFixed(2)}. P&L: ${sign}$${realizedPnl.toFixed(2)} — ${outcome}`,
      priceAt: closePrice,
      pnlAt: realizedPnl,
    },
  });

  // 8. Fire Inngest event for post-trade agent evaluation
  await inngest.send({ name: "trade/closed", data: { positionId } });

  // 9. Send trade-closed email alert (fire-and-forget)
  getUserEmail(position.userId).then((toEmail) => {
    if (!toEmail) return;
    const pnlPct = positionCost > 0 ? (realizedPnl / positionCost) * 100 : 0;
    const daysHeld = Math.max(
      1,
      Math.round((Date.now() - new Date(position.openedAt).getTime()) / 86_400_000)
    );
    const isWin = outcome === "WIN";
    const sign = realizedPnl >= 0 ? "+" : "";
    sendEmail({
      to: toEmail,
      subject: isWin
        ? `✅ ${position.symbol} closed ${sign}${pnlPct.toFixed(1)}% — WIN`
        : `⛔ ${position.symbol} closed ${sign}${pnlPct.toFixed(1)}% — ${outcome}`,
      html: tradeClosedHtml({
        ticker: position.symbol,
        direction: position.direction as "LONG" | "SHORT",
        entryPrice: position.avgCost,
        closePrice,
        realizedPnl,
        realizedPnlPct: pnlPct,
        outcome,
        closeReason: reason,
        daysHeld,
        tradeId: positionId, // Use position ID for trade link
      }),
    });
  });

  return { positionId, closePrice, realizedPnl, outcome };
}

// ─── Cancel Position (pending orders that haven't been filled) ───────────────

export async function cancelPosition(positionId: string): Promise<void> {
  const position = await prisma.position.findUniqueOrThrow({
    where: { id: positionId },
  });

  if (position.status !== "OPEN") {
    throw new Error(`Position ${positionId} is not OPEN (status: ${position.status})`);
  }

  // Cancel any pending Alpaca orders
  const pendingOrders = await prisma.order.findMany({
    where: { positionId, status: "PENDING" },
    select: { alpacaOrderId: true },
  });
  for (const order of pendingOrders) {
    if (order.alpacaOrderId) {
      try {
        await cancelOrder(order.alpacaOrderId);
      } catch {
        // Order may already be filled or cancelled
      }
    }
  }

  await prisma.position.update({
    where: { id: positionId },
    data: {
      status: "CANCELLED",
      closedAt: new Date(),
      closeReason: "MANUAL",
      realizedPnl: 0,
    },
  });

  await prisma.positionEvent.create({
    data: {
      positionId,
      eventType: "CLOSED",
      description: `Position cancelled manually.`,
      priceAt: position.avgCost,
      pnlAt: 0,
    },
  });
}

// ─── Legacy aliases (for old code paths during migration) ────────────────────

export type ClosedTradeResult = ClosedPositionResult;

export async function closeTrade(
  tradeId: string,
  reason: "TARGET" | "STOP" | "TIME" | "MANUAL",
  closePriceOverride?: number
): Promise<ClosedPositionResult> {
  return closeOpenPosition(tradeId, reason, closePriceOverride);
}

export async function cancelTrade(tradeId: string): Promise<void> {
  return cancelPosition(tradeId);
}
