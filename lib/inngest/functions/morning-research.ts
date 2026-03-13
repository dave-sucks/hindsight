import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createResearchTools } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";

// ─── Inngest function ─────────────────────────────────────────────────────────

export const morningResearch = inngest.createFunction(
  {
    id: "morning-research",
    name: "Morning Research Cron",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "0 13 * * 1-5" }, // 8:00 AM ET = 13:00 UTC, Mon–Fri
    { event: "app/research.run.manual" },
  ],
  async ({ event, step }) => {
    // Optional: if triggered manually for a specific analyst, only run that one
    const targetConfigId = (event as { data?: { agentConfigId?: string } })
      ?.data?.agentConfigId ?? null;

    // ── Step 1: Load enabled AgentConfigs (all, or filtered to one) ──────────

    const configs = await step.run("load-agent-configs", async () => {
      return prisma.agentConfig.findMany({
        where: {
          enabled: true,
          ...(targetConfigId ? { id: targetConfigId } : {}),
        },
      });
    });

    if (configs.length === 0) {
      return { ran: 0, reason: "no-enabled-configs" };
    }

    let totalTradesPlaced = 0;

    // ── Step 2: Per-analyst agent run ──────────────────────────────────────

    for (const config of configs) {
      const result = await step.run(`research-${config.id}`, async () => {
        const t0 = Date.now();

        // 2a. Check open positions cap
        const openCount = await prisma.trade.count({
          where: { userId: config.userId, status: "OPEN" },
        });
        const slotsRemaining = config.maxOpenPositions - openCount;

        if (slotsRemaining <= 0) {
          console.log(`[morning-research] Skipping ${config.name}: max open positions reached (${openCount}/${config.maxOpenPositions})`);
          return { skipped: true, reason: "max-open-positions-reached" };
        }

        // 2b. Create ResearchRun record (status: RUNNING)
        const run = await prisma.researchRun.create({
          data: {
            userId: config.userId,
            agentConfigId: config.id,
            source: "AGENT",
            status: "RUNNING",
            parameters: {
              markets: config.markets,
              sectors: config.sectors,
              minConfidence: config.minConfidence,
              signalTypes: config.signalTypes,
              tickers: config.watchlist ?? [],
              triggeredBy: "morning-cron",
            } as object,
          },
        });

        console.log(`[morning-research] Starting agent run for ${config.name} (config=${config.id}, run=${run.id})`);

        // 2c. Build system prompt with historical context
        const agentConfig = {
          name: config.name,
          analystPrompt: config.analystPrompt ?? undefined,
          directionBias: config.directionBias,
          holdDurations: config.holdDurations,
          sectors: config.sectors,
          signalTypes: config.signalTypes,
          minConfidence: config.minConfidence,
          maxPositionSize: Number(config.maxPositionSize),
          maxOpenPositions: slotsRemaining, // Use remaining slots, not max
          watchlist: config.watchlist,
          exclusionList: config.exclusionList,
        };

        // Load historical context (same as agent route)
        let historyBlock = "";
        try {
          const recentTrades = await prisma.trade.findMany({
            where: { userId: config.userId, status: { in: ["CLOSED", "WIN", "LOSS"] } },
            orderBy: { closedAt: "desc" },
            take: 20,
            select: {
              ticker: true, direction: true, status: true,
              entryPrice: true, exitPrice: true, shares: true,
              pnl: true, pnlPct: true, closedAt: true,
            },
          });

          const openTrades = await prisma.trade.findMany({
            where: { userId: config.userId, status: "OPEN" },
            select: {
              ticker: true, direction: true, entryPrice: true,
              shares: true, targetPrice: true, stopLoss: true,
              createdAt: true,
            },
          });

          const latestAccuracy = await prisma.accuracyReport.findFirst({
            where: { agentConfigId: config.id },
            orderBy: { createdAt: "desc" },
            select: {
              overallWinRate: true, totalTrades: true,
              avgPnlPct: true, narrative: true,
            },
          });

          const parts: string[] = [];

          if (openTrades.length > 0) {
            parts.push("## Your Open Positions");
            for (const t of openTrades) {
              parts.push(`- ${t.direction} ${t.shares} shares ${t.ticker} @ $${Number(t.entryPrice).toFixed(2)} (target: $${t.targetPrice ? Number(t.targetPrice).toFixed(2) : "—"}, stop: $${t.stopLoss ? Number(t.stopLoss).toFixed(2) : "—"})`);
            }
            parts.push(`\nDo NOT open duplicate positions in tickers you already hold.`);
          }

          if (recentTrades.length > 0) {
            const wins = recentTrades.filter((t) => t.status === "WIN").length;
            const losses = recentTrades.filter((t) => t.status === "LOSS").length;
            parts.push(`\n## Recent Trade History (${recentTrades.length} trades)`);
            parts.push(`Win/Loss: ${wins}W / ${losses}L`);
            for (const t of recentTrades.slice(0, 10)) {
              const pnl = t.pnl ? Number(t.pnl) : 0;
              parts.push(`- ${t.status} ${t.direction} ${t.ticker}: entry $${Number(t.entryPrice).toFixed(2)} → exit $${t.exitPrice ? Number(t.exitPrice).toFixed(2) : "—"} (${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)})`);
            }
          }

          if (latestAccuracy) {
            parts.push(`\n## Your Performance Stats`);
            parts.push(`- Win Rate: ${latestAccuracy.overallWinRate ? Number(latestAccuracy.overallWinRate).toFixed(0) : "—"}%`);
            parts.push(`- Total Trades: ${latestAccuracy.totalTrades ?? "—"}`);
            parts.push(`- Avg P&L: ${latestAccuracy.avgPnlPct ? `${Number(latestAccuracy.avgPnlPct).toFixed(1)}%` : "—"}`);
            if (latestAccuracy.narrative) {
              parts.push(`- Calibration: ${String(latestAccuracy.narrative).slice(0, 300)}`);
            }
            parts.push(`\nUse this data to calibrate your confidence. If your win rate is low, be more selective.`);
          }

          historyBlock = parts.join("\n");
        } catch (err) {
          console.warn("[morning-research] Failed to load history (non-fatal):", err);
        }

        const systemPrompt = buildSystemPrompt(agentConfig) + (historyBlock ? `\n\n${historyBlock}` : "");

        // 2d. Create tools with run context
        const tools = createResearchTools({
          runId: run.id,
          userId: config.userId,
          watchlist: config.watchlist ?? [],
          exclusionList: config.exclusionList ?? [],
          sectors: config.sectors ?? [],
        });

        // 2e. Run the agent (generateText, not streamText — no client to stream to)
        try {
          const { text, steps } = await generateText({
            model: openai("gpt-4o"),
            system: systemPrompt,
            prompt: "Begin your research session. Follow all phases in order.",
            tools,
            stopWhen: stepCountIs(25),
          });

          const toolCalls = steps.reduce((sum, s) => sum + (s.toolCalls?.length ?? 0), 0);
          const elapsed = Date.now() - t0;
          console.log(`[morning-research] Agent completed for ${config.name}: ${steps.length} steps, ${toolCalls} tool calls, ${elapsed}ms`);

          // Count trades placed by checking DB (the place_trade tool already created them)
          const tradesPlaced = await prisma.trade.count({
            where: {
              userId: config.userId,
              thesis: { researchRunId: run.id },
            },
          });

          // Ensure run is marked COMPLETE (summarize_run tool should have done this,
          // but belt-and-suspenders in case the agent didn't call it)
          const currentRun = await prisma.researchRun.findUnique({ where: { id: run.id } });
          if (currentRun && currentRun.status === "RUNNING") {
            await prisma.researchRun.update({
              where: { id: run.id },
              data: {
                status: "COMPLETE",
                completedAt: new Date(),
                parameters: {
                  ...(currentRun.parameters as object),
                  tradesPlaced,
                  agentSteps: steps.length,
                  agentToolCalls: toolCalls,
                  elapsedMs: elapsed,
                } as object,
              },
            });
          }

          // Persist agent messages for replay
          try {
            await prisma.runMessage.deleteMany({ where: { runId: run.id } });
            await prisma.runMessage.create({
              data: {
                runId: run.id,
                role: "thread",
                content: JSON.stringify({ agentText: text, steps: steps.length, toolCalls }),
              },
            });
          } catch (msgErr) {
            console.warn("[morning-research] Failed to persist messages:", msgErr);
          }

          return { tradesPlaced, steps: steps.length, toolCalls, elapsedMs: elapsed };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[morning-research] Agent FAILED for ${config.name}: ${message}`);

          await prisma.researchRun.update({
            where: { id: run.id },
            data: {
              status: "FAILED",
              completedAt: new Date(),
              parameters: {
                ...(run.parameters as object),
                error: message,
                failedAt: new Date().toISOString(),
              } as object,
            },
          });

          return { error: message };
        }
      });

      // Accumulate trades from successful runs
      if (result && typeof result === "object" && "tradesPlaced" in result) {
        totalTradesPlaced += (result as { tradesPlaced: number }).tradesPlaced;
      }
    }

    return { ran: configs.length, totalTradesPlaced };
  }
);
