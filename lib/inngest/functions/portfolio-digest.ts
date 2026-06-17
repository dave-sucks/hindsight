/**
 * portfolio-digest.ts — EOD cron that writes one Daily Portfolio Digest per
 * account per trading day. See docs/plans/PORTFOLIO_DIGEST.md (Feature A).
 *
 * Runs after market close + after the last tactical settles (8:00 PM ET,
 * Mon-Fri). For each account with activity:
 *   1. buildDigestFacts(accountId, date) — the deterministic facts blob
 *   2. writeDigestNarrative(facts)       — cheap-model markdown narration
 *   3. upsert a PortfolioDigest row, idempotent on (accountId, date)
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

    // Step 1: find accounts that had ANY activity today (runs / opens / closes /
    // thesis updates). No activity → no digest (don't write empty rows).
    const accountIds = await step.run("find-active-accounts", async () => {
      const dayStart = new Date(`${dateStr}T00:00:00-05:00`);
      // Use a generous window; the facts builder does its own precise ET window.
      const since = new Date(dayStart);
      since.setUTCHours(since.getUTCHours() - 6);

      const [runRows, openRows, closeRows] = await Promise.all([
        prisma.researchRun.findMany({
          where: { startedAt: { gte: since } },
          select: { accountId: true },
          distinct: ["accountId"],
        }),
        prisma.position.findMany({
          where: { openedAt: { gte: since } },
          select: { accountId: true },
          distinct: ["accountId"],
        }),
        prisma.position.findMany({
          where: { closedAt: { gte: since } },
          select: { accountId: true },
          distinct: ["accountId"],
        }),
      ]);

      const ids = new Set<string>();
      for (const r of [...runRows, ...openRows, ...closeRows]) ids.add(r.accountId);
      return [...ids];
    });

    if (accountIds.length === 0) {
      return { skipped: true, reason: "no-active-accounts", date: dateStr };
    }

    const written: string[] = [];

    for (const accountId of accountIds) {
      // Build facts (IO: Prisma + Alpaca). Default PAPER book — LIVE digests are
      // a follow-up once the LIVE path is validated.
      const facts = await step.run(`facts-${accountId}`, async () => {
        return buildDigestFacts(accountId, dateStr, "PAPER");
      });

      const { narrative, model } = await step.run(
        `narrate-${accountId}`,
        async () => {
          return writeDigestNarrative(facts as unknown as DigestFacts);
        },
      );

      await step.run(`save-${accountId}`, async () => {
        await prisma.portfolioDigest.upsert({
          where: { accountId_date: { accountId, date: digestDate } },
          create: {
            accountId,
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

      written.push(accountId);
    }

    return { written: written.length, accountIds: written, date: dateStr };
  },
);
