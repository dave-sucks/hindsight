/**
 * place_trade — migrated to defineTool().
 *
 * Places a paper trade on Alpaca and creates Position + Order + PositionEvent
 * + TradeDecision + RunEvent in a single DB transaction.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { placeMarketOrder, getOrder, getLatestPrice, getAccount } from "@/lib/alpaca";

type TransactionClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export const placeTrade = defineTool({
  description:
    "Place a paper trade on Alpaca. The trade will be executed immediately. Requires thesis_id from record_thesis. Will fail if any analyst already holds an open position in this ticker.",
  schema: z.object({
    ticker: z.string(),
    company_name: z.string().optional().describe("Company name from get_stock_data"),
    exchange: z.string().optional().describe("Exchange from get_stock_data, e.g. NASDAQ"),
    direction: z.enum(["LONG", "SHORT"]),
    entry_price: z.number(),
    target_price: z.number(),
    stop_loss: z.number(),
    shares: z.number().describe("Number of shares to buy/sell"),
    thesis_id: z.string().describe("REQUIRED — the thesis_id returned by record_thesis. Every trade must link to a thesis."),
  }),
  ui: "ticker" as const,
  groupId: "execution",

  execute: async (args, ctx) => {
    try {
      // 0. Check for existing open position
      const existingPosition = await prisma.position.findFirst({
        where: { userId: ctx.userId, symbol: args.ticker, status: "OPEN" },
        select: { id: true, symbol: true },
      });

      if (existingPosition) {
        const blockedMsg = `Already holding an open position in ${args.ticker}. Cannot open duplicate positions across analysts.`;
        return {
          summary: `Trade blocked: $${args.ticker} — duplicate position`,
          data: {
            success: false,
            ticker: args.ticker,
            status: "FAILED" as const,
            direction: args.direction,
            message: blockedMsg,
            tickers: [{ ticker: args.ticker, tag: "Failed", summary: blockedMsg, actionIcon: "failed" }],
          },
          sources: [],
        };
      }

      // 1. Place Alpaca paper order
      const alpacaOrder = await placeMarketOrder({
        symbol: args.ticker,
        qty: args.shares,
        side: args.direction === "LONG" ? "buy" : "sell",
      }, ctx.alpacaCreds);

      // 2. Wait for fill (max 5s)
      let fillPrice = args.entry_price;
      let didFill = false;
      let filledAt: Date | null = null;
      const placedAt = new Date();
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const order = await getOrder(alpacaOrder.id, ctx.alpacaCreds);
        if (order.status === "filled" && order.filled_avg_price) {
          fillPrice = parseFloat(order.filled_avg_price);
          didFill = true;
          filledAt = order.filled_at ? new Date(order.filled_at) : new Date();
          break;
        }
        if (["cancelled", "expired", "rejected"].includes(order.status)) {
          throw new Error(`Alpaca order ${order.status}`);
        }
        await new Promise((r) => setTimeout(r, 1_000));
      }
      if (!didFill) {
        try { fillPrice = await getLatestPrice(args.ticker, ctx.alpacaCreds); } catch { /* keep entry_price */ }
      }

      // 3. Create Position + Order + PositionEvent + TradeDecision + RunEvent
      const analystId = ctx.analystId;
      if (!analystId) {
        throw new Error("Cannot place trade without an analyst ID. Ensure the run is linked to an analyst.");
      }

      const { position, order } = await prisma.$transaction(async (tx: TransactionClient) => {
        const pos = await tx.position.create({
          data: {
            analystId,
            userId: ctx.userId,
            symbol: args.ticker,
            direction: args.direction,
            status: "OPEN",
            quantity: args.shares,
            avgCost: fillPrice,
            targetPrice: args.target_price,
            stopLoss: args.stop_loss,
            exitStrategy: "PRICE_TARGET",
          },
        });

        const ord = await tx.order.create({
          data: {
            positionId: pos.id,
            userId: ctx.userId,
            symbol: args.ticker,
            side: args.direction === "LONG" ? "BUY" : "SELL",
            orderType: "MARKET",
            quantity: args.shares,
            status: didFill ? "FILLED" : "PENDING",
            filledPrice: didFill ? fillPrice : null,
            filledQty: didFill ? args.shares : null,
            filledAt: didFill ? (filledAt ?? new Date()) : null,
            alpacaOrderId: alpacaOrder.id,
            createdAt: placedAt,
          },
        });

        await tx.positionEvent.create({
          data: {
            positionId: pos.id,
            eventType: "OPENED",
            description: `${args.direction} ${args.shares} shares of ${args.ticker} at $${fillPrice.toFixed(2)}`,
            priceAt: fillPrice,
          },
        });

        await tx.tradeDecision.create({
          data: {
            runId: ctx.runId,
            analystId,
            userId: ctx.userId,
            symbol: args.ticker,
            decision: "INITIATE",
            reasoning: `${args.direction} ${args.shares} shares at $${fillPrice.toFixed(2)} (target: $${args.target_price.toFixed(2)}, stop: $${args.stop_loss.toFixed(2)})`,
            thesisId: args.thesis_id,
            positionId: pos.id,
            orderId: ord.id,
          },
        });

        if (ctx.runId) {
          await tx.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "trade_placed",
              title: `Trade placed: ${args.direction} ${args.ticker}`,
              message: `${args.direction} ${args.shares} shares of ${args.ticker} at $${fillPrice.toFixed(2)}`,
              payload: {
                ticker: args.ticker,
                direction: args.direction,
                entry: fillPrice,
                target_price: args.target_price,
                stop_loss: args.stop_loss,
                shares: args.shares,
                position_id: pos.id,
                order_id: ord.id,
              } as object,
            },
          });
        }

        return { position: pos, order: ord };
      });

      // Graduate watchlist item (non-fatal)
      try {
        const watchlistItem = await prisma.analystWatchlistItem.findFirst({
          where: { analystId, symbol: args.ticker.toUpperCase(), status: "ACTIVE" },
        });
        if (watchlistItem) {
          await prisma.analystWatchlistItem.update({
            where: { id: watchlistItem.id },
            data: { status: "GRADUATED", removeReason: "Promoted to active position", removedAt: new Date(), promotedToPositionId: position.id },
          });
          const activeItems = await prisma.analystWatchlistItem.findMany({
            where: { analystId, status: "ACTIVE" },
            select: { symbol: true },
          });
          await prisma.agentConfig.update({
            where: { id: analystId },
            data: { watchlist: activeItems.map((i) => i.symbol) },
          });
        }
      } catch (err) {
        console.warn(`[tool] place_trade watchlist graduation failed:`, err instanceof Error ? err.message : err);
      }

      // Fetch post-trade portfolio context (non-fatal)
      let portfolioUpdate: { remainingSlots: number; remainingBuyingPower: number; openPositionCount: number } | null = null;
      try {
        const currentOpenCount = await prisma.position.count({ where: { analystId, status: "OPEN" } });
        const postAccount = await getAccount(ctx.alpacaCreds);
        portfolioUpdate = {
          remainingSlots: (ctx.maxOpenPositions ?? 5) - currentOpenCount,
          remainingBuyingPower: parseFloat(postAccount.buying_power),
          openPositionCount: currentOpenCount,
        };
      } catch (portfolioErr) {
        console.warn("[tool] place_trade portfolio update fetch failed:", portfolioErr);
      }

      const message = didFill
        ? `${args.direction} ${args.shares} shares of ${args.ticker} filled at $${fillPrice.toFixed(2)}`
        : `${args.direction} ${args.shares} shares of ${args.ticker} submitted to Alpaca — awaiting fill (current price $${fillPrice.toFixed(2)})`;

      const tickerTag = args.direction === "LONG" ? "Long" : "Short";
      const tickerSummary = didFill
        ? `Placed ${args.direction} ${args.shares} shares @ $${fillPrice.toFixed(2)} — target $${args.target_price.toFixed(2)}, stop $${args.stop_loss.toFixed(2)}`
        : `Order submitted (pending): ${args.direction} ${args.shares} shares @ $${fillPrice.toFixed(2)}`;

      return {
        summary: didFill
          ? `Placed order: ${args.direction} ${args.shares} $${args.ticker} @ $${fillPrice.toFixed(2)}`
          : `Order submitted (pending): ${args.direction} ${args.shares} $${args.ticker}`,
        data: {
          success: true,
          ticker: args.ticker,
          status: didFill ? ("FILLED" as const) : ("PENDING" as const),
          fillStatus: didFill ? ("FILLED" as const) : ("PENDING" as const),
          direction: args.direction,
          shares: args.shares,
          entryPrice: fillPrice,
          targetPrice: args.target_price,
          stopLoss: args.stop_loss,
          positionId: position.id,
          orderId: order.id,
          alpacaOrderId: alpacaOrder.id,
          placedAt: placedAt.toISOString(),
          filledAt: filledAt ? filledAt.toISOString() : null,
          message,
          ...(portfolioUpdate ? { portfolioUpdate } : {}),
          tickers: [{ ticker: args.ticker, tag: tickerTag, summary: tickerSummary, actionIcon: "buy" }],
        },
        sources: [{ provider: "Alpaca", title: `Trade ${args.ticker}` }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Trade placement failed";
      console.error(`[tool] place_trade FAILED for ${args.ticker}: ${msg}`);
      return {
        summary: `Trade failed: $${args.ticker}`,
        data: {
          success: false,
          ticker: args.ticker,
          status: "FAILED" as const,
          direction: args.direction,
          message: msg,
          tickers: [{ ticker: args.ticker, tag: "Failed", summary: msg, actionIcon: "failed" }],
        },
        sources: [],
      };
    }
  },
});
