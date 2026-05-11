/**
 * daily-run-digest — one email per owner at 10 AM ET, summarising what
 * their analysts did this morning during the 8 AM MORNING_PLAN cron.
 *
 * Includes ONLY actions taken inside MORNING_PLAN runs that started in
 * the morning window today (Mon-Fri 7-10 AM ET):
 *
 *   - Bought / Shorted  — TradeDecision.decision = INITIATE
 *   - Sold   / Covered  — TradeDecision.decision = EXIT
 *   - Added              — TradeDecision.decision = ADD
 *   - Reduced            — TradeDecision.decision = PARTIAL_EXIT
 *   - Watch              — TradeDecision.decision = WATCH
 *
 * Off-cycle activity (tactical runs, discovery runs, manual user runs,
 * price-monitor stop/target closes, EOD flatten) fires immediate emails
 * via place-trade / closeOpenPosition with the matching suppression rule
 * — so the digest and the per-trade emails partition the action space
 * cleanly with no double-notify. Hold and Pass decisions are skipped:
 * the user explicitly asked for "action ones" only.
 *
 * Analysts that ran but took no actions collapse to "No actions taken
 * this morning." Owners with zero actions across all analysts get
 * skipped entirely.
 *
 * Gated on AgentConfig.emailAlerts. Future team access: replace
 * getUserEmail(ownerId) with getAccountEmails(ownerId).
 */
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { sendEmail, getUserEmail } from "@/lib/email";
import {
  dailyRunDigestHtml,
  type DigestAnalyst,
  type DigestActionRow,
  type DigestActionKind,
} from "@/lib/emails/daily-run-digest";

function formatEtDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

function formatNotional(qty: number, price: number): string {
  const n = qty * price;
  if (n >= 1000) {
    return `$${Math.round(n).toLocaleString()}`;
  }
  return `$${n.toFixed(2)}`;
}

