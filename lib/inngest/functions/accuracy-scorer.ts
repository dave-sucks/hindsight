/**
 * Weekly accuracy scorer (DAV-76 + DAV-77).
 *
 * Runs every Sunday at the same time as the weekly digest.
 * For each user with ≥ 3 closed trades:
 *   1. Compute calibration / signal accuracy stats
 *   2. Generate a GPT-4o calibration narrative
 *   3. Persist an AccuracyReport row
 */

import OpenAI from "openai";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { getAccuracyStats, type AccuracyStats } from "@/lib/accuracy-stats";
import { etTradingDayDate } from "@/lib/market-hours";
import { getOwnerUserId } from "@/lib/auth/account";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
}

// ─── Narrative generation ─────────────────────────────────────────────────────

async function generateNarrative(stats: AccuracyStats): Promise<string> {
  if (stats.tradesAnalyzed < 3) {
    return "Insufficient trade history for calibration analysis.";
  }

  const bulletsForPrompt = stats.calibration
    .filter((b) => b.count > 0)
    .map(
      (b) =>
        `  • Confidence ${b.label}: expected ${Math.round(b.expectedWinRate * 100)}% win, ` +
        `actual ${b.winRate !== null ? Math.round(b.winRate * 100) : "—"}% (n=${b.count})`
    )
    .join("\n");

  const topSignals = stats.signalAccuracy
    .slice(0, 4)
    .map((s) => `  • ${s.signal}: ${s.winRate !== null ? Math.round(s.winRate * 100) : "—"}% win rate (n=${s.count})`)
    .join("\n");

  const prompt =
    `Overall win rate: ${stats.overallWinRate !== null ? Math.round(stats.overallWinRate * 100) : "—"}% ` +
    `across ${stats.tradesAnalyzed} trades.\n\n` +
    `Confidence calibration:\n${bulletsForPrompt}\n\n` +
    `Top signal accuracy:\n${topSignals}\n\n` +
    `Streaks: best win=${stats.longestWinStreak}, worst loss=${stats.longestLossStreak}\n\n` +
    `In 3-4 sentences: Is the model well-calibrated? Where is it overconfident or underconfident? ` +
    `Which signal types are most/least reliable? What should be adjusted?`;

  try {
    const resp = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a quant analyst reviewing a trading model's calibration. " +
            "Be specific, honest, and actionable. Max 80 words. No filler.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 150,
    });
    return resp.choices[0].message.content?.trim() ?? "";
  } catch {
    return `Win rate ${stats.overallWinRate !== null ? Math.round(stats.overallWinRate * 100) : "—"}% across ${stats.tradesAnalyzed} trades. Review calibration data for details.`;
  }
}

// ─── Inngest function ─────────────────────────────────────────────────────────

export const accuracyScorer = inngest.createFunction(
  {
    id: "accuracy-scorer",
    name: "Weekly Accuracy Scorer",
    concurrency: { limit: 1 },
    retries: 1,
  },
  { cron: "TZ=America/New_York 0 10 * * 0" }, // Sunday 10:00 AM ET (after weekly digest at 9:00)
  async ({ step }) => {
    // Step 1: Find accounts with at least 3 closed trades.
    const accountIds = await step.run("find-eligible-accounts", async () => {
      const rows = await prisma.position.groupBy({
        by: ["accountId"],
        where: { status: "CLOSED", outcome: { in: ["WIN", "LOSS", "BREAKEVEN"] } },
        _count: { id: true },
      });
      return rows
        .filter((r) => r._count.id >= 3)
        .map((r) => r.accountId);
    });

    if (accountIds.length === 0) {
      return { skipped: true, reason: "no-eligible-accounts" };
    }

    // Week window starts at ET midnight 7 days ago.
    const todayEt = etTradingDayDate();
    const weekStart = new Date(todayEt);
    weekStart.setUTCDate(todayEt.getUTCDate() - 7);

    const reports: string[] = [];

    for (const accountId of accountIds) {
      // Resolve the OWNER's userId — getAccuracyStats still keys on userId
      // pending a follow-up that migrates it to accountId.
      const ownerUserId = await getOwnerUserId(accountId);
      if (!ownerUserId) {
        console.warn(`[accuracy-scorer] account ${accountId} has no OWNER membership; skipping.`);
        continue;
      }

      const stats = await step.run(`stats-${accountId}`, async () => {
        return getAccuracyStats(ownerUserId);
      });

      const narrative = await step.run(`narrative-${accountId}`, async () => {
        return generateNarrative(stats);
      });

      await step.run(`save-${accountId}`, async () => {
        const existing = await prisma.accuracyReport.findFirst({
          where: { accountId, weekStartDate: { gte: weekStart } },
        });

        if (existing) {
          await prisma.accuracyReport.update({
            where: { id: existing.id },
            data: {
              tradesAnalyzed: stats.tradesAnalyzed,
              winRate: stats.overallWinRate,
              calibrationData: stats.calibration as unknown as object[],
              signalAccuracy: stats.signalAccuracy as unknown as object[],
              directionStats: stats.directionStats as unknown as object[],
              narrativeSummary: narrative,
            },
          });
        } else {
          await prisma.accuracyReport.create({
            data: {
              userId: ownerUserId,
              accountId,
              weekStartDate: weekStart,
              weekEndDate: todayEt,
              tradesAnalyzed: stats.tradesAnalyzed,
              winRate: stats.overallWinRate,
              calibrationData: stats.calibration as unknown as object[],
              signalAccuracy: stats.signalAccuracy as unknown as object[],
              directionStats: stats.directionStats as unknown as object[],
              narrativeSummary: narrative,
            },
          });
        }
      });

      reports.push(accountId);
    }

    return { scored: reports.length, accountIds: reports };
  }
);
