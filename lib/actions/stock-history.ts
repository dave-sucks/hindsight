/**
 * Every thesis and every position on one stock for this account — the
 * stock page's history. The sorting is pure, in lib/stock-history.ts.
 */

import { prisma } from "@/lib/prisma";
import type { StockHistory } from "@/lib/stock-history";

export async function getStockHistory(accountId: string, symbol: string): Promise<StockHistory> {
  const ticker = symbol.toUpperCase();
  const [theses, positions] = await Promise.all([
    prisma.thesis.findMany({
      where: { accountId, ticker },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        status: true,
        direction: true,
        retiredReason: true,
        createdAt: true,
        researchRun: { select: { agentConfigId: true, agentConfig: { select: { name: true } } } },
      },
    }),
    prisma.position.findMany({
      where: { accountId, symbol: ticker },
      orderBy: { openedAt: "desc" },
      take: 100,
      select: {
        id: true,
        status: true,
        direction: true,
        quantity: true,
        avgCost: true,
        closePrice: true,
        realizedPnl: true,
        outcome: true,
        closeReason: true,
        openedAt: true,
        closedAt: true,
        analystId: true,
        analyst: { select: { name: true } },
        decisions: { take: 1, select: { thesisId: true } },
        orders: { where: { side: "BUY", status: "FILLED" }, take: 1, select: { id: true } },
      },
    }),
  ]);

  return {
    theses: theses.map((t) => ({
      id: t.id,
      status: t.status,
      direction: t.direction,
      retiredReason: t.retiredReason,
      createdAt: t.createdAt.toISOString(),
      analystId: t.researchRun?.agentConfigId ?? null,
      analystName: t.researchRun?.agentConfig?.name ?? null,
    })),
    positions: positions.map((p) => ({
      id: p.id,
      thesisId: p.decisions[0]?.thesisId ?? null,
      status: p.status,
      direction: p.direction,
      quantity: Number(p.quantity),
      avgCost: Number(p.avgCost),
      closePrice: p.closePrice != null ? Number(p.closePrice) : null,
      realizedPnl: p.realizedPnl != null ? Number(p.realizedPnl) : null,
      outcome: p.outcome,
      closeReason: p.closeReason,
      openedAt: p.openedAt.toISOString(),
      closedAt: p.closedAt?.toISOString() ?? null,
      analystId: p.analystId,
      analystName: p.analyst?.name ?? null,
      buyFilled: p.orders.length > 0,
    })),
  };
}
