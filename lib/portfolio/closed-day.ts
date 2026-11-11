/**
 * closed-day.ts — a day's change as its 8 PM digest worked it out at that
 * close (PortfolioDigest.facts). Read once the broker's prior close has moved
 * past that day (lib/portfolio/value-at-quotes.ts `dayChangeAt`). Only a digest
 * whose account was valued at that close counts (`book.closeOf`): the ones
 * before 2026-11-11 read the broker's after-hours marks.
 */
import { prisma } from "@/lib/prisma";

export async function closedDay(accountId: string, environment: string, day: string): Promise<{ dollars: number; pct: number } | null> {
  const row = await prisma.portfolioDigest.findUnique({
    where: { accountId_environment_date: { accountId, environment, date: new Date(`${day}T00:00:00Z`) } },
    select: { facts: true },
  });
  const f = row?.facts as { book?: { closeOf?: string | null }; pnl?: { dayPnl?: number; dayPnlPct?: number; dayUnknown?: boolean } } | null | undefined;
  return f?.book?.closeOf === day && !f.pnl?.dayUnknown && typeof f.pnl?.dayPnl === "number" ? { dollars: f.pnl.dayPnl, pct: f.pnl.dayPnlPct ?? 0 } : null;
}