export const dailyRunDigest = inngest.createFunction(
  {
    id: "daily-run-digest",
    name: "Daily Run Digest Email",
    concurrency: { limit: 1 },
    retries: 1,
  },
  // 10:00 AM ET Mon–Fri. Cron auto-adjusts for EDT/EST.
  { cron: "TZ=America/New_York 0 10 * * 1-5" },
  async ({ step }) => {
    // Look back 6h from the 10 AM ET fire time — comfortably covers the
    // 8 AM morning cron, no DST math required.
    const morningStart = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const dateLabel = formatEtDate();

    type AnalystRow = { id: string; name: string; userId: string };
    const analysts = (await step.run("load-analysts", async () => {
      return prisma.agentConfig.findMany({
        where: { emailAlerts: true, enabled: true },
        select: { id: true, name: true, userId: true },
      });
    })) as AnalystRow[];

    if (analysts.length === 0) {
      return { skipped: true, reason: "no-analysts-opted-in" };
    }

    // Group analysts by owner — one email per account, regardless of analyst count.
    const byOwner = new Map<string, AnalystRow[]>();
    for (const a of analysts) {
      const existing = byOwner.get(a.userId) ?? [];
      existing.push(a);
      byOwner.set(a.userId, existing);
    }

    type GatheredDecision = {
      analystId: string;
      symbol: string;
      decision: string;
      position: {
        direction: string;
        quantity: number;
        avgCost: number;
        stopLoss: number | null;
        targetPrice: number | null;
        closePrice: number | null;
        outcome: string | null;
      } | null;
    };
    type GatheredWatchAdd = {
      analystId: string;
      symbol: string;
      reason: string;
      targetPrice: number | null;
    };

    const sent: string[] = [];
    const skipped: { ownerId: string; reason: string }[] = [];

    for (const [ownerId, ownerAnalysts] of byOwner) {
      const analystIds = ownerAnalysts.map((a) => a.id);

      const gatheredRaw = await step.run(`gather-${ownerId}`, async () => {
        // 1. This morning's MORNING_PLAN runs for this owner.
        const morningRuns = await prisma.researchRun.findMany({
          where: {
            userId: ownerId,
            agentConfigId: { in: analystIds },
            mode: "MORNING_PLAN",
            startedAt: { gte: morningStart },
          },
          select: { id: true },
        });
        const morningRunIds = (morningRuns as Array<{ id: string }>).map((r) => r.id);

        if (morningRunIds.length === 0) {
          return {
            decisions: [] as GatheredDecision[],
            watchAdds: [] as GatheredWatchAdd[],
          };
        }

        // 2. All decisions in those runs that map to an action chip.
        const decisions = await prisma.tradeDecision.findMany({
          where: {
            runId: { in: morningRunIds },
            decision: { in: ["INITIATE", "EXIT", "ADD", "PARTIAL_EXIT", "WATCH"] },
          },
          select: {
            analystId: true,
            symbol: true,
            decision: true,
            position: {
              select: {
                direction: true,
                quantity: true,
                avgCost: true,
                stopLoss: true,
                targetPrice: true,
                closePrice: true,
                outcome: true,
              },
            },
          },
        });

        // 3. Watchlist items added by this morning's runs.
        const watchAdds = await prisma.analystWatchlistItem.findMany({
          where: {
            analystId: { in: analystIds },
            addedRunId: { in: morningRunIds },
            status: "ACTIVE",
          },
          select: {
            analystId: true,
            symbol: true,
            reason: true,
            targetPrice: true,
          },
        });

        return { decisions, watchAdds };
      });

      const gathered = gatheredRaw as {
        decisions: GatheredDecision[];
        watchAdds: GatheredWatchAdd[];
      };

      // Build per-analyst sections.
      const perAnalyst: DigestAnalyst[] = ownerAnalysts.map((a) => {
        const rows: DigestActionRow[] = [];

        for (const dec of gathered.decisions.filter((d) => d.analystId === a.id)) {
          const p = dec.position;
          if (!p) continue;
          const isLong = p.direction === "LONG";

          if (dec.decision === "INITIATE") {
            const kind: DigestActionKind = isLong ? "BOUGHT" : "SHORTED";
            const desc = [
              `${p.quantity.toLocaleString()} @ $${p.avgCost.toFixed(2)}`,
              formatNotional(p.quantity, p.avgCost),
              p.stopLoss != null ? `stop $${p.stopLoss.toFixed(2)}` : null,
              p.targetPrice != null ? `target $${p.targetPrice.toFixed(2)}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            rows.push({ ticker: dec.symbol, kind, description: desc });
            continue;
          }

          if (dec.decision === "EXIT") {
            const kind: DigestActionKind = isLong ? "SOLD" : "COVERED";
            const close = p.closePrice ?? p.avgCost;
            const rawPct = p.avgCost > 0 ? ((close - p.avgCost) / p.avgCost) * 100 : 0;
            const pnlPct = isLong ? rawPct : -rawPct;
            const sign = pnlPct >= 0 ? "+" : "";
            const outcome = p.outcome ?? "BREAKEVEN";
            const desc = `${outcome} · ${sign}${pnlPct.toFixed(1)}% · ${p.quantity.toLocaleString()} @ $${close.toFixed(2)}`;
            rows.push({ ticker: dec.symbol, kind, description: desc });
            continue;
          }

          if (dec.decision === "ADD") {
            rows.push({
              ticker: dec.symbol,
              kind: "ADDED",
              description: `Scaled in · ${p.quantity.toLocaleString()} shares now @ avg $${p.avgCost.toFixed(2)}`,
            });
            continue;
          }

          if (dec.decision === "PARTIAL_EXIT") {
            rows.push({
              ticker: dec.symbol,
              kind: "REDUCED",
              description: `Partial close · ${p.quantity.toLocaleString()} shares remaining @ avg $${p.avgCost.toFixed(2)}`,
            });
            continue;
          }
        }

        for (const w of gathered.watchAdds.filter((x) => x.analystId === a.id)) {
          const targetPart = w.targetPrice != null ? ` · target $${w.targetPrice.toFixed(2)}` : "";
          const reasonPart =
            w.reason && w.reason.length > 0
              ? ` · ${w.reason.length > 80 ? w.reason.slice(0, 77) + "…" : w.reason}`
              : "";
          rows.push({
            ticker: w.symbol,
            kind: "WATCH",
            description: `Added to watchlist${targetPart}${reasonPart}`,
          });
        }

        return { analystName: a.name, actions: rows };
      });

      const totalActions = perAnalyst.reduce((s, x) => s + x.actions.length, 0);
      if (totalActions === 0) {
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
        const ok = await sendEmail({
          to: toEmail,
          subject: `Morning Run Digest — ${dateLabel}`,
          html: dailyRunDigestHtml({
            date: dateLabel,
            analysts: perAnalyst,
          }),
        });
        const r: EmailResult = ok
          ? { sent: true, to: toEmail }
          : { sent: false, reason: "send-rejected", to: toEmail };
        return r;
      });

      const result = resultRaw as EmailResult;
      if (result.sent) sent.push(ownerId);
      else skipped.push({ ownerId, reason: result.reason ?? "send-failed" });
    }

    return { sent: sent.length, skipped };
  },
);
