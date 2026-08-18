/**
 * portfolio-digest.ts — EOD cron that writes one Daily Portfolio Digest per
 * account per trading day. See docs/plans/PORTFOLIO_DIGEST.md (Feature A).
 *
 * Runs after market close + after the last tactical settles (8:00 PM ET,
 * Mon-Fri). For each account with trading activity (see
 * lib/portfolio/digest-pairs.ts for what qualifies):
 *   1. buildDigestFacts(accountId, date, environment) — the facts blob
 *   2. writeDigestNarrative(facts)       — cheap-model markdown narration
 *   3. upsert a PortfolioDigest row, idempotent on (accountId, environment, date)
 *
 * The unit of work is an (account, environment) PAIR — PAPER and LIVE share one
 * accountId, so each environment that had activity today gets its own row.
 *
 * ADDITIVE: nothing consumes these rows yet (the agent rewire is a separate
 * reviewed PR). Safe to run; it only writes to the new PortfolioDigest table.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { etTradingDayDate } from "@/lib/market-hours";
import type { DigestFacts } from "@/lib/portfolio/digest-facts";
import { buildDigestFacts } from "@/lib/portfolio/digest-facts-builder";
import { writeDigestNarrative } from "@/lib/agent/digest-writer";
import {
  selectDigestPairs,
  TRADING_RUN_MODES,
} from "@/lib/portfolio/digest-pairs";

/** YYYY-MM-DD (ET) for the trading day a Date falls in. */
function etDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export const portfolioDigest = inngest.createFunction(
  {
    id: "portfolio-digest",
    name: "Daily Portfolio Digest (EOD)",
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: "TZ=America/New_York 0 20 * * 1-5" }, // 8:00 PM ET, Mon-Fri
  async ({ step }) => {
    const today = etTradingDayDate();
    const dateStr = etDateString(today);
    // The DB `date` column anchors at ET midnight (same as etTradingDayDate).
    const digestDate = today;

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

      const { narrative, model } = await step.run(
        `narrate-${key}`,
        async () => {
          return writeDigestNarrative(facts as unknown as DigestFacts);
        },
      );

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
            facts: facts as unknown as object,
            model,
          },
          update: {
            narrative,
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
