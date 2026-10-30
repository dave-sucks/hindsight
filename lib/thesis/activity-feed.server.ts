/**
 * activity-feed.server.ts — loads one stock's feed (activity-feed.ts) from the
 * database, for the two routes the sheet reads: the Activity tab (every
 * line) and the dossier (the newest 8). The agents' read loads the same
 * inputs in bulk in lib/agent/work-inputs.ts.
 *
 * Order → thesis: `Order.thesisId` when set (every order since 2026-08-18),
 * else the (analyst, ticker) fallback bounded to the thesis's lifetime, so a
 * re-minted ticker never inherits its predecessor's proposals. Close-side
 * paperwork can land up to three days after the thesis retires.
 */
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { activityFeed, type FeedItem, type ProposalOrder } from "@/lib/thesis/activity-feed";

export const FEED_ORDER_SELECT = {
  id: true, status: true, intent: true, side: true, quantity: true, symbol: true, rationale: true, rejectionMessage: true,
  expiresAt: true, alpacaConfirmedAt: true, filledPrice: true, createdAt: true, updatedAt: true, positionId: true,
} as const;

export interface FeedThesis {
  id: string;
  ticker: string;
  createdAt: Date;
  closedAt: Date | null;
  invalidatedAt: Date | null;
  analystId: string | null;
}

/** The newest `limit` lines of the stock's feed. */
export async function loadActivityFeed(thesis: FeedThesis, limit: number): Promise<FeedItem[]> {
  const updates = await prisma.thesisUpdate.findMany({
    where: { thesisId: thesis.id },
    orderBy: { timestamp: "desc" },
    take: limit,
    select: {
      id: true, timestamp: true, type: true, summary: true, rationale: true, fieldChanges: true, priceAtTime: true,
      positionAtTime: true, triggerId: true, signalIds: true, runId: true, tradeId: true, run: { select: { mode: true } },
    },
  });

  const terminalAt = thesis.closedAt ?? thesis.invalidatedAt ?? null;
  const graceEnd = terminalAt ? new Date(terminalAt.getTime() + 3 * 86_400_000) : null;
  const fallbackBase: Prisma.OrderWhereInput | null = thesis.analystId
    ? { thesisId: null, symbol: thesis.ticker, position: { analystId: thesis.analystId } }
    : null;
  const orders = await prisma.order.findMany({
    where: {
      expiresAt: { not: null },
      OR: [
        { thesisId: thesis.id },
        ...(fallbackBase ? [{ ...fallbackBase, createdAt: { gte: thesis.createdAt, ...(terminalAt ? { lte: terminalAt } : {}) } }] : []),
        ...(fallbackBase && terminalAt && graceEnd
          ? [{ ...fallbackBase, intent: { in: ["CLOSE", "PARTIAL_CLOSE"] }, createdAt: { gt: terminalAt, lte: graceEnd } }]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: FEED_ORDER_SELECT,
  });

  return activityFeed({ updates, orders: orders as unknown as ProposalOrder[], limit });
}
