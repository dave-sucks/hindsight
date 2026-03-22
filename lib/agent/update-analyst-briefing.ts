/**
 * Post-run briefing agent.
 *
 * A SEPARATE agent from the research analyst. After each run completes,
 * this reads the full research conversation + portfolio state and writes
 * a standup brief that feeds into the next run's system prompt.
 *
 * Why separate? The research agent should research. Asking it to also
 * self-reflect wastes tool budget and produces self-serving assessments.
 * An external reviewer reading the full conversation produces better
 * watch-tomorrow items, more honest self-corrections, and a more useful
 * narrative for the next run.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// ── Schema for the briefing agent's output ──────────────────────────────────

const briefingSchema = z.object({
  narrative: z
    .string()
    .describe(
      "400-600 word portfolio briefing in markdown with $TICKER format. Covers: what the analyst did this session, key findings, decisions made with rationale, and current portfolio state."
    ),
  strategyNotes: z
    .string()
    .describe(
      "100-200 word data-driven strategy assessment. What patterns are emerging in wins vs losses? What should change? Be specific and honest."
    ),
  marketPosture: z
    .string()
    .describe(
      "2-3 word market stance summary, e.g. 'cautiously bullish', 'defensive', 'risk-on'. Based on the analyst's actual behavior this session, not just what they said."
    ),
  watchTomorrow: z
    .array(
      z.object({
        symbol: z.string(),
        trigger: z
          .string()
          .describe("Specific condition, e.g. 'price < $145', 'RSI < 30', 'earnings this week'"),
        suggestedAction: z
          .string()
          .describe("What to do if triggered, e.g. 'INITIATE LONG', 'EXIT', 'review thesis'"),
        priority: z.enum(["HIGH", "NORMAL"]).optional(),
      })
    )
    .describe(
      "2-5 most important things to check next session. Derived from: positions near targets/stops, unresolved research, catalysts mentioned, watchlist items with triggers."
    ),
  unresolvedItems: z
    .array(
      z.object({
        item: z.string().describe("What couldn't be resolved"),
        impact: z.string().describe("Why it matters for the portfolio"),
        affectedPositions: z.array(z.string()).optional(),
      })
    )
    .describe(
      "Data gaps, pending catalysts, failed tool calls, tickers the analyst wanted to research but ran out of steps for."
    ),
  selfCorrections: z
    .array(
      z.object({
        observation: z
          .string()
          .describe("Pattern noticed in analyst behavior — concentration risk, momentum chasing, ignoring stops, etc."),
        adjustment: z
          .string()
          .describe("Concrete adjustment for next session"),
      })
    )
    .describe(
      "Behavioral patterns to correct. Be honest — the analyst can't see this prompt, only the output. Flag real issues."
    ),
});

interface BriefingContext {
  analystId: string;
  runId: string;
  userId: string;
}

/**
 * Generate and persist an analyst briefing after a run completes.
 * Reads the full research conversation from RunMessage, loads portfolio
 * state, and uses GPT-4o as a briefing agent to produce the standup.
 *
 * Non-fatal — errors are logged but don't break the run flow.
 */
