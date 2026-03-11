/**
 * Trading chat tools — DAV-126
 *
 * place_trade, close_position, modify_position, add_to_position
 *
 * Each tool returns structured data for TradeCard rendering in chat.
 * Trade actions require user confirmation via AI Elements Confirmation component
 * (handled by the frontend — tools here just execute).
 */
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  placeMarketOrder,
  getLatestPrice,
  getOrder,
} from "@/lib/alpaca";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForFill(
  orderId: string,
  symbol: string,
  fallbackPrice: number,
  maxMs = 10_000
): Promise<number> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const order = await getOrder(orderId);
    if (order.status === "filled" && order.filled_avg_price) {
      return parseFloat(order.filled_avg_price);
    }
    if (["cancelled", "expired", "rejected"].includes(order.status)) {
      throw new Error(`Order ${order.status}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  try {
    return await getLatestPrice(symbol);
  } catch {
    return fallbackPrice;
  }
}

// ─── Tool factories ──────────────────────────────────────────────────────────

/**
 * Creates trading tools bound to the current user.
 * Must be called per-request with authenticated userId.
 */
export function createTradingTools(userId: string) {
  return {
    place_trade: tool({
      description:
        "Place a new paper trade via Alpaca. Requires a symbol and either a share quantity or dollar amount. " +
        "The agent must confirm the trade details with the user before calling this tool.",
      inputSchema: z.object({
        symbol: z.string().describe("Stock ticker symbol (e.g. NVDA, AAPL)"),
        side: z.enum(["buy", "sell"]).describe("buy = go long, sell = short sell"),
        qty: z.number().optional().describe("Number of shares to trade"),
        dollarAmount: z
          .number()
          .optional()
          .describe("Dollar amount to invest (alternative to qty)"),
        targetPrice: z.number().optional().describe("Target exit price"),
        stopLoss: z.number().optional().describe("Stop loss price"),
      }),
      execute: async ({ symbol, side, qty, dollarAmount, targetPrice, stopLoss }) => {
        const ticker = symbol.toUpperCase();

        // Resolve share count from dollar amount if needed
        let shares = qty;
        let currentPrice: number;
        try {
          currentPrice = await getLatestPrice(ticker);
        } catch {
          return { error: `Could not get price for ${ticker}. Is it a valid US equity?` };
        }

        if (!shares && dollarAmount) {
          shares = Math.floor(dollarAmount / currentPrice);
          if (shares < 1) {
            return { error: `$${dollarAmount} is not enough to buy 1 share of ${ticker} at $${currentPrice.toFixed(2)}` };
          }
        }
        if (!shares || shares < 1) {
          return { error: "Must specify qty or dollarAmount" };
        }

        // Check max open positions
        const agentConfig = await prisma.agentConfig.findFirst({
          where: { userId, enabled: true },
        });
        const maxOpen = agentConfig?.maxOpenPositions ?? 5;
        const openCount = await prisma.trade.count({
          where: { userId, status: "OPEN" },
        });
        if (openCount >= maxOpen) {
          return { error: `Max open positions reached (${maxOpen}). Close a position first.` };
        }

        // Create a stub thesis for the trade
        const thesis = await prisma.thesis.create({
          data: {
            userId,
            ticker,
            source: "MANUAL",
            direction: side === "buy" ? "LONG" : "SHORT",
            entryPrice: currentPrice,
            targetPrice: targetPrice ?? null,
            stopLoss: stopLoss ?? null,
            holdDuration: "SWING",
            confidenceScore: 0,
            reasoningSummary: "Trade placed via chat",
            thesisBullets: [],
            riskFlags: [],
            signalTypes: [],
            sourcesUsed: [],
            modelUsed: "chat-tool",
          },
        });

        // Place Alpaca order
        try {
          const order = await placeMarketOrder({ symbol: ticker, qty: shares, side });
          const fillPrice = await waitForFill(order.id, ticker, currentPrice);

          // Write Trade + TradeEvent
          const trade = await prisma.trade.create({
            data: {
              thesisId: thesis.id,
              userId,
              ticker,
              direction: side === "buy" ? "LONG" : "SHORT",
              status: "OPEN",
              entryPrice: fillPrice,
              shares,
              targetPrice: targetPrice ?? null,
              stopLoss: stopLoss ?? null,
              exitStrategy: targetPrice ? "PRICE_TARGET" : "MANUAL",
              alpacaOrderId: order.id,
              notes: "Placed via chat tool",
            },
          });

          await prisma.tradeEvent.create({
            data: {
              tradeId: trade.id,
              eventType: "PLACED",
              description: `${side === "buy" ? "LONG" : "SHORT"} ${shares} shares of ${ticker} at $${fillPrice.toFixed(2)} via chat`,
              priceAt: fillPrice,
            },
          });

          return {
            success: true,
            tradeId: trade.id,
            ticker,
            direction: side === "buy" ? "LONG" : "SHORT",
            shares,
            fillPrice,
            targetPrice: targetPrice ?? null,
            stopLoss: stopLoss ?? null,
            totalCost: fillPrice * shares,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Order failed" };
        }
      },
    }),

    close_position: tool({
      description:
        "Close an open paper trade position. Can identify by ticker symbol or trade ID. " +
        "Returns realized P&L and outcome.",
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe("Ticker symbol of the position to close"),
        tradeId: z
          .string()
          .optional()
          .describe("Prisma Trade ID (alternative to symbol)"),
        reason: z
          .enum(["TARGET", "STOP", "MANUAL"])
          .default("MANUAL")
          .describe("Reason for closing"),
      }),
      execute: async ({ symbol, tradeId, reason }) => {
        // Find the trade
        let trade;
        if (tradeId) {
          trade = await prisma.trade.findUnique({ where: { id: tradeId } });
        } else if (symbol) {
          trade = await prisma.trade.findFirst({
            where: { userId, ticker: symbol.toUpperCase(), status: "OPEN" },
            orderBy: { openedAt: "desc" },
          });
        }

        if (!trade) {
          return { error: `No open position found for ${symbol || tradeId}` };
        }
        if (trade.status !== "OPEN") {
          return { error: `Trade is already ${trade.status}` };
        }

        // Use server action logic inline (can't call "use server" from tool)
        const { closeTrade } = await import("@/lib/actions/closeTrade.actions");
        try {
          const result = await closeTrade(trade.id, reason);
          const pnlPct =
            trade.entryPrice > 0
              ? ((result.closePrice - trade.entryPrice) / trade.entryPrice) * 100
              : 0;

          return {
            success: true,
            tradeId: trade.id,
            ticker: trade.ticker,
            direction: trade.direction,
            entryPrice: trade.entryPrice,
            closePrice: result.closePrice,
            shares: trade.shares,
            realizedPnl: result.realizedPnl,
            pnlPct: Math.round(pnlPct * 100) / 100,
            outcome: result.outcome,
            reason,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Close failed" };
        }
      },
    }),

    modify_position: tool({
      description:
        "Modify stop loss or target price on an open trade. Does not change position size.",
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe("Ticker symbol of the position to modify"),
        tradeId: z.string().optional().describe("Trade ID (alternative to symbol)"),
        newStop: z.number().optional().describe("New stop loss price"),
        newTarget: z.number().optional().describe("New target price"),
      }),
      execute: async ({ symbol, tradeId, newStop, newTarget }) => {
        let trade;
        if (tradeId) {
          trade = await prisma.trade.findUnique({ where: { id: tradeId } });
        } else if (symbol) {
          trade = await prisma.trade.findFirst({
            where: { userId, ticker: symbol.toUpperCase(), status: "OPEN" },
            orderBy: { openedAt: "desc" },
          });
        }

        if (!trade) {
          return { error: `No open position found for ${symbol || tradeId}` };
        }
        if (trade.status !== "OPEN") {
          return { error: `Trade is already ${trade.status}` };
        }
        if (!newStop && !newTarget) {
          return { error: "Must specify at least one of newStop or newTarget" };
        }

        const updateData: Record<string, unknown> = {};
        if (newStop !== undefined) updateData.stopLoss = newStop;
        if (newTarget !== undefined) updateData.targetPrice = newTarget;

        await prisma.trade.update({
          where: { id: trade.id },
          data: updateData,
        });

        const changes: string[] = [];
        if (newStop !== undefined)
          changes.push(`stop: $${trade.stopLoss?.toFixed(2) ?? "none"} -> $${newStop.toFixed(2)}`);
        if (newTarget !== undefined)
          changes.push(`target: $${trade.targetPrice?.toFixed(2) ?? "none"} -> $${newTarget.toFixed(2)}`);

        await prisma.tradeEvent.create({
          data: {
            tradeId: trade.id,
            eventType: "PRICE_CHECK",
            description: `Position modified via chat: ${changes.join(", ")}`,
            priceAt: trade.entryPrice,
          },
        });

        return {
          success: true,
          tradeId: trade.id,
          ticker: trade.ticker,
          direction: trade.direction,
          stopLoss: newStop ?? trade.stopLoss,
          targetPrice: newTarget ?? trade.targetPrice,
          changes,
        };
      },
    }),

    add_to_position: tool({
      description:
        "Add more shares to an existing open position. Specify additional shares or a dollar amount.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol of existing position"),
        qty: z.number().optional().describe("Additional shares to buy"),
        dollarAmount: z
          .number()
          .optional()
          .describe("Dollar amount to add (alternative to qty)"),
      }),
      execute: async ({ symbol, qty, dollarAmount }) => {
        const ticker = symbol.toUpperCase();

        const trade = await prisma.trade.findFirst({
          where: { userId, ticker, status: "OPEN" },
          orderBy: { openedAt: "desc" },
        });
        if (!trade) {
          return { error: `No open position in ${ticker}` };
        }

        let currentPrice: number;
        try {
          currentPrice = await getLatestPrice(ticker);
        } catch {
          return { error: `Could not get price for ${ticker}` };
        }

        let addShares = qty;
        if (!addShares && dollarAmount) {
          addShares = Math.floor(dollarAmount / currentPrice);
          if (addShares < 1) {
            return { error: `$${dollarAmount} is not enough for 1 share at $${currentPrice.toFixed(2)}` };
          }
        }
        if (!addShares || addShares < 1) {
          return { error: "Must specify qty or dollarAmount" };
        }

        // Place additional order
        const side = trade.direction === "LONG" ? "buy" : ("sell" as const);
        try {
          const order = await placeMarketOrder({ symbol: ticker, qty: addShares, side });
          const fillPrice = await waitForFill(order.id, ticker, currentPrice);

          // Update trade: recalculate avg entry, add shares
          const oldCost = trade.entryPrice * trade.shares;
          const newCost = fillPrice * addShares;
          const totalShares = trade.shares + addShares;
          const avgEntry = (oldCost + newCost) / totalShares;

          await prisma.trade.update({
            where: { id: trade.id },
            data: {
              shares: totalShares,
              entryPrice: Math.round(avgEntry * 100) / 100,
            },
          });

          await prisma.tradeEvent.create({
            data: {
              tradeId: trade.id,
              eventType: "PLACED",
              description: `Added ${addShares} shares at $${fillPrice.toFixed(2)} (total: ${totalShares} shares, avg: $${avgEntry.toFixed(2)})`,
              priceAt: fillPrice,
            },
          });

          return {
            success: true,
            tradeId: trade.id,
            ticker,
            addedShares: addShares,
            fillPrice,
            totalShares,
            avgEntryPrice: Math.round(avgEntry * 100) / 100,
            totalCost: Math.round(avgEntry * totalShares * 100) / 100,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Order failed" };
        }
      },
    }),
  };
}
