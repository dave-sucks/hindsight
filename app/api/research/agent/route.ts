import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { createResearchTools } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";
import { updateAnalystBriefing } from "@/lib/agent/update-analyst-briefing";

export const maxDuration = 120; // 2 min for multi-step agent

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

    // Recent closed trades (last 20)
    const recentTrades = await prisma.trade.findMany({
      where: {
        userId: user.id,
        status: "CLOSED",
        ...(configId ? { thesis: { researchRun: { agentConfigId: configId as string } } } : {}),
      },
      orderBy: { closedAt: "desc" },
      take: 20,
      select: {
        ticker: true, direction: true, outcome: true,
        entryPrice: true, closePrice: true, shares: true,
        realizedPnl: true, closeReason: true, closedAt: true,
      },
    });

    // Open trades
    const openTrades = await prisma.trade.findMany({
      where: {
        userId: user.id,
        status: "OPEN",
        ...(configId ? { thesis: { researchRun: { agentConfigId: configId as string } } } : {}),
      },
      select: {
        ticker: true, direction: true, entryPrice: true,
        shares: true, targetPrice: true, stopLoss: true,
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

    // Load analyst briefing if available (the "daily standup" from prior runs)
    let analystBriefing: string | null = null;
    if (configId) {
      const briefingConfig = await prisma.agentConfig.findFirst({
        where: { id: configId as string },
        select: { analystBriefing: true, briefingUpdatedAt: true },
      });
      analystBriefing = briefingConfig?.analystBriefing ?? null;
    }

    // Build context
    const parts: string[] = [];

    // Inject the analyst briefing first — this is the "living memory" of past runs
    if (analystBriefing) {
      parts.push("## Your Latest Portfolio Briefing");
      parts.push("This is your most recent self-assessment from your last research session. Use it to inform today's decisions.\n");
      parts.push(analystBriefing);
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
        parts.push(`- ${t.outcome ?? "?"} ${t.direction} $${t.ticker}: entry $${Number(t.entryPrice).toFixed(2)} → exit $${t.closePrice ? Number(t.closePrice).toFixed(2) : "—"} (${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}, reason: ${t.closeReason ?? "—"})`);
      }
      parts.push(`\nLearn from these results. Avoid repeating patterns that led to losses.`);
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
    console.log(`[agent] History loaded: ${openTrades.length} open, ${recentTrades.length} closed, accuracy=${!!latestAccuracy}, briefing=${!!analystBriefing}`);
  } catch (err) {
    console.warn("[agent] Failed to load history (non-fatal):", err);
  }

  const systemPrompt = buildSystemPrompt(agentConfig) + (historyBlock ? `\n\n${historyBlock}` : "");
  const modelMessages = await convertToModelMessages(messages);
  console.log(`[agent] Config loaded: name=${agentConfig.name || "default"} systemPrompt=${systemPrompt.length} chars`);

  // Create context-aware tools so show_thesis persists and summarize_run completes
  const tools = createResearchTools({
    runId: runId || "",
    userId: user.id,
    watchlist: (agentConfig.watchlist as string[]) ?? [],
    exclusionList: (agentConfig.exclusionList as string[]) ?? [],
    sectors: (agentConfig.sectors as string[]) ?? [],
  });

  const result = streamText({
    model: openai("gpt-4o"),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(25),
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

      // Update analyst briefing (non-blocking, fire-and-forget)
      const resolvedAnalystId = analystId || (await prisma.researchRun.findFirst({
        where: { id: runId },
        select: { agentConfigId: true },
      }))?.agentConfigId;

      if (resolvedAnalystId) {
        updateAnalystBriefing({
          analystId: resolvedAnalystId,
          runId,
          userId: user.id,
        }).catch((err) =>
          console.error("[agent] Briefing update failed:", err)
        );
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
