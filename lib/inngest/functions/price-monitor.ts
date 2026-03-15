import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getLatestPrices } from "@/lib/alpaca";
import { isMarketOpen } from "@/lib/market-hours";
import { checkExitConditions } from "@/lib/trade-exit";
import type { TradeModel } from "@/lib/generated/prisma/models";
import { sendEmail, getUserEmail } from "@/lib/email";
import { nearTargetHtml } from "@/lib/emails/near-target";

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
    // Step 1: Fetch all OPEN + SHADOW trades
    const openTrades = await step.run("fetch-open-trades", async () => {
      return prisma.trade.findMany({ where: { status: { in: ["OPEN", "SHADOW"] } } });
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

          const pnl = calculatePnl(trade as unknown as TradeModel, currentPrice);

          // Write PRICE_CHECK event
          await prisma.tradeEvent.create({
            data: {
              tradeId: trade.id,
              eventType: "PRICE_CHECK",
              description: `${trade.status === "SHADOW" ? "SHADOW " : ""}Price check: $${currentPrice.toFixed(2)} (${pnl.pct >= 0 ? "+" : ""}${pnl.pct.toFixed(1)}%)`,
              priceAt: currentPrice,
              pnlAt: pnl.dollars,
            },
          });

          // Shadow trade expiry check — close if observation window has passed
          if (trade.status === "SHADOW" && trade.exitDate && new Date() >= new Date(trade.exitDate)) {
            // For shadow trades: WIN = good pass (price dropped, you avoided a loss)
            // LOSS = bad pass (price rose, you missed a gain)
            const outcome = pnl.dollars <= 0 ? "WIN" : "LOSS";
            await prisma.trade.update({
              where: { id: trade.id },
              data: {
                status: "SHADOW_CLOSED",
                closePrice: currentPrice,
                realizedPnl: pnl.dollars,
                outcome,
                closeReason: "SHADOW_EXPIRY",
                closedAt: new Date(),
              },
            });
            await prisma.tradeEvent.create({
              data: {
                tradeId: trade.id,
                eventType: "CLOSED",
                description: `SHADOW CLOSED: ${outcome === "WIN" ? "Good pass" : "Bad pass"} — ${trade.ticker} moved ${pnl.pct >= 0 ? "+" : ""}${pnl.pct.toFixed(1)}% (${pnl.dollars >= 0 ? "+" : ""}$${pnl.dollars.toFixed(2)} hypothetical)`,
                priceAt: currentPrice,
                pnlAt: pnl.dollars,
              },
            });
            checked++;
            return;
          }

          // Skip exit conditions and alerts for shadow trades
          if (trade.status === "SHADOW") {
            checked++;
            return;
          }

          // Check exit conditions — DAV-33 implements auto-close
          await checkExitConditions(trade as unknown as TradeModel, currentPrice);

          // Near-target alert — send once when ≥80% of the way to price target
          if (
            trade.targetPrice &&
            !trade.nearTargetAlertSent
          ) {
            const totalMove =
              trade.direction === "LONG"
                ? trade.targetPrice - trade.entryPrice
                : trade.entryPrice - trade.targetPrice;
            const currentMove =
              trade.direction === "LONG"
                ? currentPrice - trade.entryPrice
                : trade.entryPrice - currentPrice;
            const progress = totalMove > 0 ? currentMove / totalMove : 0;

            if (progress >= 0.8) {
              // Mark flag first (idempotent) then send email
              await prisma.trade.update({
                where: { id: trade.id },
                data: { nearTargetAlertSent: true },
              });
              getUserEmail(trade.userId).then((toEmail) => {
                if (!toEmail) return;
                const unrealizedPnl =
                  trade.direction === "LONG"
                    ? (currentPrice - trade.entryPrice) * trade.shares
                    : (trade.entryPrice - currentPrice) * trade.shares;
                sendEmail({
                  to: toEmail,
                  subject: `🎯 ${trade.ticker} is ${Math.round(progress * 100)}% to target`,
                  html: nearTargetHtml({
                    ticker: trade.ticker,
                    direction: trade.direction as "LONG" | "SHORT",
                    entryPrice: trade.entryPrice,
                    currentPrice,
                    targetPrice: trade.targetPrice!,
                    progressPct: progress * 100,
                    unrealizedPnl,
                    unrealizedPnlPct: calculatePnl(trade as unknown as TradeModel, currentPrice).pct,
                    tradeId: trade.id,
                  }),
                });
              });
            }
          }

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
