/**
 * The floor in force on each open position: the protective sale that fires
 * first on its thesis's resolved triggers (thesis, analyst, account), the
 * number the thesis sheet's card and chart show. Position.stopLoss is a copy
 * only some writers keep current (CEG stored $248 while $287.30 was in force),
 * so the positions table reads this instead.
 */
import { prisma } from "@/lib/prisma";
import { loadLevelSources, resolveThesisLadder } from "@/lib/agent/triggers/load-levels";
import { canonicalLevels } from "@/lib/agent/triggers/price-levels";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";

interface Held {
  id: string;
  analystId: string;
  symbol: string;
  direction: string;
  avgCost: number;
  peakPrice: number | null;
}

/** Position id → the floor in force, or null when nothing sells it on the way down. */
export async function floorsInForce(positions: Held[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (positions.length === 0) return out;
  const analystIds = Array.from(new Set(positions.map((p) => p.analystId)));
  const tickers = Array.from(new Set(positions.map((p) => p.symbol)));
  const [theses, sources, snapshots] = await Promise.all([
    prisma.thesis.findMany({
      where: { status: "HOLDING", ticker: { in: tickers }, researchRun: { agentConfigId: { in: analystIds } } },
      select: { id: true, ticker: true, status: true, direction: true, horizon: true, triggers: true, triggerState: true, researchRun: { select: { agentConfigId: true } } },
    }),
    loadLevelSources(analystIds),
    loadIndicatorSnapshots(tickers).catch(() => new Map<string, { atr14?: number | null }>()),
  ]);
  for (const p of positions) {
    const thesis = theses.find((t) => t.ticker === p.symbol && t.researchRun?.agentConfigId === p.analystId);
    const levels = canonicalLevels({
      triggers: thesis ? resolveThesisLadder(thesis, sources.get(p.analystId), `thesis=${thesis.id}`) : [],
      direction: p.direction,
      status: "HOLDING",
      avgCost: p.avgCost,
      peakPrice: p.peakPrice,
      atr14: snapshots.get(p.symbol.toUpperCase())?.atr14 ?? null,
    });
    out.set(p.id, levels.floor?.price ?? null);
  }
  return out;
}
