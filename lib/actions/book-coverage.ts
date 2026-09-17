/**
 * Which analysts hold or watch each ticker on an account's book. The market
 * pages (earnings, filings, movers) use it to put your names first and to
 * mark who already covers a row.
 */

import { prisma } from "@/lib/prisma";

export async function getBookCoverage(accountId: string): Promise<Map<string, string[]>> {
  const theses = await prisma.thesis.findMany({
    where: { accountId, status: { in: ["HOLDING", "WATCHING"] } },
    select: { ticker: true, researchRun: { select: { agentConfigId: true } } },
  });
  const coveredBy = new Map<string, string[]>();
  for (const t of theses) {
    const id = t.researchRun.agentConfigId;
    const key = t.ticker.toUpperCase();
    const list = coveredBy.get(key) ?? [];
    if (id && !list.includes(id)) list.push(id);
    coveredBy.set(key, list);
  }
  return coveredBy;
}
