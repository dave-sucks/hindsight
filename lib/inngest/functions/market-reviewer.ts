/**
 * market-reviewer — 7:30 AM ET every weekday: the Market Reviewer's run for
 * each traded book (an account and environment with an enabled analyst
 * trading in it, or a stock held in it). One model call with web search
 * writes the market digest (lib/agent/market-reviewer/run.ts), and the next
 * step saves it, as the 8 PM Portfolio Digest saves its own. A market
 * holiday writes nothing. Each book is its own read-only run.
 */
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getOwnerUserId } from "@/lib/auth/account";
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
    const { date, books } = await step.run("books", async () => ({ date: etDateOf(new Date()), books: await tradedBooks() }));
    const done: Array<{ book: string; saved: boolean }> = [];
    for (const b of books) {
      const key = `${b.accountId}-${b.environment}`;
      // Saved as a read-only run with its one request (lib/runs/account-run.ts).
      const out = await step.run(`review-${key}`, async () => {
        const userId = await getOwnerUserId(b.accountId);
        if (!userId) return null;
        const review = await runAccountCall(
          { accountId: b.accountId, environment: b.environment, mode: "MARKET_REVIEWER", parameters: { date, model: REVIEWER_MODEL } },
          async (runId) => ({ ...(await writeMarketReview({ ...b, userId })), runId }),
        );
        return { digest: review.digest, runId: review.runId };
      });
      if (out?.digest) {
        const digest = out.digest;
        await step.run(`save-${key}`, async () => {
          const day = new Date(`${date}T00:00:00.000Z`);
          await prisma.marketDigest.upsert({
            where: { accountId_environment_date: { accountId: b.accountId, environment: b.environment, date: day } },
            create: { accountId: b.accountId, environment: b.environment, date: day, digest, model: REVIEWER_MODEL, runId: out.runId },
            update: { digest, model: REVIEWER_MODEL, runId: out.runId, createdAt: new Date() },
          });
        });
      }
      done.push({ book: key, saved: Boolean(out?.digest) });
    }
    console.log(`[market-reviewer] ${done.map((d) => `${d.book} ${d.saved ? "saved" : "not saved"}`).join("; ") || "no book is traded"}`);
    return { done };
  },
);
