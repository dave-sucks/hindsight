/**
 * Portfolio & performance chat tools — DAV-128
 *
 * portfolio_status, run_summary, performance_report
 *
 * Each tool returns structured data for dashboard-style rendering in chat.
 */
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getLatestPrices } from "@/lib/alpaca";

// ─── Tool factories ──────────────────────────────────────────────────────────

/**
 * Creates portfolio/performance tools bound to the current user.
 */
export function createPortfolioTools(userId: string) {
  return {
    portfolio_status: tool({
      description:
        "Get current portfolio status: open positions with live P&L, total exposure, " +
        "available capital, and sector breakdown. Use this when the user asks about " +
        "their positions, portfolio, or how they're doing.",
      inputSchema: z.object({}),
      execute: async () => {
        // Fetch open trades
        const openTrades = await prisma.trade.findMany({
          where: { userId, status: "OPEN" },
          include: { thesis: { select: { confidenceScore: true, sector: true } } },
          orderBy: { openedAt: "desc" },
        });

        // Batch-fetch live prices for open positions
        const tickers: string[] = Array.from(
          new Set(openTrades.map((t: { ticker: string }) => t.ticker))
        ) as string[];
        let priceMap: Record<string, number> = {};
        if (tickers.length > 0) {
          try {
            priceMap = await getLatestPrices(tickers);
          } catch {
            // Fall back to entry prices
          }
        }

        // Build position summaries
        type OpenTrade = (typeof openTrades)[number];
        const positions = openTrades.map((t: OpenTrade) => {
          const currentPrice = priceMap[t.ticker] ?? t.entryPrice;
          const pnlDollars =
            t.direction === "LONG"
              ? (currentPrice - t.entryPrice) * t.shares
              : (t.entryPrice - currentPrice) * t.shares;
          const pnlPct =
            t.entryPrice > 0
              ? ((t.direction === "LONG"
                  ? currentPrice - t.entryPrice
                  : t.entryPrice - currentPrice) /
                  t.entryPrice) *
                100
              : 0;

          return {
            ticker: t.ticker,
            direction: t.direction,
            shares: t.shares,
            entryPrice: t.entryPrice,
            currentPrice,
            pnlDollars: Math.round(pnlDollars * 100) / 100,
            pnlPct: Math.round(pnlPct * 100) / 100,
            targetPrice: t.targetPrice,
            stopLoss: t.stopLoss,
            daysHeld: Math.floor(
              (Date.now() - t.openedAt.getTime()) / (1000 * 60 * 60 * 24)
            ),
            sector: t.thesis?.sector ?? null,
            confidence: t.thesis?.confidenceScore ?? null,
          };
        });

        const totalExposure = positions.reduce(
          (sum: number, p: { entryPrice: number; shares: number }) =>
            sum + p.entryPrice * p.shares,
          0
        );
        const unrealizedPnl = positions.reduce(
          (sum: number, p: { pnlDollars: number }) => sum + p.pnlDollars,
          0
        );

        // Sector breakdown
        const sectorMap = new Map<string, number>();
        for (const p of positions) {
          const sector = p.sector || "Unknown";
          sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + 1);
        }
        const sectors = Array.from(sectorMap.entries()).map(
          ([name, count]: [string, number]) => ({ name, count })
        );

        // Closed trade stats
        const closedStats = await prisma.trade.aggregate({
          where: { userId, status: "CLOSED" },
          _sum: { realizedPnl: true },
          _count: true,
        });
        const winCount = await prisma.trade.count({
          where: { userId, status: "CLOSED", outcome: "WIN" },
        });
        const closedCount = closedStats._count;
        const winRate = closedCount > 0 ? winCount / closedCount : null;

        return {
          positions,
          totalExposure: Math.round(totalExposure * 100) / 100,
          unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
          realizedPnl: Math.round(
            (closedStats._sum.realizedPnl ?? 0) * 100
          ) / 100,
          openCount: positions.length,
          closedCount,
          winRate:
            winRate !== null ? Math.round(winRate * 1000) / 10 : null,
          sectors,
        };
      },
    }),

    run_summary: tool({
      description:
        "Get a summary of a specific research run or the most recent run. " +
        "Shows tickers analyzed, theses generated, trades placed, and analyst used.",
      inputSchema: z.object({
        runId: z
          .string()
          .optional()
          .describe(
            "Research run ID. If omitted, returns the most recent run."
          ),
      }),
      execute: async ({ runId }) => {
        const run = runId
          ? await prisma.researchRun.findUnique({
              where: { id: runId },
              include: {
                agentConfig: { select: { name: true } },
                theses: {
                  include: {
                    trade: {
                      select: {
                        id: true,
                        status: true,
                        entryPrice: true,
                      },
                    },
                  },
                  orderBy: { confidenceScore: "desc" },
                },
              },
            })
          : await prisma.researchRun.findFirst({
              where: { userId },
              orderBy: { startedAt: "desc" },
              include: {
                agentConfig: { select: { name: true } },
                theses: {
                  include: {
                    trade: {
                      select: {
                        id: true,
                        status: true,
                        entryPrice: true,
                      },
                    },
                  },
                  orderBy: { confidenceScore: "desc" },
                },
              },
            });

        if (!run) {
          return { error: "No research runs found." };
        }

        type RunThesis = (typeof run.theses)[number];
        const theses = run.theses.map((t: RunThesis) => ({
          ticker: t.ticker,
          direction: t.direction,
          confidence: t.confidenceScore,
          reasoning: t.reasoningSummary,
          entryPrice: t.entryPrice,
          targetPrice: t.targetPrice,
          stopLoss: t.stopLoss,
          signalTypes: t.signalTypes,
          sector: t.sector,
          traded: !!t.trade,
          tradeStatus: t.trade?.status ?? null,
        }));

        const actionable = theses.filter(
          (t: { direction: string }) => t.direction !== "PASS"
        );
        const passed = theses.filter(
          (t: { direction: string }) => t.direction === "PASS"
        );
        const traded = theses.filter(
          (t: { traded: boolean }) => t.traded
        );

        return {
          runId: run.id,
          analystName: run.agentConfig?.name ?? "Unknown",
          startedAt: run.startedAt.toISOString(),
          completedAt: run.completedAt?.toISOString() ?? null,
          status: run.status,
          totalTheses: theses.length,
          actionableCount: actionable.length,
          passedCount: passed.length,
          tradesPlaced: traded.length,
          theses,
        };
      },
    }),

    performance_report: tool({
      description:
        "Get the latest accuracy/performance report. Shows win rate, calibration data, " +
        "signal accuracy, and GPT-4o narrative analysis. Use when the user asks about " +
        "performance, accuracy, or how their trading is going overall.",
      inputSchema: z.object({
        analystId: z
          .string()
          .optional()
          .describe(
            "Analyst (AgentConfig) ID to scope the report. Omit for overall."
          ),
      }),
      execute: async ({ analystId }) => {
        // Get latest accuracy report
        const report = await prisma.accuracyReport.findFirst({
          where: { userId },
          orderBy: { weekStartDate: "desc" },
        });

        // Get overall stats
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const closedWhere: any = { userId, status: "CLOSED" };
        if (analystId) {
          closedWhere.thesis = {
            researchRun: { agentConfigId: analystId },
          };
        }

        const [totalClosed, wins, losses] = await Promise.all([
          prisma.trade.count({ where: closedWhere }),
          prisma.trade.count({
            where: { ...closedWhere, outcome: "WIN" },
          }),
          prisma.trade.count({
            where: { ...closedWhere, outcome: "LOSS" },
          }),
        ]);

        const pnlAgg = await prisma.trade.aggregate({
          where: closedWhere,
          _sum: { realizedPnl: true },
          _avg: { realizedPnl: true },
        });

        // Get per-direction stats
        const [longWins, shortWins] = await Promise.all([
          prisma.trade.count({
            where: {
              ...closedWhere,
              direction: "LONG",
              outcome: "WIN",
            },
          }),
          prisma.trade.count({
            where: {
              ...closedWhere,
              direction: "SHORT",
              outcome: "WIN",
            },
          }),
        ]);
        const [totalLong, totalShort] = await Promise.all([
          prisma.trade.count({
            where: { ...closedWhere, direction: "LONG" },
          }),
          prisma.trade.count({
            where: { ...closedWhere, direction: "SHORT" },
          }),
        ]);

        return {
          totalClosed,
          wins,
          losses,
          winRate:
            totalClosed > 0
              ? Math.round((wins / totalClosed) * 1000) / 10
              : null,
          totalPnl:
            Math.round((pnlAgg._sum.realizedPnl ?? 0) * 100) / 100,
          avgPnl:
            Math.round((pnlAgg._avg.realizedPnl ?? 0) * 100) / 100,
          longWinRate:
            totalLong > 0
              ? Math.round((longWins / totalLong) * 1000) / 10
              : null,
          shortWinRate:
            totalShort > 0
              ? Math.round((shortWins / totalShort) * 1000) / 10
              : null,
          totalLong,
          totalShort,
          latestReport: report
            ? {
                weekStartDate: report.weekStartDate.toISOString(),
                winRate: report.winRate,
                narrativeSummary: report.narrativeSummary,
                calibrationData: report.calibrationData,
                signalAccuracy: report.signalAccuracy,
              }
            : null,
        };
      },
    }),
  };
}
