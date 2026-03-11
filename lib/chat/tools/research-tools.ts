/**
 * Research chat tools — DAV-127
 *
 * research_ticker, get_thesis, compare_tickers, explain_decision
 *
 * Each tool returns structured data for ThesisCard rendering in chat.
 */
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// ─── Tool factories ──────────────────────────────────────────────────────────

/**
 * Creates research tools bound to the current user.
 * pythonServiceUrl is read from env at call time.
 */
export function createResearchTools(userId: string) {
  const pythonUrl = process.env.PYTHON_SERVICE_URL || "http://localhost:8000";
  const pythonSecret = process.env.PYTHON_SERVICE_SECRET || "";

  return {
    research_ticker: tool({
      description:
        "Run full research pipeline (Data-CoT + Concept-CoT + Thesis-CoT) on a single ticker. " +
        "Returns a complete trade thesis with direction, confidence, entry/target/stop prices.",
      inputSchema: z.object({
        symbol: z.string().describe("Stock ticker symbol to research (e.g. NVDA)"),
      }),
      execute: async ({ symbol }) => {
        const ticker = symbol.toUpperCase();

        try {
          const res = await fetch(`${pythonUrl}/research/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Service-Secret": pythonSecret,
            },
            body: JSON.stringify({
              tickers: [ticker],
              source: "MANUAL",
              agent_config: {},
            }),
          });

          if (!res.ok) {
            return { error: `Research service returned ${res.status}` };
          }

          const data = await res.json();
          const thesis = data.theses?.[0];
          if (!thesis) {
            return { error: `No thesis generated for ${ticker}` };
          }

          // Store thesis in DB
          await prisma.thesis.create({
            data: {
              userId,
              ticker: thesis.ticker,
              source: "MANUAL",
              direction: thesis.direction,
              entryPrice: thesis.entry_price,
              targetPrice: thesis.target_price,
              stopLoss: thesis.stop_loss,
              holdDuration: thesis.hold_duration,
              confidenceScore: thesis.confidence_score,
              reasoningSummary: thesis.reasoning_summary,
              thesisBullets: thesis.thesis_bullets || [],
              riskFlags: thesis.risk_flags || [],
              signalTypes: thesis.signal_types || [],
              sector: thesis.sector,
              sourcesUsed: thesis.sources_used || [],
              modelUsed: thesis.model_used || "gpt-4o",
            },
          });

          return {
            ticker: thesis.ticker,
            direction: thesis.direction,
            confidence_score: thesis.confidence_score,
            hold_duration: thesis.hold_duration,
            reasoning_summary: thesis.reasoning_summary,
            thesis_bullets: thesis.thesis_bullets,
            risk_flags: thesis.risk_flags,
            entry_price: thesis.entry_price,
            target_price: thesis.target_price,
            stop_loss: thesis.stop_loss,
            signal_types: thesis.signal_types,
            sector: thesis.sector,
            recommendation_label: thesis.recommendation_label,
            risk_reward_ratio: thesis.risk_reward_ratio,
            invalidation: thesis.invalidation,
            catalyst: thesis.catalyst,
          };
        } catch (err) {
          return {
            error: err instanceof Error ? err.message : "Research failed",
          };
        }
      },
    }),

    get_thesis: tool({
      description:
        "Retrieve a previously generated thesis by ticker symbol or thesis ID. " +
        "Returns the most recent thesis for the given ticker.",
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe("Ticker symbol to look up"),
        thesisId: z
          .string()
          .optional()
          .describe("Specific thesis ID"),
      }),
      execute: async ({ symbol, thesisId }) => {
        let thesis;
        if (thesisId) {
          thesis = await prisma.thesis.findUnique({
            where: { id: thesisId },
          });
        } else if (symbol) {
          thesis = await prisma.thesis.findFirst({
            where: { userId, ticker: symbol.toUpperCase() },
            orderBy: { createdAt: "desc" },
          });
        }

        if (!thesis) {
          return {
            error: `No thesis found for ${symbol || thesisId}`,
          };
        }

        return {
          thesisId: thesis.id,
          ticker: thesis.ticker,
          direction: thesis.direction,
          confidence_score: thesis.confidenceScore,
          hold_duration: thesis.holdDuration,
          reasoning_summary: thesis.reasoningSummary,
          thesis_bullets: thesis.thesisBullets,
          risk_flags: thesis.riskFlags,
          entry_price: thesis.entryPrice,
          target_price: thesis.targetPrice,
          stop_loss: thesis.stopLoss,
          signal_types: thesis.signalTypes,
          sector: thesis.sector,
          created_at: thesis.createdAt.toISOString(),
        };
      },
    }),

    compare_tickers: tool({
      description:
        "Compare 2-3 tickers side-by-side. Runs research on each and produces a comparison " +
        "with a recommendation for which is the best trade.",
      inputSchema: z.object({
        symbols: z
          .array(z.string())
          .min(2)
          .max(3)
          .describe("Ticker symbols to compare (2-3)"),
      }),
      execute: async ({ symbols }) => {
        const tickers = symbols.map((s) => s.toUpperCase());

        try {
          const res = await fetch(`${pythonUrl}/research/run`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Service-Secret": pythonSecret,
            },
            body: JSON.stringify({
              tickers,
              source: "MANUAL",
              agent_config: {},
            }),
          });

          if (!res.ok) {
            return { error: `Research service returned ${res.status}` };
          }

          const data = await res.json();
          const theses = data.theses || [];

          // Build comparison
          const comparison = theses.map(
            (t: Record<string, unknown>) => ({
              ticker: t.ticker,
              direction: t.direction,
              confidence_score: t.confidence_score,
              entry_price: t.entry_price,
              target_price: t.target_price,
              stop_loss: t.stop_loss,
              risk_reward_ratio: t.risk_reward_ratio,
              signal_types: t.signal_types,
              reasoning_summary: t.reasoning_summary,
              sector: t.sector,
            })
          );

          // Pick the best: highest confidence non-PASS
          const actionable = comparison
            .filter((t: { direction: string }) => t.direction !== "PASS")
            .sort(
              (a: { confidence_score: number }, b: { confidence_score: number }) =>
                b.confidence_score - a.confidence_score
            );
          const best = actionable[0]?.ticker || null;

          return {
            tickers,
            comparison,
            recommended: best,
            total_analyzed: comparison.length,
          };
        } catch (err) {
          return {
            error: err instanceof Error ? err.message : "Comparison failed",
          };
        }
      },
    }),

    explain_decision: tool({
      description:
        "Explain why a trade was or wasn't placed for a given ticker. " +
        "Retrieves thesis data, synthesis ranking, and trade status to provide full reasoning.",
      inputSchema: z.object({
        symbol: z
          .string()
          .optional()
          .describe("Ticker to explain decision for"),
        runId: z
          .string()
          .optional()
          .describe("Research run ID for context"),
      }),
      execute: async ({ symbol, runId }) => {
        // Find thesis
        const where: Record<string, unknown> = { userId };
        if (symbol) where.ticker = symbol.toUpperCase();
        if (runId) where.researchRunId = runId;

        const thesis = await prisma.thesis.findFirst({
          where,
          orderBy: { createdAt: "desc" },
          include: { trade: true },
        });

        if (!thesis) {
          return {
            error: `No thesis found for ${symbol || "this run"}`,
          };
        }

        const traded = !!thesis.trade;
        const tradeStatus = thesis.trade?.status || null;
        const tradeOutcome = thesis.trade?.outcome || null;

        return {
          ticker: thesis.ticker,
          direction: thesis.direction,
          confidence_score: thesis.confidenceScore,
          reasoning_summary: thesis.reasoningSummary,
          thesis_bullets: thesis.thesisBullets,
          risk_flags: thesis.riskFlags,
          signal_types: thesis.signalTypes,
          was_traded: traded,
          trade_status: tradeStatus,
          trade_outcome: tradeOutcome,
          trade_entry: thesis.trade?.entryPrice || null,
          trade_pnl: thesis.trade?.realizedPnl || null,
          explanation: traded
            ? `Trade was placed because confidence (${thesis.confidenceScore}%) met threshold. ${
                tradeOutcome ? `Outcome: ${tradeOutcome}` : `Currently ${tradeStatus}`
              }.`
            : thesis.direction === "PASS"
              ? `Passed on ${thesis.ticker}: ${thesis.reasoningSummary}`
              : `Thesis was ${thesis.direction} at ${thesis.confidenceScore}% confidence but was not traded (may have been below auto-trade threshold or filtered by portfolio synthesis).`,
        };
      },
    }),
  };
}
