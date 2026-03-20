/**
 * Post-run analyst briefing generator.
 *
 * After each research run completes, this creates a new AnalystBriefing row
 * with structured data (theses, trades, portfolio snapshot, market context)
 * plus an AI-generated narrative and strategy notes.
 *
 * Each briefing is a permanent record that accumulates over time — the analyst
 * gets smarter because each briefing feeds forward into the next run's
 * system prompt.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export interface StructuredBriefInput {
  marketPosture?: string;
  watchTomorrow?: Array<{ symbol: string; trigger: string; suggested_action: string; priority?: string }>;
  unresolvedItems?: Array<{ item: string; impact: string; affected_positions?: string[] }>;
  selfCorrections?: Array<{ observation: string; adjustment: string }>;
}

interface BriefingContext {
  analystId: string;
  runId: string;
  userId: string;
  structuredBrief?: StructuredBriefInput;
}

const briefingSchema = z.object({
  narrative: z
    .string()
    .describe(
      "Portfolio briefing in markdown with $TICKER format. 400-600 words covering: portfolio status, recent activity, performance review, and tomorrow's focus."
    ),
  strategyNotes: z
    .string()
    .describe(
      "Specific strategy adjustments based on performance data. What's working, what's not, what to change. 100-200 words."
    ),
});

/**
 * Generate and persist an analyst briefing after a run completes.
 * Creates a new AnalystBriefing row and updates the AgentConfig summary.
 * Non-fatal — errors are logged but don't break the run flow.
 */
