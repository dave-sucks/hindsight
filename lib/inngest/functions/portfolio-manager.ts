/**
 * portfolio-manager — Tuesday and Thursday at 10:00 AM ET: the Portfolio
 * Manager's run for each traded book (lib/agent/portfolio-manager/run.ts).
 * It reads the whole book, may propose trades and write notes through the
 * analyst's own tools, and its last reply is its write-up, kept on the run.
 * A market holiday runs nothing. The run takes no messages afterwards
 * (READ_ONLY_RUN_MODES).
 */
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getOwnerUserId } from "@/lib/auth/account";
import { isTradingDay } from "@/lib/market-hours";
import { etDateOf } from "@/lib/market-data/intraday-window";
import { saveRunThread } from "@/lib/agent/run-thread";
import { recordTokenUsage } from "@/lib/agent/token-usage";
import { putNotesOnRunProposals } from "@/lib/proposals/auto-writeup";
import { tradedBooks } from "@/lib/inngest/functions/market-reviewer";
import { MANAGER_MODEL, MANAGER_RUN_MODE, WRITEUP_EVENT, runPortfolioManager } from "@/lib/agent/portfolio-manager/run";

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
        const started = new Date();
        const run = await prisma.researchRun.create({
          data: { userId, accountId: b.accountId, source: "AGENT", status: "RUNNING", mode: MANAGER_RUN_MODE, environment: b.environment, parameters: { date: etDateOf(started), model: MANAGER_MODEL } },
          select: { id: true },
        });
        const result = await runPortfolioManager({ ...b, userId }, run.id);
        await saveRunThread(run.id, { opening: [{ role: "user", content: [{ type: "text", text: result.firstMessage }] }], messages: result.messages, steps: result.steps }, "portfolio-manager");
        await recordTokenUsage(run.id, result.usage, MANAGER_MODEL);
        // Its note on a stock is that stock's proposal's reason, as on every run.
        await putNotesOnRunProposals({ runId: run.id, analystId: null, since: started }).catch((err) =>
          console.error(`[portfolio-manager] could not put the notes on the run's proposals:`, err instanceof Error ? err.message : err),
        );
        if (result.writeup) await prisma.runEvent.create({ data: { runId: run.id, type: WRITEUP_EVENT, title: "Portfolio Manager write-up", message: result.writeup } });
        await prisma.researchRun.update({ where: { id: run.id }, data: { status: result.writeup ? "COMPLETE" : "FAILED", completedAt: new Date() } });
        return { runId: run.id, wrote: Boolean(result.writeup) };
      });
      done.push({ book: key, run: out?.runId ?? null, wrote: Boolean(out?.wrote) });
    }
    return { done };
  },
);
