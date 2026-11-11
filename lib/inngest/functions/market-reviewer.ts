/**
 * market-reviewer.ts — 7:30 AM ET every weekday, before the 8:00 morning
 * runs: one Market Reviewer run per book being traded
 * (lib/agent/market-reviewer/run.ts).
 *
 * A book is an (account, environment) pair with an enabled analyst trading
 * in it or an open position in it, the same pairs the Portfolio Digest
 * counts as traded. A market holiday writes nothing. Each book is its own
 * step, so one that fails doesn't stop the next.
 */
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { isTradingDay } from "@/lib/market-hours";
import { etToday } from "@/lib/market-data/market-calendar";
import { loadInputsForBook, runMarketReviewer } from "@/lib/agent/market-reviewer/run";
import type { Book, MarketReviewerFacts } from "@/lib/agent/market-reviewer/inputs";

/** The books being traded: one entry per (account, environment), in a stable order. */
export function tradedBooks(pairs: ReadonlyArray<{ accountId: string; environment: string | null }>): Array<{ accountId: string; environment: Book }> {
  const seen = new Map<string, { accountId: string; environment: Book }>();
  for (const p of pairs) {
    if (p.environment !== "PAPER" && p.environment !== "LIVE") continue;
    seen.set(`${p.accountId}::${p.environment}`, { accountId: p.accountId, environment: p.environment });
  }
  return [...seen.values()].sort((a, b) => `${a.accountId}${a.environment}`.localeCompare(`${b.accountId}${b.environment}`));
}

export const marketReviewer = inngest.createFunction(
  { id: "market-reviewer", name: "Market Reviewer (7:30 AM)", concurrency: { limit: 1 }, retries: 0 },
  { cron: "TZ=America/New_York 30 7 * * 1-5" },
  async ({ step }) => {
    const now = new Date();
    if (!isTradingDay(now)) return { skipped: true, reason: "market-holiday" };
    const date = etToday(now);

    const books = await step.run("find-books", async () => {
      const [analysts, open] = await Promise.all([
        prisma.agentConfig.findMany({ where: { enabled: true }, select: { accountId: true, tradingEnvironment: true }, distinct: ["accountId", "tradingEnvironment"] }),
        prisma.position.findMany({ where: { status: "OPEN" }, select: { accountId: true, environment: true }, distinct: ["accountId", "environment"] }),
      ]);
      return tradedBooks([...analysts.map((a) => ({ accountId: a.accountId, environment: a.tradingEnvironment })), ...open]);
    });

    const results = [];
    for (const b of books) {
      const key = `${b.accountId}-${b.environment}`;
      // The inputs in their own step: the earnings lookups are one vendor call per stock.
      const facts = (await step.run(`inputs-${key}`, () => loadInputsForBook({ ...b, date }))) as unknown as MarketReviewerFacts | null;
      if (!facts) {
        results.push({ book: key, skipped: "no owner" });
        continue;
      }
      results.push(await step.run(`review-${key}`, () => runMarketReviewer({ ...b, date, facts })));
    }
    return { date, books: books.length, results };
  },
);
