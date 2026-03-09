import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getLatestPrices } from "@/lib/alpaca";

// ─── P&L helper ───────────────────────────────────────────────────────────────

function calcPnlPct(
  direction: string,
  entryPrice: number,
  currentPrice: number
): number {
  if (direction === "LONG") return ((currentPrice - entryPrice) / entryPrice) * 100;
  return ((entryPrice - currentPrice) / entryPrice) * 100; // SHORT inverted
}

function calcPnlDollars(
  direction: string,
  entryPrice: number,
  currentPrice: number,
  shares: number
): number {
  if (direction === "LONG") return (currentPrice - entryPrice) * shares;
  return (entryPrice - currentPrice) * shares;
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const eodEvaluation = inngest.createFunction(
  {
    id: "eod-evaluation",
    name: "EOD Evaluation Cron",
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: "0 22 * * 1-5" }, // 5 PM ET = 22:00 UTC Mon–Fri
  async ({ step }) => {
    // Step 1: Load all open trades
    const openTrades = await step.run("load-open-trades", async () => {
      return prisma.trade.findMany({
        where: { status: "OPEN" },
        select: {
          id: true,
          ticker: true,
          direction: true,
          entryPrice: true,
          shares: true,
          userId: true,
        },
      });
    });

    if (openTrades.length === 0) {
      return { openChecks: 0, closedEvaluations: 0 };
    }

    // Step 2: Batch-fetch current prices for all open tickers
    const prices = await step.run("fetch-eod-prices", async () => {
      const uniqueTickers = [...new Set(openTrades.map((t) => t.ticker))];
      try {
        return await getLatestPrices(uniqueTickers);
      } catch {
        return {} as Record<string, number>;
      }
    });

    // Step 3: Write EOD_CHECK TradeEvent for each open trade (idempotent)
    let openChecks = 0;

    for (const trade of openTrades) {
      const currentPrice = (prices as Record<string, number>)[trade.ticker];
      if (currentPrice === undefined) continue;

      await step.run(`eod-check-${trade.id}`, async () => {
        // Idempotency: skip if an EOD_CHECK already exists for this trade today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const existing = await prisma.tradeEvent.findFirst({
          where: {
            tradeId: trade.id,
            eventType: "EOD_CHECK",
            createdAt: { gte: todayStart },
          },
          select: { id: true },
        });

        if (existing) return { skipped: true };

        const pnlPct = calcPnlPct(trade.direction, trade.entryPrice, currentPrice);
        const pnlDollars = calcPnlDollars(
          trade.direction,
          trade.entryPrice,
          currentPrice,
          trade.shares
        );
        const sign = pnlPct >= 0 ? "+" : "";

        await prisma.tradeEvent.create({
          data: {
            tradeId: trade.id,
            eventType: "EOD_CHECK",
            description: `EOD | ${trade.ticker} | ${sign}${pnlPct.toFixed(2)}% | $${currentPrice.toFixed(2)}`,
            priceAt: currentPrice,
            pnlAt: pnlDollars,
          },
        });

        return { written: true, ticker: trade.ticker, pnlPct };
      });

      openChecks++;
    }

    // Step 4: Find trades closed TODAY and fire trade/closed event for any
    //         that haven't been evaluated yet (no EVALUATED TradeEvent)
    const closedToday = await step.run("load-closed-today", async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      return prisma.trade.findMany({
        where: {
          status: "CLOSED",
          closedAt: { gte: todayStart },
        },
        select: {
          id: true,
          ticker: true,
          events: { where: { eventType: "EVALUATED" }, select: { id: true } },
        },
      });
    });

    // Fire trade/closed for trades that haven't been evaluated yet
    const unevaluated = (
      closedToday as Array<{
        id: string;
        ticker: string;
        events: { id: string }[];
      }>
    ).filter((t) => t.events.length === 0);

    for (const trade of unevaluated) {
      await step.sendEvent(`evaluate-${trade.id}`, {
        name: "trade/closed",
        data: { tradeId: trade.id },
      });
    }

    return {
      openChecks,
      closedEvaluations: unevaluated.length,
    };
  }
);
