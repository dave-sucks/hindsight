/**
 * portfolio-digest.ts — the Portfolio Reviewer's cron (8:00 PM ET, Mon-Fri,
 * after the market closes and the last trigger run settles). For each
 * account with trading activity (lib/portfolio/digest-pairs.ts says what
 * qualifies):
 *   1. buildDigestFacts(accountId, date, environment): the facts, from code;
 *   2. a ResearchRun named "Portfolio Reviewer" (mode PORTFOLIO_REVIEW) reads
 *      them and writes the brief and the digest (lib/agent/portfolio-reviewer.ts),
 *      its thread saved so the run opens like any other;
 *   3. upsert a PortfolioDigest row, idempotent on (accountId, environment, date).
 *
 * The unit of work is an (account, environment) PAIR — PAPER and LIVE share one
 * accountId, so each environment that had activity today gets its own row.
 *
 * Every agent reads the newest brief in its Market and portfolio block
 * (lib/agent/market-and-portfolio.ts); the digest is for the home page's
 * digest card.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { etTradingDayDate } from "@/lib/market-hours";
import type { DigestFacts } from "@/lib/portfolio/digest-facts";
import { buildDigestFacts } from "@/lib/portfolio/digest-facts-builder";
import { fallbackNarrative, PORTFOLIO_REVIEWER, writePortfolioReview, type PortfolioReview } from "@/lib/agent/portfolio-reviewer";
import { getOwnerUserId } from "@/lib/auth/account";
import { loadWaitingForReview } from "@/lib/portfolio/load-sale-queue";
import { saveRunThread } from "@/lib/agent/run-thread";
import { addTokenUsage, emptyTokenUsage, recordTokenUsage } from "@/lib/agent/token-usage";
import {
  selectDigestPairs,
  TRADING_RUN_MODES,
} from "@/lib/portfolio/digest-pairs";

export const portfolioDigest = inngest.createFunction(
  {
    id: "portfolio-digest",
    name: "Daily Portfolio Digest (EOD)",
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: "TZ=America/New_York 0 20 * * 1-5" }, // 8:00 PM ET, Mon-Fri
  async ({ step }) => {
    // Today's New York date, as the DB stores it (midnight UTC of that date)
    // and as YYYY-MM-DD. Read back in New York time, that midnight is the
    // evening before, which made every digest cover the previous day.
    const digestDate = etTradingDayDate();
    const dateStr = digestDate.toISOString().slice(0, 10);

    // Step 1: find (account, environment) PAIRS with TRADING activity today.
    // PAPER and LIVE share one accountId, so the unit of work is the pair.
    // No activity → no digest (don't write empty rows).
    //
    // "Activity" is deliberately narrower than "any ResearchRun": non-trading
    // modes (PRINCIPAL_CHAT, THESIS_WRITER, podcast runs) default
    // environment=PAPER, so counting them kept writing PAPER digests for an
    // account whose analysts were all promoted to LIVE. Runs are filtered to
    // TRADING_RUN_MODES, and a run-only pair still needs its env to actually
    // be traded (an enabled analyst there, or an OPEN position there).
    // Position opens/closes today count unconditionally — they ARE trading.
    // Selection rule + rationale: lib/portfolio/digest-pairs.ts.
    const pairs = await step.run("find-active-pairs", async () => {
      const dayStart = new Date(`${dateStr}T00:00:00-05:00`);
      // Use a generous window; the facts builder does its own precise ET window.
      const since = new Date(dayStart);
      since.setUTCHours(since.getUTCHours() - 6);

      const [runRows, openRows, closeRows, configRows, openPosRows] =
        await Promise.all([
          prisma.researchRun.findMany({
            where: {
              startedAt: { gte: since },
              mode: { in: [...TRADING_RUN_MODES] },
            },
            select: { accountId: true, environment: true },
            distinct: ["accountId", "environment"],
          }),
          prisma.position.findMany({
            where: { openedAt: { gte: since } },
            select: { accountId: true, environment: true },
            distinct: ["accountId", "environment"],
          }),
          prisma.position.findMany({
            where: { closedAt: { gte: since } },
            select: { accountId: true, environment: true },
            distinct: ["accountId", "environment"],
          }),
          prisma.agentConfig.findMany({
            where: { enabled: true },
            select: { accountId: true, tradingEnvironment: true },
            distinct: ["accountId", "tradingEnvironment"],
          }),
          prisma.position.findMany({
            where: { status: "OPEN" },
            select: { accountId: true, environment: true },
            distinct: ["accountId", "environment"],
          }),
        ]);

      return selectDigestPairs({
        tradingRunPairs: runRows,
        positionActivityPairs: [...openRows, ...closeRows],
        tradedEnvPairs: [
          ...configRows.map((c) => ({
            accountId: c.accountId,
            environment: c.tradingEnvironment,
          })),
          ...openPosRows,
        ],
      });
    });

    if (pairs.length === 0) {
      return { skipped: true, reason: "no-active-accounts", date: dateStr };
    }

    const written: string[] = [];

    for (const { accountId, environment } of pairs) {
      const key = `${accountId}::${environment}`;

      // Build facts (IO: Prisma + Alpaca), scoped to this environment's book.
      const facts = await step.run(`facts-${key}`, async () => {
        return buildDigestFacts(
          accountId,
          dateStr,
          environment as "PAPER" | "LIVE",
        );
      });

      // The run the review is saved as, so it opens on /runs like any other.
      const runId = await step.run(`run-${key}`, async () => {
        const userId = await getOwnerUserId(accountId);
        if (!userId) return null;
        const run = await prisma.researchRun.create({
          data: {
            userId,
            accountId,
            source: "AGENT",
            status: "RUNNING",
            mode: PORTFOLIO_REVIEWER.mode,
            environment,
            parameters: { name: PORTFOLIO_REVIEWER.name, date: dateStr, triggeredBy: "portfolio-review-cron" } as object,
          },
          select: { id: true },
        });
        return run.id;
      });

      // Never throws: whatever fails, the run ends COMPLETE or FAILED (nothing else sweeps a run with no
      // analyst out of RUNNING), and the digest is the plain facts with no brief.
      const { brief, narrative, model } = await step.run(`review-${key}`, async () => {
        const warn = (what: string) => (err: unknown) => console.warn(`[portfolio-reviewer] ${what} for ${key}:`, err instanceof Error ? err.message : err);
        let review: PortfolioReview | null = null;
        try {
          // Every proposal waiting, and each sale as the owner's decision: its history, the floor that fired and the note in full.
          const { pending, sales } = await loadWaitingForReview({ accountId, environment, facts: facts as unknown as DigestFacts });
          review = await writePortfolioReview(facts as unknown as DigestFacts, pending, { sales, runId });
          if (runId) {
            await saveRunThread(runId, { opening: review.opening, messages: review.messages, steps: [] }, "portfolio-reviewer").catch(warn("the thread couldn't be saved"));
            const usage = emptyTokenUsage();
            for (const u of review.usage) addTokenUsage(usage, u);
            await recordTokenUsage(runId, usage, PORTFOLIO_REVIEWER.model).catch(warn("the token use couldn't be saved"));
          }
          return { brief: review.brief, narrative: review.narrative, model: review.model };
        } catch (err) {
          warn("the review failed")(err);
          return { brief: null, narrative: fallbackNarrative(facts as unknown as DigestFacts), model: "fallback" };
        } finally {
          if (runId)
            await prisma.researchRun
              .update({ where: { id: runId }, data: { status: review && review.model !== "fallback" ? "COMPLETE" : "FAILED", completedAt: new Date() } })
              .catch(warn("the run couldn't be marked done"));
        }
      });

      await step.run(`save-${key}`, async () => {
        await prisma.portfolioDigest.upsert({
          where: {
            accountId_environment_date: {
              accountId,
              environment,
              date: digestDate,
            },
          },
          create: {
            accountId,
            environment,
            date: digestDate,
            narrative,
            brief,
            facts: facts as unknown as object,
            model,
          },
          // A rerun whose model failed leaves a written digest and brief as they were.
          update:
            model === "fallback"
              ? {}
              : {
                  narrative,
                  brief,
                  facts: facts as unknown as object,
                  model,
                },
        });
      });

      written.push(key);
    }

    return { written: written.length, pairs: written, date: dateStr };
  },
);
