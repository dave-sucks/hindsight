"use server";

import { prisma } from "@/lib/prisma";
import { closePosition, getLatestPrice } from "@/lib/alpaca";
import { inngest } from "@/lib/inngest/client";
import { sendEmail, getUserEmail } from "@/lib/email";
import { tradeClosedHtml } from "@/lib/emails/trade-closed";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClosedTradeResult {
  tradeId: string;
  closePrice: number;
  realizedPnl: number;
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
}

// ─── Action ───────────────────────────────────────────────────────────────────

/**
 * Close a paper trade — called by auto-close logic (DAV-33) and manual close button.
 *
 * @param tradeId       Prisma Trade ID
 * @param reason        Why it's being closed
 * @param closePriceOverride  Current price if already known (skips Alpaca lookup)
 */
export async function closeTrade(
  tradeId: string,
  reason: "TARGET" | "STOP" | "TIME" | "MANUAL",
  closePriceOverride?: number
): Promise<ClosedTradeResult> {
  // 1. Load the trade
  const trade = await prisma.trade.findUniqueOrThrow({
    where: { id: tradeId },
  });

  if (trade.status !== "OPEN") {
    throw new Error(`Trade ${tradeId} is not OPEN (status: ${trade.status})`);
  }

  // 2. Close the Alpaca paper position
  let closePrice = closePriceOverride;

  if (!closePrice) {
    try {
      const alpacaOrder = await closePosition(trade.ticker);
      // filled_avg_price may be null if market is closed (order queued)
      closePrice = alpacaOrder.filled_avg_price
        ? parseFloat(alpacaOrder.filled_avg_price)
        : await getLatestPrice(trade.ticker);
    } catch (err: unknown) {
      // Position may not exist on Alpaca (e.g. manual entry) — use latest price
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("404") || msg.includes("position does not exist")) {
        closePrice = await getLatestPrice(trade.ticker);
      } else {
        throw err;
      }
    }
  }

  // 3. Calculate realized P&L
  const realizedPnl =
    trade.direction === "LONG"
      ? (closePrice - trade.entryPrice) * trade.shares
      : (trade.entryPrice - closePrice) * trade.shares;

  // 4. Determine outcome (1% threshold)
  const positionCost = trade.entryPrice * trade.shares;
  const outcome: "WIN" | "LOSS" | "BREAKEVEN" =
    realizedPnl > 0.01 * positionCost
      ? "WIN"
      : realizedPnl < -0.01 * positionCost
        ? "LOSS"
        : "BREAKEVEN";

  // 5. Update Trade record
  await prisma.trade.update({
    where: { id: tradeId },
    data: {
      status: "CLOSED",
      closePrice,
      closeReason: reason,
      realizedPnl,
      outcome,
      closedAt: new Date(),
    },
  });

  // 6. Write CLOSED TradeEvent
  const sign = realizedPnl >= 0 ? "+" : "";
  await prisma.tradeEvent.create({
    data: {
      tradeId,
      eventType: "CLOSED",
      description: `Trade closed (${reason}) at $${closePrice.toFixed(2)}. P&L: ${sign}$${realizedPnl.toFixed(2)} — ${outcome}`,
      priceAt: closePrice,
      pnlAt: realizedPnl,
    },
  });

  // 7. Fire Inngest event for post-trade agent evaluation (DAV-35)
  await inngest.send({ name: "trade/closed", data: { tradeId } });

  // 8. Send trade-closed email alert (fire-and-forget — never crash the action)
  getUserEmail(trade.userId).then((toEmail) => {
    if (!toEmail) return;
    const positionCost = trade.entryPrice * trade.shares;
    const pnlPct = positionCost > 0 ? (realizedPnl / positionCost) * 100 : 0;
    const daysHeld = Math.max(
      1,
      Math.round((Date.now() - new Date(trade.openedAt).getTime()) / 86_400_000)
    );
    const isWin = outcome === "WIN";
    const sign = realizedPnl >= 0 ? "+" : "";
    sendEmail({
      to: toEmail,
      subject: isWin
        ? `✅ ${trade.ticker} closed ${sign}${pnlPct.toFixed(1)}% — WIN`
        : `⛔ ${trade.ticker} closed ${sign}${pnlPct.toFixed(1)}% — ${outcome}`,
      html: tradeClosedHtml({
        ticker: trade.ticker,
        direction: trade.direction as "LONG" | "SHORT",
        entryPrice: trade.entryPrice,
        closePrice,
        realizedPnl,
        realizedPnlPct: pnlPct,
        outcome,
        closeReason: reason,
        daysHeld,
        tradeId,
      }),
    });
  });

  return { tradeId, closePrice, realizedPnl, outcome };
}