export async function updateAnalystBriefing({
  analystId,
  runId,
  userId,
}: BriefingContext): Promise<void> {
  try {
    const t0 = Date.now();

    // Load everything in parallel — allSettled so one failure doesn't kill the rest
    const results = await Promise.allSettled([
      // 0: analyst config
      prisma.agentConfig.findFirst({
        where: { id: analystId, userId },
      }),
      // 1: the full research conversation
      prisma.runMessage.findFirst({
        where: { runId },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      }),
      // 2: open positions
      prisma.position.findMany({
        where: { userId, status: "OPEN", analystId },
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
      // 3: recent closed trades
      prisma.position.findMany({
        where: { userId, status: "CLOSED", analystId },
        orderBy: { closedAt: "desc" },
        take: 30,
        select: {
          symbol: true, direction: true, avgCost: true, closePrice: true,
          quantity: true, realizedPnl: true, outcome: true,
          openedAt: true, closedAt: true, closeReason: true,
        },
      }),
      // 4: theses from this run
      prisma.thesis.findMany({
        where: { researchRunId: runId, userId },
        select: {
          ticker: true, direction: true, confidenceScore: true,
          reasoningSummary: true, thesisBullets: true, riskFlags: true,
          entryPrice: true, targetPrice: true, stopLoss: true,
          holdDuration: true, signalTypes: true, sector: true,
        },
      }),
      // 5: positions from this run
      prisma.position.findMany({
        where: {
          userId,
          decisions: { some: { thesis: { researchRunId: runId } } },
        },
        select: {
          symbol: true, direction: true, avgCost: true, quantity: true,
          status: true, targetPrice: true, stopLoss: true,
        },
      }),
      // 6: run summary event
      prisma.runEvent.findFirst({
        where: { runId, type: "run_summary" },
        select: { payload: true },
      }),
      // 7: total completed runs
      prisma.researchRun.count({
        where: { agentConfigId: analystId, userId, status: "COMPLETE" },
      }),
      // 8: previous briefing (for continuity)
      prisma.analystBriefing.findFirst({
        where: { analystId },
        orderBy: { createdAt: "desc" },
        select: {
          narrative: true, strategyNotes: true, marketPosture: true,
          watchTomorrow: true, selfCorrections: true, createdAt: true,
        },
      }),
      // 9: recent PASS decisions
      prisma.tradeDecision.findMany({
        where: { userId, analystId, decision: "PASS" },
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

    // Extract values with safe fallbacks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (i: number, fallback: any) => {
      const r = results[i];
      if (r.status === "fulfilled") return r.value;
      console.warn(`[briefing] Query ${i} failed:`, r.reason);
      return fallback;
    };

    const config = val(0, null);
    const conversationRow = val(1, null);
    const openTrades = val(2, []);
    const recentClosedTrades = val(3, []);
    const runTheses = val(4, []);
    const runTrades = val(5, []);
    const runSummaryEvent = val(6, null);
    const allRunsCount = val(7, 0);
    const previousBriefing = val(8, null);
    const recentPassDecisions = val(9, []);

    if (!config) {
      console.warn(`[briefing] Analyst ${analystId} not found, skipping`);
      return;
    }

    // ── Extract conversation transcript ──────────────────────────────────────
    let conversationTranscript = "No conversation data available for this run.";
    if (conversationRow?.content) {
      try {
        const messages = JSON.parse(conversationRow.content);
        // Build a readable transcript from the AI SDK message format
        const lines: string[] = [];
        for (const msg of messages) {
          if (msg.role === "assistant" && typeof msg.content === "string") {
            lines.push(`[ANALYST]: ${msg.content}`);
          } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
            // AI SDK v6: parts array
            for (const part of msg.content) {
              if (part.type === "text" && part.text) {
                lines.push(`[ANALYST]: ${part.text}`);
              } else if (part.type === "tool-call" || part.type === "tool_call") {
                const name = part.toolName || part.tool_name || "unknown_tool";
                lines.push(`[TOOL CALL]: ${name}(${JSON.stringify(part.args || part.input || {}).slice(0, 200)})`);
              } else if (part.type === "tool-result" || part.type === "tool_result") {
                const name = part.toolName || part.tool_name || "tool";
                const result = JSON.stringify(part.result || part.output || {}).slice(0, 500);
                lines.push(`[TOOL RESULT ${name}]: ${result}`);
              }
            }
          } else if (msg.role === "tool") {
            // Tool response messages
            const content = Array.isArray(msg.content) ? msg.content : [msg.content];
            for (const part of content) {
              if (part?.type === "tool-result" || typeof part === "object") {
                const result = JSON.stringify(part?.result || part || {}).slice(0, 500);
                lines.push(`[TOOL RESULT]: ${result}`);
              }
            }
          }
        }
        if (lines.length > 0) {
          // Cap at ~12k chars to fit in prompt without blowing up tokens
          conversationTranscript = lines.join("\n").slice(0, 12000);
          if (lines.join("\n").length > 12000) {
            conversationTranscript += "\n[...transcript truncated]";
          }
        }
      } catch (parseErr) {
        console.warn("[briefing] Failed to parse conversation:", parseErr);
      }
    }

    // ── Compute portfolio stats ──────────────────────────────────────────────
    const totalInvested = openTrades.reduce(
      (sum: number, t: { avgCost: number; quantity: number }) => sum + t.avgCost * t.quantity, 0
    );
    const closedPnl = recentClosedTrades.reduce(
      (sum: number, t: { realizedPnl: number | null }) => sum + (t.realizedPnl ?? 0), 0
    );
    const wins = recentClosedTrades.filter(
      (t: { outcome: string | null }) => t.outcome === "WIN"
    ).length;
    const losses = recentClosedTrades.filter(
      (t: { outcome: string | null }) => t.outcome === "LOSS"
    ).length;
    const winRate = wins + losses > 0 ? wins / (wins + losses) : null;

    // ── Build structured data for the briefing row ───────────────────────────
    const runSummaryPayload = runSummaryEvent?.payload as Record<string, unknown> | null;
    const marketContext = runSummaryPayload
      ? {
          summary: runSummaryPayload.summary as string | undefined,
          rankedPicks: runSummaryPayload.ranked_picks,
          riskNotes: runSummaryPayload.risk_notes,
          overallAssessment: runSummaryPayload.overall_assessment,
        }
      : null;

    const thesesData = runTheses.map((t: {
      ticker: string; direction: string; confidenceScore: number;
      reasoningSummary: string; thesisBullets: string[]; riskFlags: string[];
      entryPrice: number | null; targetPrice: number | null; stopLoss: number | null;
      holdDuration: string; signalTypes: string[];
    }) => ({
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

    const tradesData = runTrades.map((t: {
      symbol: string; direction: string; avgCost: number;
      quantity: number; status: string; targetPrice: number | null; stopLoss: number | null;
    }) => ({
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

    // ── Build briefing agent prompt ──────────────────────────────────────────

    const openPositionsText = openTrades.length > 0
      ? openTrades.map((t: { symbol: string; direction: string; quantity: number; avgCost: number; decisions: Array<{ thesis: { confidenceScore: number; reasoningSummary: string } | null }> }) => {
          const thesis = t.decisions[0]?.thesis;
          return `- $${t.symbol}: ${t.direction} ${t.quantity} shares @ $${t.avgCost.toFixed(2)} (confidence: ${thesis?.confidenceScore ?? "?"}%, thesis: "${thesis?.reasoningSummary?.slice(0, 100) ?? "—"}")`;
        }).join("\n")
      : "No open positions.";

    const recentTradesText = recentClosedTrades.length > 0
      ? recentClosedTrades.slice(0, 15).map((t: {
          outcome: string | null; symbol: string; direction: string;
          avgCost: number; closePrice: number | null; realizedPnl: number | null;
          closeReason: string | null;
        }) => {
          const pnl = t.realizedPnl ?? 0;
          const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
          return `- ${t.outcome ?? "?"} $${t.symbol}: ${t.direction} entry $${t.avgCost.toFixed(2)} → exit $${(t.closePrice ?? 0).toFixed(2)} (${pnlStr}, closed: ${t.closeReason ?? "?"})`;
        }).join("\n")
      : "No closed trades yet.";

    const winRateStr = winRate != null ? `${(winRate * 100).toFixed(0)}%` : "N/A";

    // Previous briefing for continuity
    const previousBriefingText = previousBriefing
      ? `\n## Previous Briefing (${previousBriefing.createdAt.toISOString().slice(0, 10)})
Market Posture: ${previousBriefing.marketPosture ?? "not set"}
Narrative: ${previousBriefing.narrative.slice(0, 400)}
Strategy Notes: ${previousBriefing.strategyNotes?.slice(0, 200) ?? "none"}
${previousBriefing.watchTomorrow ? `Watch Tomorrow: ${JSON.stringify(previousBriefing.watchTomorrow).slice(0, 300)}` : ""}
${previousBriefing.selfCorrections ? `Self-Corrections: ${JSON.stringify(previousBriefing.selfCorrections).slice(0, 300)}` : ""}`
      : "";

    const passDecisionsText = recentPassDecisions.length > 0
      ? recentPassDecisions.map((d: {
          symbol: string; createdAt: Date; reasoning: string | null;
          thesis: { entryPrice: number | null; confidenceScore: number | null } | null;
        }) => {
          const dateStr = d.createdAt.toISOString().slice(0, 10);
          return `- PASS: $${d.symbol} on ${dateStr} (confidence: ${d.thesis?.confidenceScore ?? "?"}%) — ${d.reasoning?.slice(0, 100) ?? "no reason"}`;
        }).join("\n")
      : "No pass decisions recorded yet.";

    const briefingPrompt = `You are a portfolio desk editor reviewing the research session of an AI analyst named "${config.name}". Your job is to write the standup brief that this analyst will see at the START of its next session. This brief is the analyst's memory — it's the most important document for run-to-run continuity.

You have access to the FULL research conversation transcript below. Read it carefully — the analyst's actual reasoning, tool calls, and decisions are all here. Do not rely solely on the summary stats; the conversation reveals nuances the numbers miss.

## Analyst Strategy
${config.analystPrompt || "General market research analyst."}

## Research Session Transcript
${conversationTranscript}

## Portfolio State

### Open Positions (${openTrades.length} active)
Total invested: $${totalInvested.toFixed(2)}
${openPositionsText}

### Recent Trade History (${recentClosedTrades.length} closed trades)
Win Rate: ${winRateStr} (${wins}W / ${losses}L)
Total P&L from closed trades: ${closedPnl >= 0 ? "+" : ""}$${closedPnl.toFixed(2)}
${recentTradesText}

### This Session
Theses generated: ${runTheses.length}
Trades executed: ${runTrades.length}
Total completed sessions: ${allRunsCount}

### Recent Pass Decisions
${passDecisionsText}
${previousBriefingText}

## Your Task

Write a standup brief for this analyst's NEXT session. The analyst will see this brief in its system prompt and must reference it in its Phase 0 check-in. Focus on what's ACTIONABLE.

Rules:
- Use $TICKER format for all stock symbols
- Be data-driven — cite actual prices, P&L numbers, confidence scores from the conversation
- Be honest about the analyst's mistakes — you're the editor, not the cheerleader
- watchTomorrow: derive from positions near targets/stops, catalysts mentioned in conversation, unfinished research
- selfCorrections: look for REAL patterns — did the analyst over-concentrate? Chase momentum? Ignore risk flags? Skip watchlist items? If the previous briefing had selfCorrections, check if the analyst actually followed through
- Build on the previous briefing — show progression of thinking, don't repeat the same observations
- The narrative is the analyst's memory. Be specific enough that it can quote this brief next session.`;

    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: briefingSchema,
      prompt: briefingPrompt,
    });

    // ── Persist the briefing row ─────────────────────────────────────────────

    const coreData = {
      analystId,
      runId,
      userId,
      narrative: object.narrative,
      marketContext: marketContext as object | undefined,
      theses: thesesData as object[],
      trades: tradesData as object[],
      portfolioSnapshot: portfolioSnapshot as object,
      strategyNotes: object.strategyNotes,
    };

    const v2Data = {
      marketPosture: object.marketPosture,
      watchTomorrow: object.watchTomorrow as object[],
      unresolvedItems: object.unresolvedItems as object[],
      selfCorrections: object.selfCorrections as object[],
    };

    // Try with V2 fields first, fall back to core-only if columns don't exist
    try {
      const fullData = { ...coreData, ...v2Data };
      await prisma.analystBriefing.upsert({
        where: { runId },
        create: fullData,
        update: fullData,
      });
    } catch (v2Err: unknown) {
      const errMsg = v2Err instanceof Error ? v2Err.message : String(v2Err);
      if (
        errMsg.includes("marketPosture") ||
        errMsg.includes("watchTomorrow") ||
        errMsg.includes("unresolvedItems") ||
        errMsg.includes("selfCorrections") ||
        errMsg.includes("Unknown arg")
      ) {
        console.warn("[briefing] V2 columns not available, falling back to core schema");
        await prisma.analystBriefing.upsert({
          where: { runId },
          create: coreData,
          update: coreData,
        });
      } else {
        throw v2Err;
      }
    }

    const elapsed = Date.now() - t0;
    console.log(
      `[briefing] Created briefing for ${config.name} (${analystId}) runId=${runId} in ${elapsed}ms (briefing agent via GPT-4o)`
    );
  } catch (err) {
    console.error(
      `[briefing] Failed to create briefing for analyst ${analystId}:`,
      err
    );
    // Non-fatal — don't throw
  }
}
