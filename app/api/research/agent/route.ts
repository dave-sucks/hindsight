import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { waitUntil } from "@vercel/functions";
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

    // Recent closed trades (last 20) with evaluation data
    const recentTrades = await prisma.trade.findMany({
      where: {
        userId: user.id,
        status: "CLOSED",
        ...(configId ? { thesis: { researchRun: { agentConfigId: configId as string } } } : {}),
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

    // Recent shadow-closed trades (pass tracking results)
    const shadowTrades = await prisma.trade.findMany({
      where: {
        userId: user.id,
        status: "SHADOW_CLOSED",
        ...(configId ? { thesis: { researchRun: { agentConfigId: configId as string } } } : {}),
      },
      orderBy: { closedAt: "desc" },
      take: 10,
      select: {
        ticker: true, entryPrice: true, closePrice: true,
        realizedPnl: true, outcome: true, closedAt: true,
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

    if (recentRuns.length > 0) {
      parts.push(`\n## Recent Research Sessions: ${recentRuns.length} completed`);
    }

    historyBlock = parts.join("\n");
    console.log(`[agent] History loaded: ${openTrades.length} open, ${recentTrades.length} closed, accuracy=${!!latestAccuracy}, briefings=${recentBriefings.length}`);
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
    maxPositionSize: (agentConfig.maxPositionSize as number) ?? undefined,
  });

  const result = streamText({
    model: openai("gpt-4.1"),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(30),
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

  return result.toUIMessageStreamResponse();
}
