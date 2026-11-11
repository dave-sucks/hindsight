/**
 * The newest MarketDigest row for a book: the one read of the table. The
 * homepage's Market tab reads the digest; every agent's Market and portfolio
 * block reads the brief through `latestMarketBrief`, which is the body of
 * #947's slot (lib/agent/market-digest-slot.ts) once that lands.
 */
import { prisma } from "@/lib/prisma";
import { marketNumbersLines, type MarketNumbers } from "@/lib/market-data/market-numbers";

export interface MarketDigestRow {
  id: string;
  /** The trading day it was written for, ISO (UTC midnight of the ET date). */
  date: string;
  /** The market brief every agent reads. */
  brief: string;
  /** The digest for the Market tab, markdown with its sources linked. */
  narrative: string;
  model: string | null;
  /** The run that wrote it: its page shows every input, search and note. */
  runId: string | null;
  createdAt: string;
  /**
   * The market numbers the run was given (its inputs, `facts.market`), as the
   * lines every agent reads beside the brief: printed by code, above the
   * digest. Empty when the row has none.
   */
  numbers: string[];
}

/** The market numbers from a row's inputs, as lines, worded as of when it was written. */
export function numbersOf(facts: unknown, writtenAt: Date): string[] {
  const market = (facts as { market?: Partial<MarketNumbers> } | null)?.market;
  if (!market || !Array.isArray(market.sectors)) return [];
  return marketNumbersLines({ ...market, dates: market.dates ?? [], calendarGaps: market.calendarGaps ?? [] } as MarketNumbers, writtenAt);
}

export async function latestMarketDigest(accountId: string, environment: "PAPER" | "LIVE"): Promise<MarketDigestRow | null> {
  const row = await prisma.marketDigest.findFirst({
    where: { accountId, environment },
    orderBy: { date: "desc" },
    select: { id: true, date: true, brief: true, narrative: true, model: true, runId: true, createdAt: true, facts: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    date: row.date.toISOString(),
    brief: row.brief,
    narrative: row.narrative,
    model: row.model,
    runId: row.runId,
    createdAt: row.createdAt.toISOString(),
    numbers: numbersOf(row.facts, row.createdAt),
  };
}

/**
 * The newest market brief for the book, in the shape the Market and portfolio
 * block takes (the #947 contract), stamped with when it was written so an
 * agent can tell this morning's from an older one.
 */
export async function latestMarketBrief(args: { accountId: string; environment: string }): Promise<{ date: string; brief: string; writtenAt: string } | null> {
  if (args.environment !== "PAPER" && args.environment !== "LIVE") return null;
  // Every run reads this: the brief alone, not the inputs the row keeps.
  const row = await prisma.marketDigest.findFirst({
    where: { accountId: args.accountId, environment: args.environment },
    orderBy: { date: "desc" },
    select: { date: true, brief: true, createdAt: true },
  });
  return row ? { date: row.date.toISOString().slice(0, 10), brief: row.brief, writtenAt: row.createdAt.toISOString() } : null;
}
