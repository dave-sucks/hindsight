import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createResearchTools } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";
import { updateAnalystBriefing } from "@/lib/agent/update-analyst-briefing";

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
              agentMode: true,
              analystName: config.name,
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
            where: {
              userId: config.userId,
              status: "CLOSED",
              thesis: { researchRun: { agentConfigId: config.id } },
            },
            orderBy: { closedAt: "desc" },
            take: 20,
            select: {
              id: true,
              ticker: true, direction: true, outcome: true,
              entryPrice: true, closePrice: true, shares: true,
              realizedPnl: true, closeReason: true, closedAt: true,
              agentEvaluation: true,
            },
          });

          const openTrades = await prisma.trade.findMany({
            where: {
              userId: config.userId,
              status: "OPEN",
              thesis: { researchRun: { agentConfigId: config.id } },
            },
            select: {
              ticker: true, direction: true, entryPrice: true,
              shares: true, targetPrice: true, stopLoss: true,
              createdAt: true,
            },
          });

          const latestAccuracy = await prisma.accuracyReport.findFirst({
            where: { userId: config.userId },
            orderBy: { createdAt: "desc" },
            select: {
              winRate: true, tradesAnalyzed: true,
              narrativeSummary: true,
            },
          });

          // Load recent briefings from the AnalystBriefing table
          const recentBriefings = await prisma.analystBriefing.findMany({
            where: { analystId: config.id },
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { narrative: true, strategyNotes: true, createdAt: true },
          });

          // Recent shadow-closed trades (pass tracking results)
          const shadowTrades = await prisma.trade.findMany({
            where: {
              userId: config.userId,
              status: "SHADOW_CLOSED",
              thesis: { researchRun: { agentConfigId: config.id } },
            },
            orderBy: { closedAt: "desc" },
            take: 10,
            select: {
              ticker: true, entryPrice: true, closePrice: true,
              realizedPnl: true, outcome: true, closedAt: true,
            },
          });

          const parts: string[] = [];

          // Inject recent briefings for evolving context
          if (recentBriefings.length > 0) {
            parts.push("## Your Recent Briefings");
            parts.push("These are your self-assessments from recent sessions. Use them to inform today's decisions.\n");
            for (const [i, b] of recentBriefings.entries()) {
              const dateStr = b.createdAt.toISOString().slice(0, 10);
              const label = i === 0 ? "Latest" : `${i + 1} sessions ago`;
              parts.push(`### ${label} (${dateStr})`);
              parts.push(b.narrative.slice(0, 600));
              if (b.strategyNotes) {
                parts.push(`\n**Strategy Notes:** ${b.strategyNotes.slice(0, 300)}`);
              }
              parts.push("");
            }
          }

          if (openTrades.length > 0) {
            parts.push("\n## Your Open Positions");
            for (const t of openTrades) {
              parts.push(`- ${t.direction} ${t.shares} shares $${t.ticker} @ $${Number(t.entryPrice).toFixed(2)} (target: $${t.targetPrice ? Number(t.targetPrice).toFixed(2) : "—"}, stop: $${t.stopLoss ? Number(t.stopLoss).toFixed(2) : "—"})`);
            }
            parts.push(`\nDo NOT open duplicate positions in tickers you already hold. Consider whether existing positions should be closed based on new information.`);
          }

          if (recentTrades.length > 0) {
            const wins = recentTrades.filter((t) => t.outcome === "WIN").length;
            const losses = recentTrades.filter((t) => t.outcome === "LOSS").length;
            parts.push(`\n## Recent Trade History (${recentTrades.length} trades)`);
            parts.push(`Win/Loss: ${wins}W / ${losses}L`);
            for (const t of recentTrades.slice(0, 10)) {
              const pnl = t.realizedPnl ?? 0;
              const evalSnippet = t.agentEvaluation ? ` | Eval: ${t.agentEvaluation.slice(0, 200)}` : "";
              parts.push(`- ${t.outcome ?? "?"} | ${t.direction} $${t.ticker} | entry $${Number(t.entryPrice).toFixed(2)} → exit $${t.closePrice ? Number(t.closePrice).toFixed(2) : "—"} | ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}${evalSnippet}`);
            }
            parts.push(`\nLearn from these results and evaluations. Avoid repeating patterns that led to losses.`);
          }

          if (shadowTrades.length > 0) {
            const goodPasses = shadowTrades.filter((t) => t.outcome === "WIN").length;
            const badPasses = shadowTrades.filter((t) => t.outcome === "LOSS").length;
            parts.push(`\n## Shadow Trade Results — Passes You Tracked (${shadowTrades.length} resolved)`);
            parts.push(`Good passes: ${goodPasses} | Bad passes: ${badPasses}`);
            for (const t of shadowTrades) {
              const priceDelta = t.closePrice ? ((t.closePrice - t.entryPrice) / t.entryPrice * 100) : 0;
              const hypotheticalPnl = t.realizedPnl ?? 0;
              const label = t.outcome === "WIN" ? "GOOD PASS" : "BAD PASS";
              parts.push(`- ${label} | $${t.ticker} | passed at $${Number(t.entryPrice).toFixed(2)}, now $${t.closePrice ? Number(t.closePrice).toFixed(2) : "—"} (${priceDelta >= 0 ? "+" : ""}${priceDelta.toFixed(1)}%) | ${hypotheticalPnl >= 0 ? "Missed" : "Avoided"} $${Math.abs(hypotheticalPnl).toFixed(2)}`);
            }
            parts.push(`\nUse these results to calibrate your pass decisions. If you're making too many bad passes, consider being more aggressive.`);
          }

          if (latestAccuracy) {
            parts.push(`\n## Your Performance Stats`);
            parts.push(`- Win Rate: ${latestAccuracy.winRate != null ? (Number(latestAccuracy.winRate) * 100).toFixed(0) : "—"}%`);
            parts.push(`- Trades Analyzed: ${latestAccuracy.tradesAnalyzed ?? "—"}`);
            if (latestAccuracy.narrativeSummary) {
              parts.push(`- Calibration: ${String(latestAccuracy.narrativeSummary).slice(0, 300)}`);
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
          maxPositionSize: Number(config.maxPositionSize),
        });

        // 2e. Run the agent (generateText, not streamText — no client to stream to)
        try {
          const { text, steps, response } = await generateText({
            model: openai("gpt-4.1"),
            system: systemPrompt,
            prompt: "Begin your research session. Follow all phases in order.",
            tools,
            stopWhen: stepCountIs(30),
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

          // Persist full conversation messages for replay (same format as agent route)
          try {
            const userMessage = {
              role: "user",
              content: [{ type: "text", text: "Begin your research session. Follow all phases in order." }],
            };
            const allMessages = [userMessage, ...response.messages];
            await prisma.runMessage.deleteMany({ where: { runId: run.id } });
            await prisma.runMessage.create({
              data: {
                runId: run.id,
                role: "thread",
                content: JSON.stringify(allMessages),
              },
            });
          } catch (msgErr) {
            console.warn("[morning-research] Failed to persist messages:", msgErr);
          }

          // Update analyst briefing after successful run
          try {
            await updateAnalystBriefing({
              analystId: config.id,
              runId: run.id,
              userId: config.userId,
            });
          } catch (briefingErr) {
            console.warn("[morning-research] Briefing update failed (non-fatal):", briefingErr);
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
