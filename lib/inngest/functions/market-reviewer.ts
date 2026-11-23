/**
 * market-reviewer — 9:00 AM ET every weekday: the Market Reviewer's run for
 * each traded book (an account and environment with an enabled analyst
 * trading in it, or a stock held in it), through the agent runner
 * (runAgentAsRun). One model call with web search writes the market digest
 * and its notes on the stocks its research touched; its own save keeps the
 * digest and each note on its stocks; a saved high note starts the check of
 * the triggers that watch notes
 * (lib/agent/market-reviewer/run.ts). A market holiday writes nothing. Each
 * book is its own read-only run.
 */
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getOwnerUserId } from "@/lib/auth/account";
import { isTradingDay } from "@/lib/market-hours";
import { runAgentAsRun } from "@/lib/agent/engine/run";
import { REVIEWER_RUN } from "@/lib/agent/market-reviewer/run";

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
  { id: "market-reviewer", name: "Market Reviewer (9:00 AM market digest)", retries: 1, concurrency: { limit: 1 } },
  { cron: "TZ=America/New_York 0 9 * * 1-5" },
  async ({ step }) => {
    if (!isTradingDay(new Date())) return { skipped: "market holiday" };
    const books = await step.run("books", tradedBooks);
    const done: Array<{ book: string; saved: boolean }> = [];
    for (const b of books) {
      const key = `${b.accountId}-${b.environment}`;
      // One step: the runner opens the run, runs it and keeps its books; its own save keeps the digest and the notes.
      const out = await step.run(`review-${key}`, async () => {
        const userId = await getOwnerUserId(b.accountId);
        if (!userId) return null;
        const run = await runAgentAsRun(REVIEWER_RUN, { ...b, userId });
        return { runId: run.runId, saved: run.status === "COMPLETE" };
      });
      done.push({ book: key, saved: Boolean(out?.saved) });
    }
    console.log(`[market-reviewer] ${done.map((d) => `${d.book} ${d.saved ? "saved" : "not saved"}`).join("; ") || "no book is traded"}`);
    return { done };
  },
);
