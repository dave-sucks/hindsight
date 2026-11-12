/**
 * portfolio-digest.ts — EOD cron that writes one Daily Portfolio Digest per
 * account per trading day. See docs/plans/PORTFOLIO_DIGEST.md (Feature A).
 *
 * Runs after market close + after the last tactical settles (8:00 PM ET,
 * Mon-Fri). For each account with trading activity (see
 * lib/portfolio/digest-pairs.ts for what qualifies):
 *   1. loadPortfolioSnapshot — the account, every holding and its moves, the
 *      day's buys and sells, the proposals waiting (lib/portfolio/snapshot.ts)
 *   2. writeDigestNarrative(snapshot) — the owner's summary of the day, saved
 *      as a read-only ResearchRun (mode PORTFOLIO_DIGEST) whose Context panel
 *      shows exactly what the model was sent
 *   3. upsert a PortfolioDigest row, idempotent on (accountId, environment, date);
 *      its `facts` column keeps the snapshot
 *
 * The unit of work is an (account, environment) PAIR — PAPER and LIVE share one
 * accountId, so each environment that had activity today gets its own row.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { etTradingDayDate } from "@/lib/market-hours";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { writeDigestNarrative } from "@/lib/agent/digest-writer";
import { runAccountCall } from "@/lib/runs/account-run";
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
      // A generous window for finding the books that were active today.
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

      // The portfolio snapshot (lib/portfolio/snapshot.ts): the one set of numbers the digest reads.
      const snapshot = await step.run(`snapshot-${key}`, () =>
        loadPortfolioSnapshot({ accountId, environment: environment as "PAPER" | "LIVE" }).catch((err) => {
          console.error(`[portfolio-digest] ${key}: the snapshot couldn't be read, no digest for this book: ${err instanceof Error ? err.message : err}`);
          return null;
        }),
      );
      if (!snapshot) {
        console.warn(`[portfolio-digest] ${key}: skipped, no snapshot (no owner, no broker keys, or the broker failed).`);
        continue;
      }

      // Saved as a read-only run with its one request (lib/runs/account-run.ts).
      const { narrative, model } = await step.run(`narrate-${key}`, async () => {
        const out = await runAccountCall({ accountId, environment, mode: "PORTFOLIO_DIGEST", parameters: { date: dateStr } }, () =>
          writeDigestNarrative(snapshot),
        );
        return { narrative: out.narrative, model: out.model };
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
            facts: snapshot as unknown as object,
            model,
          },
          update: {
            narrative,
            facts: snapshot as unknown as object,
            model,
          },
        });
      });

      written.push(key);
    }

    return { written: written.length, pairs: written, date: dateStr };
  },
);
