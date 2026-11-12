/**
 * market-reviewer — 7:30 AM ET every weekday: the Market Reviewer's run for
 * each traded book (an account and environment with an enabled analyst
 * trading in it, or a stock held in it). It researches the market and saves
 * the market digest (lib/agent/market-reviewer/run.ts). A market holiday
 * writes nothing. Each book is its own step and its own read-only run.
 */
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getOwnerUserId } from "@/lib/auth/account";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { isTradingDay } from "@/lib/market-hours";
import { runAccountCall } from "@/lib/runs/account-run";
import { REVIEWER_MODEL, writeMarketReview } from "@/lib/agent/market-reviewer/run";
import { etDateOf } from "@/lib/market-data/intraday-window";

type Env = "PAPER" | "LIVE";

/** The books being traded, each once. */
export async function tradedBooks(): Promise<Array<{ accountId: string; environment: Env }>> {
  const [analysts, open] = await Promise.all([
    prisma.agentConfig.findMany({ where: { enabled: true }, select: { accountId: true, tradingEnvironment: true }, distinct: ["accountId", "tradingEnvironment"] }),
    prisma.position.findMany({ where: { status: "OPEN" }, select: { accountId: true, environment: true }, distinct: ["accountId", "environment"] }),
  ]);
  const books = new Map<string, { accountId: string; environment: Env }>();
  for (const b of [...analysts.map((a) => ({ accountId: a.accountId, environment: a.tradingEnvironment })), ...open]) {
    const environment: Env = b.environment === "LIVE" ? "LIVE" : "PAPER";
    books.set(`${b.accountId}:${environment}`, { accountId: b.accountId, environment });
  }
  return [...books.values()];
}

export const marketReviewer = inngest.createFunction(
  { id: "market-reviewer", name: "Market Reviewer (7:30 AM market digest)", retries: 1, concurrency: { limit: 1 } },
  { cron: "TZ=America/New_York 30 7 * * 1-5" },
  async ({ step }) => {
    if (!isTradingDay(new Date())) return { skipped: "market holiday" };
    const books = await step.run("books", tradedBooks);
    const done: Array<{ book: string; saved: boolean }> = [];
    for (const b of books) {
      done.push(
        await step.run(`review-${b.accountId}-${b.environment}`, async () => {
          const userId = await getOwnerUserId(b.accountId);
          if (!userId) return { book: `${b.accountId}:${b.environment}`, saved: false };
          const creds = (await resolveAlpacaCredentials(userId, b.environment).catch(() => null)) ?? undefined;
          const out = await runAccountCall(
            { accountId: b.accountId, environment: b.environment, mode: "MARKET_REVIEWER", parameters: { date: etDateOf(new Date()), model: REVIEWER_MODEL } },
            (runId) => writeMarketReview({ ...b, userId, creds }, runId ?? `market-reviewer-${Date.now()}`),
          );
          return { book: `${b.accountId}:${b.environment}`, saved: !out.request.error };
        }),
      );
    }
    console.log(`[market-reviewer] ${done.map((d) => `${d.book} ${d.saved ? "saved" : "not saved"}`).join("; ") || "no book is traded"}`);
    return { done };
  },
);
