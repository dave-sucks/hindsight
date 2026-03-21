import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createResearchTools } from "@/lib/agent/tools";
import { buildV2SystemPrompt } from "@/lib/agent/system-prompt";
import { buildRunInput } from "@/lib/agent/run-input";
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

        // 2c. Build system prompt with structured run input
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

        const runInput = await buildRunInput(config.id, config.userId);
        const systemPrompt = buildV2SystemPrompt(agentConfig, runInput);

        // 2d. Create tools with run context
        const tools = createResearchTools({
          runId: run.id,
          userId: config.userId,
          analystId: config.id,
          watchlist: config.watchlist ?? [],
          exclusionList: config.exclusionList ?? [],
          sectors: config.sectors ?? [],
          maxPositionSize: Number(config.maxPositionSize),
          maxOpenPositions: config.maxOpenPositions,
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

          // Ensure run is marked COMPLETE (complete_run tool should have done this,
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

          // V2: Briefing is generated by complete_run tool directly.
          // Fallback: generate briefing if one doesn't exist — covers:
          // 1. Agent didn't call complete_run (hit step limit)
          // 2. complete_run ran but briefing silently failed inside it
          const existingBriefing = await prisma.analystBriefing.findFirst({
            where: { runId: run.id },
            select: { id: true },
          });
          if (!existingBriefing) {
            try {
              console.warn(`[morning-research] No briefing found for run ${run.id} (status=${currentRun?.status}) — generating fallback.`);
              await updateAnalystBriefing({
                analystId: config.id,
                runId: run.id,
                userId: config.userId,
              });
            } catch (briefingErr) {
              console.warn("[morning-research] Fallback briefing failed (non-fatal):", briefingErr);
            }
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
