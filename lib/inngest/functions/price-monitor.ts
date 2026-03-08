import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getLatestPrices } from "@/lib/alpaca";
import { isMarketOpen } from "@/lib/market-hours";
import type { TradeModel } from "@/lib/generated/prisma/models";

// ─── P&L helpers ─────────────────────────────────────────────────────────────

function calculatePnl(
  trade: TradeModel,
  currentPrice: number
): { dollars: number; pct: number } {
  const dollars =
    trade.direction === "LONG"
      ? (currentPrice - trade.entryPrice) * trade.shares
      : (trade.entryPrice - currentPrice) * trade.shares;
  const pct =
    trade.direction === "LONG"
      ? ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.entryPrice - currentPrice) / trade.entryPrice) * 100;
  return { dollars, pct };
}

// ─── Exit condition check (stub — filled by DAV-33) ──────────────────────────

/**
 * Check if a trade should be auto-closed based on exit conditions.
 * Stub: always returns false. DAV-33 will implement the full logic.
 */
async function checkExitConditions(
  _trade: TradeModel,
  _currentPrice: number
): Promise<boolean> {
  return false;
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const priceMonitor = inngest.createFunction(
  {
    id: "price-monitor",
    name: "Hourly Price Monitor",
    // Retry config: don't retry price checks (stale data not useful)
    retries: 0,
  },
  { cron: "0 10-20 * * 1-5" }, // every hour, 10am–8pm UTC (covers 9:30–4pm ET + buffer)
  async ({ step }) => {
    // Step 1: Fetch all OPEN trades
    const openTrades = await step.run("fetch-open-trades", async () => {
      return prisma.trade.findMany({ where: { status: "OPEN" } });
    });

    if (openTrades.length === 0) return { checked: 0, reason: "no-open-trades" };

    // Step 2: Skip if market is closed
    const marketOpen = await step.run("check-market-hours", async () => {
      return isMarketOpen();
    });

    if (!marketOpen) {
      return { checked: 0, reason: "market-closed" };
    }

    // Step 3: Batch fetch current prices via Alpaca Data API
    const uniqueTickers = [...new Set(openTrades.map((t) => t.ticker))];

    const priceMap = await step.run("fetch-prices", async () => {
      try {
        return await getLatestPrices(uniqueTickers);
      } catch {
        // If batch fails, return empty — individual steps will handle gracefully
        return {} as Record<string, number>;
      }
    });

    // Step 4: Per-trade price check + exit condition evaluation
    let checked = 0;
    let errors = 0;

    for (const trade of openTrades) {
      await step.run(`check-trade-${trade.id}`, async () => {
        try {
          const currentPrice = priceMap[trade.ticker];
          if (!currentPrice) {
            // Write a note that price was unavailable
            await prisma.tradeEvent.create({
              data: {
                tradeId: trade.id,
                eventType: "PRICE_CHECK",
                description: `Price unavailable for ${trade.ticker}`,
                priceAt: null,
                pnlAt: null,
              },
            });
            return;
          }

          const pnl = calculatePnl(trade, currentPrice);

          // Write PRICE_CHECK event
          await prisma.tradeEvent.create({
            data: {
              tradeId: trade.id,
              eventType: "PRICE_CHECK",
              description: `Price check: $${currentPrice.toFixed(2)} (${pnl.pct >= 0 ? "+" : ""}${pnl.pct.toFixed(1)}%)`,
              priceAt: currentPrice,
              pnlAt: pnl.dollars,
            },
          });

          // Check exit conditions — DAV-33 implements auto-close
          await checkExitConditions(trade, currentPrice);

          checked++;
        } catch {
          // Don't fail the whole batch on one bad trade
          errors++;
        }
      });
    }

    return { checked, errors, total: openTrades.length };
  }
);
