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
    { cron: "TZ=America/New_York 0 8 * * 1-5" }, // 8:00 AM ET Mon–Fri (auto-adjusts for EDT/EST)
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

        // 2a. Check open positions for THIS analyst (not all analysts combined)
        const openCount = await prisma.position.count({
          where: {
            analystId: config.id,
            status: "OPEN",
          },
        });
        const slotsRemaining = Math.max(0, config.maxOpenPositions - openCount);
        // Never skip the run — the agent should always research.
        // slotsRemaining=0 just means it won't place new trades.

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
          const recentTrades = await prisma.position.findMany({
            where: {
              analystId: config.id,
              status: "CLOSED",
            },
            orderBy: { closedAt: "desc" },
            take: 20,
            select: {
              id: true,
              symbol: true, direction: true, outcome: true,
              avgCost: true, closePrice: true, quantity: true,
              realizedPnl: true, closeReason: true, closedAt: true,
              agentEvaluation: true,
            },
          });

          const openTrades = await prisma.position.findMany({
            where: {
              analystId: config.id,
              status: "OPEN",
            },
            select: {
              symbol: true, direction: true, avgCost: true,
              quantity: true, targetPrice: true, stopLoss: true,
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

          // Recent PASS decisions (replaces shadow trades)
          const passDecisions = await prisma.tradeDecision.findMany({
            where: {
              analystId: config.id,
              decision: "PASS",
            },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
              symbol: true, reasoning: true, createdAt: true,
              thesis: {
                select: { entryPrice: true, confidenceScore: true },
              },
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
              parts.push(`- ${t.direction} ${t.quantity} shares $${t.symbol} @ $${Number(t.avgCost).toFixed(2)} (target: $${t.targetPrice ? Number(t.targetPrice).toFixed(2) : "—"}, stop: $${t.stopLoss ? Number(t.stopLoss).toFixed(2) : "—"})`);
            }
            parts.push(`\nDo NOT open duplicate positions in tickers you already hold. Consider whether existing positions should be closed based on new information.`);
          }

          if (recentTrades.length > 0) {
            const wins = recentTrades.filter((t) => t.outcome === "WIN").length;
            const losses = recentTrades.filter((t) => t.outcome === "LOSS").length;
            parts.push(`\n## Recent Trade History (${recentTrades.length} positions)`);
            parts.push(`Win/Loss: ${wins}W / ${losses}L`);
            for (const t of recentTrades.slice(0, 10)) {
              const pnl = t.realizedPnl ?? 0;
              const evalSnippet = t.agentEvaluation ? ` | Eval: ${t.agentEvaluation.slice(0, 200)}` : "";
              parts.push(`- ${t.outcome ?? "?"} | ${t.direction} $${t.symbol} | entry $${Number(t.avgCost).toFixed(2)} → exit $${t.closePrice ? Number(t.closePrice).toFixed(2) : "—"} | ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}${evalSnippet}`);
            }
            parts.push(`\nLearn from these results and evaluations. Avoid repeating patterns that led to losses.`);
          }

          if (passDecisions.length > 0) {
            parts.push(`\n## Recent Pass Decisions (${passDecisions.length})`);
            for (const d of passDecisions) {
              const entryPrice = d.thesis?.entryPrice;
              const confidence = d.thesis?.confidenceScore;
              const dateStr = d.createdAt.toISOString().slice(0, 10);
              parts.push(`- PASS | $${d.symbol} | ${dateStr} | confidence: ${confidence ?? "—"}% | entry was $${entryPrice ? Number(entryPrice).toFixed(2) : "—"} | reason: ${d.reasoning?.slice(0, 150) ?? "—"}`);
            }
            parts.push(`\nReview these passes. Were they the right call?`);
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
          analystId: config.id,
          watchlist: config.watchlist ?? [],
          exclusionList: config.exclusionList ?? [],
          sectors: config.sectors ?? [],
          maxPositionSize: Number(config.maxPositionSize),
        });

        // 2e. Run the agent (generateText, not streamText — no client to stream to)
        // Use AbortSignal to kill the agent before Vercel's 300s timeout kills the process.
        // Without this, a timeout leaves the run stuck in RUNNING status forever.
        console.log(`[morning-research] Starting generateText for ${config.name} run=${run.id} systemPrompt=${systemPrompt.length}chars`);
        try {
          const { text, steps, response } = await generateText({
            model: openai("gpt-4.1"),
            system: systemPrompt,
            prompt: "Begin your research session. Follow all phases in order.",
            tools,
            stopWhen: stepCountIs(30),
            abortSignal: AbortSignal.timeout(240_000), // 4 min — leaves 1 min for cleanup before Vercel's 5 min limit
            onStepFinish({ stepNumber, toolCalls: stepTools, text: stepText, finishReason, usage }) {
              const elapsed = Date.now() - t0;
              const ts = new Date().toISOString().slice(11, 23);
              const toolNames = stepTools.map((tc) => tc.toolName).join(", ") || "none";
              const textPreview = stepText?.slice(0, 120)?.replace(/\n/g, " ") || "";
              console.log(
                `[morning-research] ${ts} STEP #${stepNumber} ${config.name} run=${run.id} elapsed=${elapsed}ms tools=[${toolNames}] finish=${finishReason} tokens=${usage?.totalTokens ?? "?"} text="${textPreview}${stepText && stepText.length > 120 ? "..." : ""}"`
              );
            },
          });

          const toolCalls = steps.reduce((sum, s) => sum + (s.toolCalls?.length ?? 0), 0);
          const elapsed = Date.now() - t0;
          console.log(`[morning-research] Agent completed for ${config.name}: ${steps.length} steps, ${toolCalls} tool calls, ${elapsed}ms`);

          // Count positions opened by checking DB (the place_trade tool already created them)
          const tradesPlaced = await prisma.tradeDecision.count({
            where: {
              runId: run.id,
              decision: "BUY",
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
          const isTimeout = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted") || err.message.includes("timed out"));
          const message = isTimeout
            ? `Agent timed out after 4 minutes (${Math.round((Date.now() - t0) / 1000)}s elapsed). Any theses and trades completed before timeout are preserved.`
            : err instanceof Error ? err.message : String(err);
          console.error(`[morning-research] Agent ${isTimeout ? "TIMED OUT" : "FAILED"} for ${config.name}: ${message}`);

          // Check if any theses/trades were placed before the timeout
          const partialTheses = await prisma.thesis.count({ where: { researchRunId: run.id } });
          const partialTrades = await prisma.tradeDecision.count({ where: { runId: run.id, decision: "BUY" } });
          const hasPartialWork = partialTheses > 0 || partialTrades > 0;

          await prisma.researchRun.update({
            where: { id: run.id },
            data: {
              // Mark as COMPLETE if we got partial work (theses/trades preserved), FAILED otherwise
              status: isTimeout && hasPartialWork ? "COMPLETE" : "FAILED",
              completedAt: new Date(),
              parameters: {
                ...(run.parameters as object),
                error: message,
                failedAt: new Date().toISOString(),
                ...(hasPartialWork ? { partialTheses, partialTrades, timedOut: true } : {}),
              } as object,
            },
          });

          return { error: message, partialTheses, partialTrades };
        }
      });

      // Accumulate trades from successful runs
      if (result && typeof result === "object" && "tradesPlaced" in result) {
        totalTradesPlaced += (result as { tradesPlaced: number }).tradesPlaced;
      }
    }

    // ── Step 3: Sweep stale RUNNING runs from this batch ──────────────────
    // If any step.run timed out or was killed, the ResearchRun stays RUNNING.
    // This catch-all ensures they get marked FAILED so they don't appear as live.
    await step.run("sweep-stale-runs", async () => {
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10 min
      const staleRuns = await prisma.researchRun.updateMany({
        where: {
          status: "RUNNING",
          source: "AGENT",
          startedAt: { lt: staleThreshold },
          agentConfigId: { in: configs.map((c) => c.id) },
        },
        data: {
          status: "FAILED",
          completedAt: new Date(),
        },
      });
      if (staleRuns.count > 0) {
        console.warn(`[morning-research] Swept ${staleRuns.count} stale RUNNING runs to FAILED`);
      }
    });

    return { ran: configs.length, totalTradesPlaced };
  }
);
