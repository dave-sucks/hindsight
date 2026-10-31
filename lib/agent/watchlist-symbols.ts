/**
 * Watchlist symbols helper — the single read pattern for "what's on this
 * analyst's watchlist" after the watchlist collapse.
 *
 * The watchlist is no longer a column. It's a query:
 *   Thesis WHERE researchRun.agentConfigId = X AND status = 'WATCHING'
 *
 * Returns symbols in createdAt-desc order, deduped. Includes PENDING,
 * LONG, and SHORT WATCHING — anything currently on the watchlist. PASS
 * theses are ARCHIVED and never appear here.
 *
 * See docs/WATCHLIST_COLLAPSE_PLAN.md.
 */

import { prisma } from "@/lib/prisma";

export async function getWatchlistSymbols(
  analystId: string,
): Promise<string[]> {
  const theses = await prisma.thesis.findMany({
    where: {
      status: "WATCHING",
      researchRun: { agentConfigId: analystId },
    },
    select: { ticker: true },
    orderBy: { createdAt: "desc" },
  });
  return Array.from(new Set(theses.map((t) => t.ticker)));
}

/** Held or watched: the stock is already the analyst's, so nothing seeds a watch beside it. */
export const HELD_OR_WATCHED = ["HOLDING", "WATCHING"] as const;

/** What the page's add and the editor's Apply check before seeding a watch. */
export async function getHeldOrWatchedSymbols(analystId: string): Promise<string[]> {
  const theses = await prisma.thesis.findMany({
    where: { status: { in: [...HELD_OR_WATCHED] }, researchRun: { agentConfigId: analystId } },
    select: { ticker: true },
  });
  return Array.from(new Set(theses.map((t) => t.ticker)));
}
