import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { createResearchTools } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";
import { updateAnalystBriefing } from "@/lib/agent/update-analyst-briefing";

export const maxDuration = 300; // 5 min for multi-step agent

// Helper to mark a run as FAILED + write error event
async function markRunFailed(runId: string | undefined, error: string) {
  if (!runId) return;
  try {
    await prisma.researchRun.update({
      where: { id: runId },
      data: { status: "FAILED" },
    });
    await prisma.runEvent.create({
      data: {
        runId,
        type: "run_error",
        title: "Run failed",
        message: error.slice(0, 500),
        payload: { error } as object,
      },
    });
    console.error(`[agent] Run ${runId} marked FAILED: ${error}`);
  } catch (err) {
    console.error(`[agent] Failed to mark run ${runId} as FAILED:`, err);
  }
}

export async function POST(req: Request) {
  const t0 = Date.now();

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.warn("[agent] Unauthorized request");
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages, runId, analystId, config } = await req.json();
  console.log(`[agent] POST runId=${runId} analystId=${analystId} messages=${messages?.length ?? 0}`);

  // Load agent config — try analystId first, then from the run's linked config
  let agentConfig: Record<string, unknown> = config || {};

  // Direct analystId takes priority
  if (analystId) {
    const ac = await prisma.agentConfig.findFirst({
      where: { id: analystId, userId: user.id },
    });
    if (ac) {
      agentConfig = {
        name: ac.name,
        analystPrompt: ac.analystPrompt,
        directionBias: ac.directionBias,
        holdDurations: ac.holdDurations,
        sectors: ac.sectors,
        signalTypes: ac.signalTypes,
        minConfidence: ac.minConfidence,
        maxPositionSize: ac.maxPositionSize ? Number(ac.maxPositionSize) : undefined,
        maxOpenPositions: ac.maxOpenPositions,
        watchlist: ac.watchlist,
        exclusionList: ac.exclusionList,
      };
    }
  }

  // Fall back to loading from the run's linked agentConfig
  if (!agentConfig.name && runId) {
    const run = await prisma.researchRun.findFirst({
      where: { id: runId, userId: user.id },
      include: { agentConfig: true },
    });
    if (run?.agentConfig) {
      agentConfig = {
        name: run.agentConfig.name,
        analystPrompt: run.agentConfig.analystPrompt,
        directionBias: run.agentConfig.directionBias,
        holdDurations: run.agentConfig.holdDurations,
        sectors: run.agentConfig.sectors,
        signalTypes: run.agentConfig.signalTypes,
        minConfidence: run.agentConfig.minConfidence,
        maxPositionSize: run.agentConfig.maxPositionSize
          ? Number(run.agentConfig.maxPositionSize)
          : undefined,
        maxOpenPositions: run.agentConfig.maxOpenPositions,
        watchlist: run.agentConfig.watchlist,
        exclusionList: run.agentConfig.exclusionList,
      };
    }
    if (run?.parameters && typeof run.parameters === "object") {
      const params = run.parameters as Record<string, unknown>;
      if (!agentConfig.name && params.analystName) {
        agentConfig.name = params.analystName;
      }
    }
  }

  // ── Load historical context: recent trades + accuracy stats + briefing ────
  let historyBlock = "";
  try {
    const configId = analystId || (agentConfig as Record<string, unknown>).id;

    // Recent closed positions (last 20) with evaluation data
    const recentTrades = await prisma.position.findMany({
      where: {
        userId: user.id,
        status: "CLOSED",
        ...(configId ? { analystId: configId as string } : {}),
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

    // Open positions
    const openTrades = await prisma.position.findMany({
      where: {
        userId: user.id,
        status: "OPEN",
        ...(configId ? { analystId: configId as string } : {}),
      },
      select: {
        symbol: true, direction: true, avgCost: true,
        quantity: true, targetPrice: true, stopLoss: true,
        createdAt: true,
      },
    });

    // Latest accuracy report
    const latestAccuracy = await prisma.accuracyReport.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        winRate: true, tradesAnalyzed: true,
        narrativeSummary: true,
      },
    });

    // Recent run summaries (last 5)
    const recentRuns = await prisma.researchRun.findMany({
      where: {
        userId: user.id,
        status: "COMPLETE",
        ...(configId ? { agentConfigId: configId as string } : {}),
      },
      orderBy: { completedAt: "desc" },
      take: 5,
      select: { id: true, completedAt: true },
    });

    // Load recent briefings from the new AnalystBriefing table (accumulating history)
    let recentBriefings: { narrative: string; strategyNotes: string | null; createdAt: Date }[] = [];
    if (configId) {
      recentBriefings = await prisma.analystBriefing.findMany({
        where: { analystId: configId as string },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { narrative: true, strategyNotes: true, createdAt: true },
      });
    }

    // Recent PASS decisions (replaces shadow trades)
    const passDecisions = await prisma.tradeDecision.findMany({
      where: {
        userId: user.id,
        decision: "PASS",
        ...(configId ? { analystId: configId as string } : {}),
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

    // Build context
    const parts: string[] = [];

    // Inject recent briefings — the evolving "living memory" of past runs
    if (recentBriefings.length > 0) {
      parts.push("## Your Recent Briefings");
      parts.push("These are your self-assessments from recent research sessions. Use them to inform today's decisions and track your evolving strategy.\n");
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

    if (recentRuns.length > 0) {
      parts.push(`\n## Recent Research Sessions: ${recentRuns.length} completed`);
    }

    historyBlock = parts.join("\n");
    console.log(`[agent] History loaded: ${openTrades.length} open positions, ${recentTrades.length} closed, ${passDecisions.length} passes, accuracy=${!!latestAccuracy}, briefings=${recentBriefings.length}`);
  } catch (err) {
    console.warn("[agent] Failed to load history (non-fatal):", err);
  }

  const systemPrompt = buildSystemPrompt(agentConfig) + (historyBlock ? `\n\n${historyBlock}` : "");
  const modelMessages = await convertToModelMessages(messages);
  console.log(`[agent] Config loaded: name=${agentConfig.name || "default"} systemPrompt=${systemPrompt.length} chars`);

  // Create context-aware tools so show_thesis persists and summarize_run completes
  const resolvedAnalystId = analystId || (runId ? (await prisma.researchRun.findFirst({
    where: { id: runId },
    select: { agentConfigId: true },
  }))?.agentConfigId : null);

  const tools = createResearchTools({
    runId: runId || "",
    userId: user.id,
    analystId: resolvedAnalystId || undefined,
    watchlist: (agentConfig.watchlist as string[]) ?? [],
    exclusionList: (agentConfig.exclusionList as string[]) ?? [],
    sectors: (agentConfig.sectors as string[]) ?? [],
    maxPositionSize: (agentConfig.maxPositionSize as number) ?? undefined,
  });

  const result = streamText({
    model: openai("gpt-4.1"),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(30),
    onError({ error }) {
      const elapsed = Date.now() - t0;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[agent] onError runId=${runId} elapsed=${elapsed}ms: ${msg}`);
      waitUntil(markRunFailed(runId, msg));
    },
    onStepFinish({ stepNumber, toolCalls, text, finishReason, usage }) {
      const elapsed = Date.now() - t0;
      const ts = new Date().toISOString().slice(11, 23);
      const toolNames = toolCalls.map((tc) => tc.toolName).join(", ") || "none";
      const textPreview = text?.slice(0, 100)?.replace(/\n/g, " ") || "";
      console.log(
        `[agent] ${ts} STEP #${stepNumber} runId=${runId} elapsed=${elapsed}ms tools=[${toolNames}] finish=${finishReason} tokens=${usage?.totalTokens ?? "?"} text="${textPreview}${text && text.length > 100 ? "..." : ""}"`
      );
      if (elapsed > 240_000) {
        console.warn(`[agent] ⚠️ Run ${runId} approaching timeout at ${(elapsed / 1000).toFixed(0)}s`);
      }
    },
    async onFinish({ response }) {
      const elapsed = Date.now() - t0;
      console.log(`[agent] onFinish runId=${runId} elapsed=${elapsed}ms responseMsgs=${response.messages.length}`);

      // Persist all messages from this exchange so the conversation can be replayed.
      if (!runId) return;
      try {
        const allMessages = [...messages, ...response.messages];
        await prisma.runMessage.deleteMany({ where: { runId } });
        await prisma.runMessage.create({
          data: {
            runId,
            role: "thread",
            content: JSON.stringify(allMessages),
          },
        });
        console.log(`[agent] Persisted ${allMessages.length} messages for runId=${runId}`);
      } catch (err) {
        console.error("[agent] Failed to persist messages:", err);
      }

      // Update analyst briefing — use waitUntil so Vercel keeps the
      // function alive after the stream closes for this async work
      const resolvedAnalystId = analystId || (await prisma.researchRun.findFirst({
        where: { id: runId },
        select: { agentConfigId: true },
      }))?.agentConfigId;

      if (resolvedAnalystId) {
        waitUntil(
          updateAnalystBriefing({
            analystId: resolvedAnalystId,
            runId,
            userId: user.id,
          }).catch((err) =>
            console.error("[agent] Briefing update failed:", err)
          )
        );
      }
    },
  });

  try {
    return result.toUIMessageStreamResponse();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown agent error";
    console.error(`[agent] Stream response failed for runId=${runId}: ${msg}`);
    await markRunFailed(runId, msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
}
