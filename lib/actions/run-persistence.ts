"use server";

import { prisma } from "@/lib/prisma";

export type ThesisOutput = {
  ticker: string;
  direction: "LONG" | "SHORT" | "PASS";
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  hold_duration: "DAY" | "SWING" | "POSITION";
  confidence_score: number;
  reasoning_summary: string;
  thesis_bullets: string[];
  risk_flags: string[];
  signal_types: string[];
  sector: string | null;
  sources_used: {
    type: string;
    provider: string;
    title: string;
    url?: string | null;
    published_at?: string | null;
  }[];
  model_used: string;
};

/**
 * Persist theses (and optionally trades) for a completed research run.
 *
 * Extracted from triggerResearchRun so the streaming proxy can reuse
 * the same logic. Zero behavior change for existing callers.
 *
 * @param autoTrade - When false, theses are persisted but no Trade rows are
 *   created. Defaults to true to preserve existing AGENT run behavior.
 *   MANUAL runs should pass false unless the user explicitly opts in.
 */
export async function persistThesesAndTrades(
  runId: string,
  userId: string,
  theses: ThesisOutput[],
  minConfidence: number,
  agentConfig: { maxPositionSize?: number } | null,
  autoTrade: boolean = true,
): Promise<{ thesisIds: string[]; tradeIds: string[] }> {
  const thesisIds: string[] = [];
  const tradeIds: string[] = [];
  const maxPositionSize = (agentConfig?.maxPositionSize ?? 500) as number;

  for (const thesis of theses) {
    const row = await prisma.thesis.create({
      data: {
        researchRunId: runId,
        userId,
        ticker: thesis.ticker,
        source: "AGENT",
        direction: thesis.direction,
        entryPrice: thesis.entry_price,
        targetPrice: thesis.target_price,
        stopLoss: thesis.stop_loss,
        holdDuration: thesis.hold_duration,
        confidenceScore: thesis.confidence_score,
        reasoningSummary: thesis.reasoning_summary,
        thesisBullets: thesis.thesis_bullets,
        riskFlags: thesis.risk_flags,
        signalTypes: thesis.signal_types,
        sector: thesis.sector,
        sourcesUsed: thesis.sources_used as object,
        modelUsed: thesis.model_used,
      },
    });
    thesisIds.push(row.id);

    if (
      autoTrade &&
      thesis.direction !== "PASS" &&
      thesis.confidence_score >= minConfidence &&
      thesis.entry_price != null
    ) {
      const trade = await prisma.trade.create({
        data: {
          thesisId: row.id,
          userId,
          ticker: thesis.ticker,
          direction: thesis.direction as "LONG" | "SHORT",
          status: "OPEN",
          entryPrice: thesis.entry_price,
          shares: Math.floor(maxPositionSize / thesis.entry_price),
          targetPrice: thesis.target_price,
          stopLoss: thesis.stop_loss,
          exitStrategy: "PRICE_TARGET",
        },
      });
      tradeIds.push(trade.id);

      await prisma.tradeEvent.create({
        data: {
          tradeId: trade.id,
          eventType: "PLACED",
          description: "Trade placed via streaming research run",
          priceAt: thesis.entry_price,
        },
      });
    }
  }

  return { thesisIds, tradeIds };
}