export async function updateAnalystBriefing({
  analystId,
  runId,
  userId,
  structuredBrief,
}: BriefingContext): Promise<void> {
  try {
    const t0 = Date.now();

    // Load everything we need in parallel
    const [
      config,
      openTrades,
      recentClosedTrades,
      runTheses,
      runTrades,
      runSummaryEvent,
      allRunsCount,
      previousBriefing,
      recentPassDecisions,
    ] = await Promise.all([
      prisma.agentConfig.findFirst({
        where: { id: analystId, userId },
      }),
      prisma.position.findMany({
        where: {
          userId,
          status: "OPEN",
          analystId,
        },
        include: {
          decisions: {
            take: 1,
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
          },
        },
        orderBy: { openedAt: "desc" },
      }),
      prisma.position.findMany({
        where: {
          userId,
          status: "CLOSED",
          analystId,
        },
        orderBy: { closedAt: "desc" },
        take: 30,
        select: {
          symbol: true,
          direction: true,
          avgCost: true,
          closePrice: true,
          quantity: true,
          realizedPnl: true,
          outcome: true,
          openedAt: true,
          closedAt: true,
          closeReason: true,
          decisions: {
            take: 1,
            select: {
              thesis: {
                select: {
                  confidenceScore: true,
                  reasoningSummary: true,
                  signalTypes: true,
                },
              },
            },
          },
        },
      }),
      // Theses from THIS run (for structured data capture)
      prisma.thesis.findMany({
        where: { researchRunId: runId, userId },
        select: {
          ticker: true,
          direction: true,
          confidenceScore: true,
          reasoningSummary: true,
          thesisBullets: true,
          riskFlags: true,
          entryPrice: true,
          targetPrice: true,
          stopLoss: true,
          holdDuration: true,
          signalTypes: true,
          sector: true,
        },
      }),
      // Positions from THIS run (for structured data capture)
      prisma.position.findMany({
        where: {
          userId,
          decisions: { some: { thesis: { researchRunId: runId } } },
        },
        select: {
          symbol: true,
          direction: true,
          avgCost: true,
          quantity: true,
          status: true,
          targetPrice: true,
          stopLoss: true,
        },
      }),
      // Run summary event (market context)
      prisma.runEvent.findFirst({
        where: { runId, type: "run_summary" },
        select: { payload: true },
      }),
      // Total run count
      prisma.researchRun.count({
        where: { agentConfigId: analystId, userId, status: "COMPLETE" },
      }),
      // Previous briefing for continuity
      prisma.analystBriefing.findFirst({
        where: { analystId },
        orderBy: { createdAt: "desc" },
        select: { narrative: true, strategyNotes: true, createdAt: true },
      }),
      // Recent PASS decisions (replaces old shadow trade tracking)
      prisma.tradeDecision.findMany({
        where: {
          userId,
          analystId,
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
      }),
    ]);

    if (!config) {
      console.warn(`[briefing] Analyst ${analystId} not found, skipping`);
      return;
    }

    // ── Compute portfolio stats ──────────────────────────────────────────────
    const totalInvested = openTrades.reduce(
      (sum, t) => sum + t.avgCost * t.quantity,
      0
    );
    const closedPnl = recentClosedTrades.reduce(
      (sum, t) => sum + (t.realizedPnl ?? 0),
      0
    );
    const wins = recentClosedTrades.filter(
      (t) => t.outcome === "WIN"
    ).length;
    const losses = recentClosedTrades.filter(
      (t) => t.outcome === "LOSS"
    ).length;
    const winRate =
      wins + losses > 0 ? wins / (wins + losses) : null;

    // ── Build structured data for the briefing row ───────────────────────────

    // Market context from run summary event
    const runSummaryPayload = runSummaryEvent?.payload as Record<
      string,
      unknown
    > | null;
    const marketContext = runSummaryPayload
      ? {
          summary: runSummaryPayload.summary as string | undefined,
          rankedPicks: runSummaryPayload.ranked_picks,
          riskNotes: runSummaryPayload.risk_notes,
          overallAssessment: runSummaryPayload.overall_assessment,
        }
      : null;

    // Theses from this run — shape matches ThesisCardData
    const thesesData = runTheses.map((t) => ({
      ticker: t.ticker,
      direction: t.direction,
      confidence_score: t.confidenceScore,
      reasoning_summary: t.reasoningSummary,
      thesis_bullets: t.thesisBullets,
      risk_flags: t.riskFlags,
      entry_price: t.entryPrice,
      target_price: t.targetPrice,
      stop_loss: t.stopLoss,
      hold_duration: t.holdDuration,
      signal_types: t.signalTypes,
    }));

    // Positions from this run — shape matches TradeCardData
    const tradesData = runTrades.map((t) => ({
      ticker: t.symbol,
      direction: t.direction,
      entryPrice: t.avgCost,
      shares: t.quantity,
      status: t.status,
      targetPrice: t.targetPrice,
      stopLoss: t.stopLoss,
    }));

    const portfolioSnapshot = {
      openPositions: openTrades.length,
      totalInvested,
      closedPnl,
      winRate,
      wins,
      losses,
      totalTrades: recentClosedTrades.length,
      totalRuns: allRunsCount,
    };

    // ── Build AI prompt with full context ────────────────────────────────────

    const openPositionsText =
      openTrades.length > 0
        ? openTrades
            .map(
              (t) => {
                const thesis = t.decisions[0]?.thesis;
                return `- $${t.symbol}: ${t.direction} ${t.quantity} shares @ $${t.avgCost.toFixed(2)} (confidence: ${thesis?.confidenceScore ?? "?"}%, thesis: "${thesis?.reasoningSummary?.slice(0, 100) ?? "—"}")`;
              }
            )
            .join("\n")
        : "No open positions.";

    const recentTradesText =
      recentClosedTrades.length > 0
        ? recentClosedTrades
            .slice(0, 15)
            .map((t) => {
              const pnl = t.realizedPnl ?? 0;
              const pnlStr =
                pnl >= 0
                  ? `+$${pnl.toFixed(2)}`
                  : `-$${Math.abs(pnl).toFixed(2)}`;
              return `- ${t.outcome ?? "?"} $${t.symbol}: ${t.direction} entry $${t.avgCost.toFixed(2)} → exit $${(t.closePrice ?? 0).toFixed(2)} (${pnlStr}, closed: ${t.closeReason ?? "?"})`;
            })
            .join("\n")
        : "No closed trades yet.";

    const winRateStr =
      winRate != null ? `${(winRate * 100).toFixed(0)}%` : "N/A";

    const runSummaryText = runSummaryPayload
      ? JSON.stringify(runSummaryPayload).slice(0, 500)
      : "No summary available from latest run.";

    // Include previous briefing for continuity
    const previousBriefingText = previousBriefing
      ? `\n## Previous Briefing (${previousBriefing.createdAt.toISOString().slice(0, 10)})\n${previousBriefing.narrative.slice(0, 400)}\n\nPrevious strategy notes: ${previousBriefing.strategyNotes?.slice(0, 200) ?? "none"}`
      : "";

    const briefingPrompt = `You are ${config.name}, an AI research analyst managing a paper trading portfolio. Generate your daily standup briefing — as if a portfolio manager just called and asked "How's my portfolio? What's our strategy?"

## Your Core Strategy
${config.analystPrompt || "General market research analyst."}

## Portfolio Data

### Open Positions (${openTrades.length} active)
Total invested: $${totalInvested.toFixed(2)}
${openPositionsText}

### Recent Trade History (${recentClosedTrades.length} closed trades)
Win Rate: ${winRateStr} (${wins}W / ${losses}L)
Total P&L from closed trades: ${closedPnl >= 0 ? "+" : ""}$${closedPnl.toFixed(2)}
${recentTradesText}

### Today's Run
Theses generated: ${runTheses.length}
Trades placed: ${runTrades.length}
Run summary: ${runSummaryText}
${previousBriefingText}

### Recent Pass Decisions
${recentPassDecisions.length > 0
  ? recentPassDecisions.map((d) => {
      const entryPrice = d.thesis?.entryPrice;
      const confidence = d.thesis?.confidenceScore;
      const dateStr = d.createdAt.toISOString().slice(0, 10);
      return `- PASS: $${d.symbol} on ${dateStr} (confidence: ${confidence ?? "?"}%, entry was $${entryPrice ? Number(entryPrice).toFixed(2) : "?"}) — ${d.reasoning?.slice(0, 100) ?? "no reason"}`;
    }).join("\n")
  : "No pass decisions recorded yet."}

### Session Stats
Total completed research sessions: ${allRunsCount}
${structuredBrief?.marketPosture ? `\n### Agent's Market Posture\n${structuredBrief.marketPosture}` : ""}
${structuredBrief?.watchTomorrow?.length ? `\n### Watch Tomorrow\n${structuredBrief.watchTomorrow.map((w) => `- $${w.symbol}: ${w.trigger} → ${w.suggested_action}${w.priority === "HIGH" ? " [HIGH]" : ""}`).join("\n")}` : ""}
${structuredBrief?.unresolvedItems?.length ? `\n### Unresolved Items\n${structuredBrief.unresolvedItems.map((u) => `- ${u.item} — Impact: ${u.impact}${u.affected_positions?.length ? ` — Affects: ${u.affected_positions.join(", ")}` : ""}`).join("\n")}` : ""}
${structuredBrief?.selfCorrections?.length ? `\n### Self-Corrections\n${structuredBrief.selfCorrections.map((s) => `- Observation: ${s.observation} → Adjustment: ${s.adjustment}`).join("\n")}` : ""}

## Instructions

Generate a structured briefing with two parts:

**narrative**: Write a concise portfolio briefing in markdown. Structure it as a real financial advisor on a client call:
1. Portfolio Status — Open positions, what we're holding and why
2. Recent Activity — What we bought/sold recently, outcomes
3. Performance Review — Win rate, P&L trends, what's working vs not
4. Pass Accuracy — If pass decisions exist, reflect on whether those passes were the right call
5. Tomorrow's Focus — What to look for next session

**strategyNotes**: Specific, data-driven strategy adjustments. What patterns do you see in wins vs losses? What should we do differently? Be honest and actionable.

Rules:
- Use **$TICKER** format for ALL stock symbols (renders as interactive badges)
- Be data-driven — cite actual numbers
- Be honest about failures
- Build on the previous briefing — show progression of thinking
- Keep narrative to 400-600 words, strategy notes to 100-200 words`;

    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: briefingSchema,
      prompt: briefingPrompt,
    });

    // ── Persist the briefing row ─────────────────────────────────────────────

    await prisma.analystBriefing.create({
      data: {
        analystId,
        runId,
        userId,
        narrative: object.narrative,
        marketContext: marketContext as object | undefined,
        theses: thesesData as object[],
        trades: tradesData as object[],
        portfolioSnapshot: portfolioSnapshot as object,
        strategyNotes: object.strategyNotes,
        // V2: Structured brief fields from agent
        marketPosture: structuredBrief?.marketPosture ?? null,
        watchTomorrow: (structuredBrief?.watchTomorrow as object[]) ?? null,
        unresolvedItems: (structuredBrief?.unresolvedItems as object[]) ?? null,
        selfCorrections: (structuredBrief?.selfCorrections as object[]) ?? null,
      },
    });

    const elapsed = Date.now() - t0;
    console.log(
      `[briefing] Created briefing for ${config.name} (${analystId}) runId=${runId} in ${elapsed}ms`
    );
  } catch (err) {
    console.error(
      `[briefing] Failed to create briefing for analyst ${analystId}:`,
      err
    );
    // Non-fatal — don't throw
  }
}
