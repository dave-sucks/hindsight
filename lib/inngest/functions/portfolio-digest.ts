/**
 * portfolio-digest.ts — EOD cron that writes one Daily Portfolio Digest per
 * account per trading day. See docs/plans/PORTFOLIO_DIGEST.md (Feature A).
 *
 * Runs after market close + after the last tactical settles (8:00 PM ET,
 * Mon-Fri). For each account with activity:
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

    // Step 1: find (account, environment) PAIRS that had ANY activity today
    // (runs / opens / closes). PAPER and LIVE share one accountId, so the unit
    // of work is the pair — each environment with activity gets its own digest.
    // No activity → no digest (don't write empty rows).
    const pairs = await step.run("find-active-pairs", async () => {
      const dayStart = new Date(`${dateStr}T00:00:00-05:00`);
      // Use a generous window; the facts builder does its own precise ET window.
      const since = new Date(dayStart);
      since.setUTCHours(since.getUTCHours() - 6);

      const [runRows, openRows, closeRows] = await Promise.all([
        prisma.researchRun.findMany({
          where: { startedAt: { gte: since } },
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
      ]);

      const seen = new Map<string, { accountId: string; environment: string }>();
      for (const r of [...runRows, ...openRows, ...closeRows]) {
        seen.set(`${r.accountId}::${r.environment}`, {
          accountId: r.accountId,
          environment: r.environment,
        });
      }
      return [...seen.values()];
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
