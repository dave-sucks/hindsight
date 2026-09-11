/**
 * load-setup-scorecard.ts — read closed trades and sell proposals for the
 * setup scorecard (./setup-scorecard). Server-only. DAV-248.
 *
 * A position finds its thesis through the INITIATE TradeDecision (there is
 * no Position→Thesis key); that decision's text also carries the entry stop
 * for positions opened before Position.initialStop existed.
 *
 * Trades closed before SCORECARD_SINCE are left out: the seats were rebuilt
 * on 2026-05-27 and earlier trades ran on configs that no longer exist.
 */

import { prisma } from "@/lib/prisma";
import {
  buildScorecard,
  parseStopFromDecision,
  scorecardLines,
  type ClosedTrade,
  type SellProposalCount,
  type SetupRow,
} from "@/lib/performance/setup-scorecard";

export const SCORECARD_SINCE = new Date("2026-05-27T00:00:00Z");

/** Order statuses that mean the principal didn't take a sell proposal. */
const DECLINED = new Set(["REJECTED", "EXPIRED"]);

async function thesisByPosition(positionIds: string[]) {
  const decisions = positionIds.length
    ? await prisma.tradeDecision.findMany({
        where: { positionId: { in: positionIds }, decision: { in: ["INITIATE", "BUY"] } },
        orderBy: { createdAt: "asc" },
        select: { positionId: true, thesisId: true, reasoning: true },
      })
    : [];
  const first = new Map<string, { thesisId: string | null; reasoning: string | null }>();
  for (const d of decisions) if (d.positionId && !first.has(d.positionId)) first.set(d.positionId, d);
  const thesisIds = Array.from(new Set([...first.values()].map((d) => d.thesisId).filter((x): x is string => !!x)));
  const theses = thesisIds.length
    ? await prisma.thesis.findMany({ where: { id: { in: thesisIds } }, select: { id: true, setupId: true, horizon: true } })
    : [];
  const thesis = new Map(theses.map((t) => [t.id, t]));
  return (positionId: string) => {
    const d = first.get(positionId);
    const t = d?.thesisId ? thesis.get(d.thesisId) : undefined;
    return { setupId: t?.setupId ?? null, horizon: t?.horizon ?? null, decisionText: d?.reasoning ?? null };
  };
}

export async function loadClosedTrades(opts: {
  accountId: string;
  environment?: string;
  analystId?: string;
}): Promise<ClosedTrade[]> {
  const positions = await prisma.position.findMany({
    where: {
      accountId: opts.accountId,
      status: "CLOSED",
      closedAt: { gte: SCORECARD_SINCE },
      closePrice: { not: null },
      ...(opts.environment ? { environment: opts.environment } : {}),
      ...(opts.analystId ? { analystId: opts.analystId } : {}),
    },
    select: {
      id: true, direction: true, avgCost: true, initialStop: true, closePrice: true, peakPrice: true,
      openedAt: true, closedAt: true, environment: true, analyst: { select: { name: true } },
    },
  });
  const lookup = await thesisByPosition(positions.map((p) => p.id));
  return positions.map((p) => {
    const t = lookup(p.id);
    return {
      setupId: t.setupId,
      horizon: t.horizon,
      analyst: p.analyst.name,
      environment: p.environment,
      direction: p.direction,
      entry: p.avgCost,
      initialStop: p.initialStop ?? parseStopFromDecision(t.decisionText),
      close: p.closePrice as number,
      peak: p.peakPrice,
      openedAt: p.openedAt,
      closedAt: p.closedAt as Date,
    };
  });
}

export async function loadSellProposalCounts(opts: {
  accountId: string;
  environment?: string;
}): Promise<SellProposalCount[]> {
  const orders = await prisma.order.findMany({
    where: {
      intent: { in: ["CLOSE", "PARTIAL_CLOSE"] },
      createdAt: { gte: SCORECARD_SINCE },
      position: {
        accountId: opts.accountId,
        ...(opts.environment ? { environment: opts.environment } : {}),
      },
    },
    select: {
      status: true,
      positionId: true,
      position: { select: { environment: true, analyst: { select: { name: true } } } },
    },
  });
  const lookup = await thesisByPosition(Array.from(new Set(orders.map((o) => o.positionId))));
  return orders.map((o) => {
    const t = lookup(o.positionId);
    return {
      setupId: t.setupId,
      horizon: t.horizon,
      analyst: o.position.analyst.name,
      environment: o.position.environment,
      proposals: 1,
      declined: DECLINED.has(o.status) ? 1 : 0,
    };
  });
}

export async function getSetupScorecard(accountId: string, environment?: string): Promise<SetupRow[]> {
  const [trades, sells] = await Promise.all([
    loadClosedTrades({ accountId, environment }),
    loadSellProposalCounts({ accountId, environment }),
  ]);
  return buildScorecard(trades, sells);
}

/** The analyst's own record by setup, as prompt data lines. Fail-open: [] on any error. */
export async function loadScorecardLines(opts: {
  accountId: string | null | undefined;
  analystId: string | null | undefined;
  environment?: string;
}): Promise<string[]> {
  if (!opts.accountId || !opts.analystId) return [];
  try {
    return scorecardLines(
      await loadClosedTrades({ accountId: opts.accountId, analystId: opts.analystId, environment: opts.environment }),
    );
  } catch (err) {
    console.warn("[scorecard] lines unavailable:", err instanceof Error ? err.message : err);
    return [];
  }
}
