/** Reading research briefs back: by order for the card, by stock for the agents. */

import { prisma } from "@/lib/prisma";
import type { ResearchBriefPayload, ResearchBriefView } from "@/lib/research/brief-types";

type Row = { id: string; createdAt: Date | string; payload: unknown };
const view = (r: Row): ResearchBriefView => ({
  id: r.id,
  createdAt: new Date(r.createdAt).toISOString(),
  payload: r.payload as ResearchBriefPayload,
});

/** The newest brief per stock built within `maxAgeMs`, in one query. Empty when the read fails. */
export async function latestBriefs(tickers: string[], maxAgeMs: number, now: Date = new Date()): Promise<Map<string, ResearchBriefView>> {
  const wanted = Array.from(new Set(tickers.map((t) => t.toUpperCase())));
  if (wanted.length === 0) return new Map();
  const rows = await Promise.resolve()
    .then(() =>
      prisma.researchBrief.findMany({
        where: { ticker: { in: wanted }, createdAt: { gte: new Date(now.getTime() - maxAgeMs) } },
        orderBy: { createdAt: "desc" },
        distinct: ["ticker"],
        select: { id: true, ticker: true, createdAt: true, payload: true },
      }),
    )
    .catch(() => [] as (Row & { ticker: string })[]);
  return new Map(rows.map((r) => [r.ticker, view(r)]));
}

/** The brief attached to an order. Null when none is on file or the read fails. */
export async function briefForOrderView(orderId: string): Promise<ResearchBriefView | null> {
  const row = await Promise.resolve()
    .then(() => prisma.researchBrief.findUnique({ where: { orderId }, select: { id: true, createdAt: true, payload: true } }))
    .catch(() => null);
  return row ? view(row) : null;
}
