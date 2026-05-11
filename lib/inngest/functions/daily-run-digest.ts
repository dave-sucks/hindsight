/**
 * daily-run-digest — one email per owner at 10 AM ET, summarising what their
 * analysts did this morning. Captures positions opened, positions closed, and
 * material thesis changes (UPDATED / INVALIDATED / CLOSED — REVIEWED is too
 * noisy). Analysts with no activity collapse to a single "no actions" line.
 * Skips the owner entirely if nothing happened across all their analysts.
 *
 * The trade-opened and trade-closed alerts fire immediately per-trade; this
 * digest exists so the owner can scan the morning's full output at a glance
 * without having to reconcile a flurry of single-trade emails into a mental
 * model of what each analyst did.
 *
 * Gated on AgentConfig.emailAlerts (same flag as trade-opened). Once team
 * access ships, swap the single ownerEmail lookup for getAccountEmails().
 */
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { sendEmail, getUserEmail } from "@/lib/email";
import {
  dailyRunDigestHtml,
  type DigestAnalyst,
  type DigestNewTrade,
  type DigestClosedTrade,
  type DigestThesisChange,
} from "@/lib/emails/daily-run-digest";

function formatEtDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export const dailyRunDigest = inngest.createFunction(
  {
    id: "daily-run-digest",
    name: "Daily Run Digest Email",
    concurrency: { limit: 1 },
    retries: 1,
  },
  // 10:00 AM ET Mon–Fri. Cron string auto-adjusts for EDT/EST.
  { cron: "TZ=America/New_York 0 10 * * 1-5" },
  async ({ step }) => {
    // Cron fires at 10 AM ET. Walk back 6 hours to capture everything that
    // happened since ~4 AM ET — comfortably before the 6:30 AM intelligence
    // pipeline starts. DST-safe; we don't need precise midnight ET.
    const morningStart = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const dateLabel = formatEtDate();

    // Step 1: Load all analysts opted in to email alerts.
    const analysts = await step.run("load-analysts", async () => {
      return prisma.agentConfig.findMany({
        where: { emailAlerts: true, enabled: true },
        select: { id: true, name: true, userId: true },
      });
    });

    if (analysts.length === 0) {
      return { skipped: true, reason: "no-analysts-opted-in" };
    }

    // Group analysts by owner — one email per account, not one per analyst.
    type AnalystRow = { id: string; name: string; userId: string };
    const analystRows = analysts as AnalystRow[];
    const byOwner = new Map<string, AnalystRow[]>();
    for (const a of analystRows) {
      const existing = byOwner.get(a.userId) ?? [];
      existing.push(a);
      byOwner.set(a.userId, existing);
    }

    type GatheredNew = {
      analystId: string;
      symbol: string;
      direction: string;
      quantity: number;
      avgCost: number;
      stopLoss: number | null;
      targetPrice: number | null;
    };
    type GatheredClosed = {
      analystId: string;
      symbol: string;
      direction: string;
      avgCost: number;
      closePrice: number | null;
      outcome: string | null;
      closeReason: string | null;
      openedAt: Date | string;
      closedAt: Date | string | null;
    };
    type GatheredThesisChange = {
      type: string;
      summary: string;
      thesis: {
        ticker: string;
        direction: string;
        researchRun: { agentConfigId: string } | null;
      };
    };

    const sent: string[] = [];
    const skipped: { ownerId: string; reason: string }[] = [];

    for (const [ownerId, ownerAnalysts] of byOwner) {
      const analystIds = ownerAnalysts.map((a: AnalystRow) => a.id);

      const gatheredRaw = await step.run(`gather-${ownerId}`, async () => {
        const [newPositions, closedPositions, thesisChanges] = await Promise.all([
          prisma.position.findMany({
            where: {
              userId: ownerId,
              analystId: { in: analystIds },
              openedAt: { gte: morningStart },
              status: "OPEN",
            },
            select: {
              analystId: true,
              symbol: true,
              direction: true,
              quantity: true,
              avgCost: true,
              stopLoss: true,
              targetPrice: true,
            },
          }),
          prisma.position.findMany({
            where: {
              userId: ownerId,
              analystId: { in: analystIds },
              closedAt: { gte: morningStart },
              status: "CLOSED",
            },
            select: {
              analystId: true,
              symbol: true,
              direction: true,
              avgCost: true,
              closePrice: true,
              outcome: true,
              closeReason: true,
              openedAt: true,
              closedAt: true,
            },
          }),
          prisma.thesisUpdate.findMany({
            where: {
              timestamp: { gte: morningStart },
              type: { in: ["INVALIDATED", "CLOSED", "UPDATED"] },
              thesis: {
                userId: ownerId,
                researchRun: { agentConfigId: { in: analystIds } },
              },
            },
            select: {
              type: true,
              summary: true,
              thesis: {
                select: {
                  ticker: true,
                  direction: true,
                  researchRun: { select: { agentConfigId: true } },
                },
              },
            },
          }),
        ]);

        return { newPositions, closedPositions, thesisChanges };
      });

      const gathered = gatheredRaw as {
        newPositions: GatheredNew[];
        closedPositions: GatheredClosed[];
        thesisChanges: GatheredThesisChange[];
      };

      // Build per-analyst sections.
      const perAnalyst: DigestAnalyst[] = ownerAnalysts.map((a: AnalystRow) => {
        const newTrades: DigestNewTrade[] = gathered.newPositions
          .filter((p) => p.analystId === a.id)
          .map((p) => ({
            ticker: p.symbol,
            direction: p.direction as "LONG" | "SHORT",
            qty: p.quantity,
            avgCost: p.avgCost,
            stopLoss: p.stopLoss,
            targetPrice: p.targetPrice,
          }));

        const closedTrades: DigestClosedTrade[] = gathered.closedPositions
          .filter((p) => p.analystId === a.id)
          .map((p) => {
            const closePrice = p.closePrice ?? p.avgCost;
            const rawPct =
              p.avgCost > 0
                ? ((closePrice - p.avgCost) / p.avgCost) * 100
                : 0;
            const pnlPct = p.direction === "SHORT" ? -rawPct : rawPct;
            const closedAtMs = p.closedAt
              ? new Date(p.closedAt).getTime()
              : Date.now();
            const daysHeld = Math.max(
              1,
              Math.round(
                (closedAtMs - new Date(p.openedAt).getTime()) / 86_400_000,
              ),
            );
            return {
              ticker: p.symbol,
              direction: p.direction as "LONG" | "SHORT",
              outcome: (p.outcome ?? "BREAKEVEN") as
                | "WIN"
                | "LOSS"
                | "BREAKEVEN",
              realizedPnlPct: pnlPct,
              daysHeld,
              closeReason: p.closeReason ?? "MANUAL",
            };
          });

        const thesisChanges: DigestThesisChange[] = gathered.thesisChanges
          .filter((u) => u.thesis.researchRun?.agentConfigId === a.id)
          .map((u) => ({
            ticker: u.thesis.ticker,
            type: u.type,
            summary: u.summary,
          }));

        return {
          analystName: a.name,
          newTrades,
          closedTrades,
          thesisChanges,
        };
      });

      const accountTotal = perAnalyst.reduce(
        (s, x) =>
          s + x.newTrades.length + x.closedTrades.length + x.thesisChanges.length,
        0,
      );

      if (accountTotal === 0) {
        skipped.push({ ownerId, reason: "no-activity" });
        continue;
      }

      type EmailResult = { sent: boolean; reason?: string; to?: string };
      const resultRaw = await step.run(`email-${ownerId}`, async () => {
        const toEmail = await getUserEmail(ownerId);
        if (!toEmail) {
          const r: EmailResult = { sent: false, reason: "no-email" };
          return r;
        }

        await sendEmail({
          to: toEmail,
          subject: `Morning Run Digest — ${dateLabel}`,
          html: dailyRunDigestHtml({
            date: dateLabel,
            analysts: perAnalyst,
          }),
        });
        const r: EmailResult = { sent: true, to: toEmail };
        return r;
      });

      const result = resultRaw as EmailResult;
      if (result.sent) sent.push(ownerId);
      else skipped.push({ ownerId, reason: result.reason ?? "send-failed" });
    }

    return { sent: sent.length, skipped };
  },
);
