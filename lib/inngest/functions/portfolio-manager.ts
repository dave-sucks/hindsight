/**
 * portfolio-manager — Tuesday and Thursday at 10:00 AM ET: the Portfolio
 * Manager's run for each traded book (lib/agent/portfolio-manager/run.ts).
 * It reads the whole book, may propose trades and write notes through the
 * analyst's own tools, and its last reply is its write-up, kept on the run.
 * A market holiday runs nothing. The run takes no messages afterwards
 * (READ_ONLY_RUN_MODES).
 */
import { inngest } from "@/lib/inngest/client";
import { getOwnerUserId } from "@/lib/auth/account";
import { isTradingDay } from "@/lib/market-hours";
import { tradedBooks } from "@/lib/inngest/functions/market-reviewer";
import { runAgentAsRun } from "@/lib/agent/engine/run";
import { PORTFOLIO_MANAGER_RUN } from "@/lib/agent/portfolio-manager/run";

export const portfolioManager = inngest.createFunction(
  { id: "portfolio-manager", name: "Portfolio Manager (Tue and Thu, 10:00 AM)", retries: 0, concurrency: { limit: 1 } },
  { cron: "TZ=America/New_York 0 10 * * 2,4" },
  async ({ step }) => {
    if (!isTradingDay(new Date())) return { skipped: "market holiday" };
    const books = await step.run("books", tradedBooks);
    const done: Array<{ book: string; run: string | null; wrote: boolean }> = [];
    for (const b of books) {
      const key = `${b.accountId}-${b.environment}`;
      // One step: a retry would start a second run and could propose its trades twice.
      const out = await step.run(`manage-${key}`, async () => {
        const userId = await getOwnerUserId(b.accountId);
        if (!userId) return null;
        // The runner opens the run, runs it and keeps its books (lib/agent/engine/run.ts).
        const run = await runAgentAsRun(PORTFOLIO_MANAGER_RUN, { ...b, userId });
        return { runId: run.runId, wrote: Boolean(run.text) };
      });
      done.push({ book: key, run: out?.runId ?? null, wrote: Boolean(out?.wrote) });
    }
    return { done };
  },
);
