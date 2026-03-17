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

        // Check for existing open position in this ticker
        const existingPosition = await prisma.position.findFirst({
          where: { userId, symbol: ticker, status: "OPEN" },
          select: { id: true },
        });
        if (existingPosition) {
          return { error: `Already holding an open position in ${ticker}. Use add_to_position instead.` };
        }

        // Check max open positions — find a default analyst for chat trades
        const agentConfig = await prisma.agentConfig.findFirst({
          where: { userId, enabled: true },
        });
        if (!agentConfig) {
          return { error: "No analyst configured. Create an analyst first." };
        }
        const maxOpen = agentConfig.maxOpenPositions ?? 5;
        const openCount = await prisma.position.count({
          where: { userId, status: "OPEN" },
        });
        if (openCount >= maxOpen) {
          return { error: `Max open positions reached (${maxOpen}). Close a position first.` };
        }

        // Create a stub run + thesis for the trade
        const stubRun = await prisma.researchRun.create({
          data: {
            userId,
            source: "MANUAL",
            status: "COMPLETE",
            parameters: {},
            completedAt: new Date(),
            ...(agentConfig ? { agentConfigId: agentConfig.id } : {}),
          },
        });

        const thesis = await prisma.thesis.create({
          data: {
            researchRunId: stubRun.id,
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
          const alpacaOrder = await placeMarketOrder({ symbol: ticker, qty: shares, side });
          const fillPrice = await waitForFill(alpacaOrder.id, ticker, currentPrice);

          // Create Position
          const position = await prisma.position.create({
            data: {
              analystId: agentConfig.id,
              userId,
              symbol: ticker,
              direction: side === "buy" ? "LONG" : "SHORT",
              status: "OPEN",
              quantity: shares,
              avgCost: fillPrice,
              targetPrice: targetPrice ?? null,
              stopLoss: stopLoss ?? null,
              exitStrategy: targetPrice ? "PRICE_TARGET" : "MANUAL",
            },
          });

          // Create Order
          await prisma.order.create({
            data: {
              positionId: position.id,
              userId,
              symbol: ticker,
              side: side === "buy" ? "BUY" : "SELL",
              orderType: "MARKET",
              quantity: shares,
              status: "FILLED",
              filledPrice: fillPrice,
              filledQty: shares,
              filledAt: new Date(),
              alpacaOrderId: alpacaOrder.id,
            },
          });

          // Write OPENED PositionEvent
          await prisma.positionEvent.create({
            data: {
              positionId: position.id,
              eventType: "OPENED",
              description: `${side === "buy" ? "LONG" : "SHORT"} ${shares} shares of ${ticker} at $${fillPrice.toFixed(2)} via chat`,
              priceAt: fillPrice,
            },
          });

          return {
            success: true,
            tradeId: position.id,
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
        "Close an open paper trade position. Can identify by ticker symbol or position ID. " +
        "Returns realized P&L and outcome.",
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe("Ticker symbol of the position to close"),
        tradeId: z
          .string()
          .optional()
          .describe("Position ID (alternative to symbol)"),
        reason: z
          .enum(["TARGET", "STOP", "MANUAL"])
          .default("MANUAL")
          .describe("Reason for closing"),
      }),
      execute: async ({ symbol, tradeId, reason }) => {
        // Find the position
        let position;
        if (tradeId) {
          position = await prisma.position.findUnique({ where: { id: tradeId } });
        } else if (symbol) {
          position = await prisma.position.findFirst({
            where: { userId, symbol: symbol.toUpperCase(), status: "OPEN" },
            orderBy: { openedAt: "desc" },
          });
        }

        if (!position) {
          return { error: `No open position found for ${symbol || tradeId}` };
        }
        if (position.status !== "OPEN") {
          return { error: `Position is already ${position.status}` };
        }

        const { closeOpenPosition } = await import("@/lib/actions/closeTrade.actions");
        try {
          const result = await closeOpenPosition(position.id, reason);
          const pnlPct =
            position.avgCost > 0
              ? ((result.closePrice - position.avgCost) / position.avgCost) * 100
              : 0;

          return {
            success: true,
            tradeId: position.id,
            ticker: position.symbol,
            direction: position.direction,
            entryPrice: position.avgCost,
            closePrice: result.closePrice,
            shares: position.quantity,
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
        "Modify stop loss or target price on an open position. Does not change position size.",
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe("Ticker symbol of the position to modify"),
        tradeId: z.string().optional().describe("Position ID (alternative to symbol)"),
        newStop: z.number().optional().describe("New stop loss price"),
        newTarget: z.number().optional().describe("New target price"),
      }),
      execute: async ({ symbol, tradeId, newStop, newTarget }) => {
        let position;
        if (tradeId) {
          position = await prisma.position.findUnique({ where: { id: tradeId } });
        } else if (symbol) {
          position = await prisma.position.findFirst({
            where: { userId, symbol: symbol.toUpperCase(), status: "OPEN" },
            orderBy: { openedAt: "desc" },
          });
        }

        if (!position) {
          return { error: `No open position found for ${symbol || tradeId}` };
        }
        if (position.status !== "OPEN") {
          return { error: `Position is already ${position.status}` };
        }
        if (!newStop && !newTarget) {
          return { error: "Must specify at least one of newStop or newTarget" };
        }

        const updateData: Record<string, unknown> = {};
        if (newStop !== undefined) updateData.stopLoss = newStop;
        if (newTarget !== undefined) updateData.targetPrice = newTarget;

        await prisma.position.update({
          where: { id: position.id },
          data: updateData,
        });

        const changes: string[] = [];
        if (newStop !== undefined)
          changes.push(`stop: $${position.stopLoss?.toFixed(2) ?? "none"} -> $${newStop.toFixed(2)}`);
        if (newTarget !== undefined)
          changes.push(`target: $${position.targetPrice?.toFixed(2) ?? "none"} -> $${newTarget.toFixed(2)}`);

        await prisma.positionEvent.create({
          data: {
            positionId: position.id,
            eventType: "PRICE_CHECK",
            description: `Position modified via chat: ${changes.join(", ")}`,
            priceAt: position.avgCost,
          },
        });

        return {
          success: true,
          tradeId: position.id,
          ticker: position.symbol,
          direction: position.direction,
          stopLoss: newStop ?? position.stopLoss,
          targetPrice: newTarget ?? position.targetPrice,
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

        const position = await prisma.position.findFirst({
          where: { userId, symbol: ticker, status: "OPEN" },
          orderBy: { openedAt: "desc" },
        });
        if (!position) {
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
        const side = position.direction === "LONG" ? "buy" : ("sell" as const);
        try {
          const alpacaOrder = await placeMarketOrder({ symbol: ticker, qty: addShares, side });
          const fillPrice = await waitForFill(alpacaOrder.id, ticker, currentPrice);

          // Update position: recalculate avg cost, add shares
          const oldCost = position.avgCost * position.quantity;
          const newCost = fillPrice * addShares;
          const totalShares = position.quantity + addShares;
          const avgEntry = (oldCost + newCost) / totalShares;

          await prisma.position.update({
            where: { id: position.id },
            data: {
              quantity: totalShares,
              avgCost: Math.round(avgEntry * 100) / 100,
            },
          });

          // Create Order record for the addition
          await prisma.order.create({
            data: {
              positionId: position.id,
              userId,
              symbol: ticker,
              side: position.direction === "LONG" ? "BUY" : "SELL",
              orderType: "MARKET",
              quantity: addShares,
              status: "FILLED",
              filledPrice: fillPrice,
              filledQty: addShares,
              filledAt: new Date(),
              alpacaOrderId: alpacaOrder.id,
            },
          });

          await prisma.positionEvent.create({
            data: {
              positionId: position.id,
              eventType: "OPENED",
              description: `Added ${addShares} shares at $${fillPrice.toFixed(2)} (total: ${totalShares} shares, avg: $${avgEntry.toFixed(2)})`,
              priceAt: fillPrice,
            },
          });

          return {
            success: true,
            tradeId: position.id,
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
