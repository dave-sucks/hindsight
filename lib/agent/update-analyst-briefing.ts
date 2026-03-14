/**
 * Post-run analyst briefing generator.
 *
 * After each research run completes, this generates a rich "daily standup"
 * briefing for the analyst. The briefing is stored on the AgentConfig and
 * displayed on the analyst detail page. It also feeds into the next run's
 * system prompt so the agent has full historical context.
 *
 * Think of it as calling your financial advisor and asking:
 * "How's my portfolio doing today? What's our strategy?"
 */

import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { prisma } from "@/lib/prisma";

interface BriefingContext {
  analystId: string;
  runId: string;
  userId: string;
}

/**
 * Generate and persist an updated analyst briefing after a run completes.
 * Non-fatal — errors are logged but don't break the run flow.
 */
export async function updateAnalystBriefing({
  analystId,
  runId,
  userId,
}: BriefingContext): Promise<void> {
  try {
    const t0 = Date.now();

    // Load everything we need in parallel
    const [config, openTrades, recentClosedTrades, latestRun, allRuns] =
      await Promise.all([
        prisma.agentConfig.findFirst({
          where: { id: analystId, userId },
        }),
        prisma.trade.findMany({
          where: {
            userId,
            status: "OPEN",
            thesis: { researchRun: { agentConfigId: analystId } },
          },
          include: {
            thesis: {
              select: {
                confidenceScore: true,
                reasoningSummary: true,
                direction: true,
                signalTypes: true,
              },
            },
          },
          orderBy: { openedAt: "desc" },
        }),
        prisma.trade.findMany({
          where: {
            userId,
            status: "CLOSED",
            thesis: { researchRun: { agentConfigId: analystId } },
          },
          orderBy: { closedAt: "desc" },
          take: 30,
          select: {
            ticker: true,
            direction: true,
            entryPrice: true,
            closePrice: true,
            shares: true,
            realizedPnl: true,
            outcome: true,
            openedAt: true,
            closedAt: true,
            closeReason: true,
            thesis: {
              select: {
                confidenceScore: true,
                reasoningSummary: true,
                signalTypes: true,
              },
            },
          },
        }),
        // Get the latest run's summary event for context
        prisma.runEvent.findFirst({
          where: { runId, type: "run_summary" },
          select: { payload: true },
        }),
        // Count total runs
        prisma.researchRun.count({
          where: { agentConfigId: analystId, userId, status: "COMPLETE" },
        }),
      ]);

    if (!config) {
      console.warn(`[briefing] Analyst ${analystId} not found, skipping`);
      return;
    }

    // Compute portfolio stats
    const totalInvested = openTrades.reduce(
      (sum, t) => sum + t.entryPrice * t.shares,
      0
    );
    const closedPnl = recentClosedTrades.reduce(
      (sum, t) => sum + (t.realizedPnl ?? 0),
      0
    );
    const wins = recentClosedTrades.filter((t) => t.outcome === "WIN").length;
    const losses = recentClosedTrades.filter(
      (t) => t.outcome === "LOSS"
    ).length;
    const winRate =
      wins + losses > 0
        ? ((wins / (wins + losses)) * 100).toFixed(0)
        : "N/A";

    // Build the data context for the AI
    const openPositionsText =
      openTrades.length > 0
        ? openTrades
            .map(
              (t) =>
                `- $${t.ticker}: ${t.direction} ${t.shares} shares @ $${t.entryPrice.toFixed(2)} (confidence: ${t.thesis?.confidenceScore ?? "?"}%, thesis: "${t.thesis?.reasoningSummary?.slice(0, 100) ?? "—"}")`
            )
            .join("\n")
        : "No open positions.";

    const recentTradesText =
      recentClosedTrades.length > 0
        ? recentClosedTrades
            .slice(0, 15)
            .map((t) => {
              const pnl = t.realizedPnl ?? 0;
              const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
              return `- ${t.outcome ?? "?"} $${t.ticker}: ${t.direction} entry $${t.entryPrice.toFixed(2)} → exit $${(t.closePrice ?? 0).toFixed(2)} (${pnlStr}, closed: ${t.closeReason ?? "?"})`;
            })
            .join("\n")
        : "No closed trades yet.";

    // Get latest run summary
    const runSummary = latestRun?.payload
      ? JSON.stringify(latestRun.payload)
      : "No summary available from latest run.";

    // Build the prompt
    const briefingPrompt = `You are ${config.name}, an AI research analyst managing a paper trading portfolio. Generate your daily standup briefing — as if a portfolio manager just called and asked "How's my portfolio? What's our strategy?"

## Your Core Strategy
${config.analystPrompt || "General market research analyst."}

## Portfolio Data

### Open Positions (${openTrades.length} active)
Total invested: $${totalInvested.toFixed(2)}
${openPositionsText}

### Recent Trade History (${recentClosedTrades.length} closed trades)
Win Rate: ${winRate}% (${wins}W / ${losses}L)
Total P&L from closed trades: ${closedPnl >= 0 ? "+" : ""}$${closedPnl.toFixed(2)}
${recentTradesText}

### Session Stats
Total completed research sessions: ${allRuns}
Latest run summary: ${runSummary.slice(0, 500)}

## Instructions

Write a concise portfolio briefing in markdown format. Structure it as a real financial advisor would on a client call:

1. **Portfolio Status** — Open positions, what we're holding and why. Use $TICKER format for all stock symbols. Mention key metrics for each position.

2. **Recent Activity** — What we bought/sold recently, outcomes, notable wins or losses. Be specific with numbers.

3. **Performance Review** — Win rate, P&L trends, patterns in what's working vs not. If certain types of trades (sectors, signal types, confidence levels) are consistently winning or losing, call that out.

4. **Strategy Adjustments** — Based on performance data, what should we adjust? Are we being too aggressive? Too conservative? Are certain sectors or signal types underperforming? Be honest and data-driven.

5. **Tomorrow's Focus** — What to look for in the next session. Specific sectors, catalysts, positions to monitor for exits.

Rules:
- Use **$TICKER** format for ALL stock symbols (renders as interactive badges)
- Be data-driven — cite actual numbers from the portfolio data
- Be honest about failures — don't sugarcoat bad trades
- Keep it conversational but substantive, like a senior analyst on a morning call
- If the portfolio is new with few trades, acknowledge that and focus on the strategy
- Use bold for key metrics and numbers
- Keep total length to 400-600 words`;

    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: briefingPrompt,
    });

    // Persist the briefing
    await prisma.agentConfig.update({
      where: { id: analystId },
      data: {
        analystBriefing: text,
        briefingUpdatedAt: new Date(),
      },
    });

    const elapsed = Date.now() - t0;
    console.log(
      `[briefing] Updated briefing for ${config.name} (${analystId}) in ${elapsed}ms`
    );
  } catch (err) {
    console.error(
      `[briefing] Failed to update briefing for analyst ${analystId}:`,
      err
    );
    // Non-fatal — don't throw
  }
}
