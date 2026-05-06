// ── Intraday EOD Flatten ──────────────────────────────────────────────────
// Cron at 15:45 ET on weekdays. Walks every OPEN position whose analyst is
// configured DAY-only (`holdDurations === ["DAY"]`) and force-closes via
// Alpaca. Writes the Thesis CLOSED transition + audit row inline (same
// pattern as the close_position agent tool — see lib/agent/tools/close-
// position.ts).
//
// Why a system rule, not an LLM decision: a DAY analyst going home with an
// open position is a config violation, not a judgment call. The prompt
// already tells the analyst to size for an EOD exit; this cron is the
// safety net that enforces the contract regardless of what the agent did.
//
// Why 15:45 and not 15:55: 15-minute buffer to absorb fill latency, partial
// fills, or Alpaca queue depth before the 16:00 close. Market closes hard
// at 16:00 ET; missing the window means the position holds overnight.

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { isMarketOpen } from "@/lib/market-hours";
import { closeOpenPosition } from "@/lib/actions/closeTrade.actions";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";

function isDayOnly(holdDurations: string[] | null | undefined): boolean {
  const hd = (holdDurations ?? []).map((s) => s.toUpperCase());
  return hd.length > 0 && hd.every((h) => h === "DAY");
}

interface DayPositionRow {
  id: string;
  symbol: string;
  userId: string;
  analystId: string | null;
  analyst: { id: string; name: string; holdDurations: string[] } | null;
}

type FlattenResult =
  | { ticker: string; analyst: string; status: "FLATTENED"; pnl: number }
  | { ticker: string; analyst: string; status: "FAILED"; error: string };

export const intradayEodFlatten = inngest.createFunction(
  {
    id: "intraday-eod-flatten",
    name: "Intraday EOD Flatten (DAY-only analysts)",
    retries: 1,
  },
  { cron: "TZ=America/New_York 45 15 * * 1-5" },
  async ({ step }) => {
    // Step 1 — gate on market hours. Cron schedule already excludes
    // weekends; this catches US market holidays where the cron would
    // otherwise fire and Alpaca would reject every close.
    const marketOpen = await step.run("check-market-hours", async () =>
      isMarketOpen(),
    );
    if (!marketOpen) {
      return { skipped: "market-closed", flattened: 0 };
    }

    // Step 2 — find OPEN positions on DAY-only analysts. We over-fetch and
    // filter post-query because Prisma's String[] equality is fiddly across
    // versions and we want to handle case variation defensively.
    const candidates = (await step.run("fetch-day-positions", async () => {
      const rows = await prisma.position.findMany({
        where: { status: "OPEN" },
        include: {
          analyst: {
            select: { id: true, name: true, holdDurations: true },
          },
        },
      });
      return rows.filter(
        (r: DayPositionRow) => r.analyst && isDayOnly(r.analyst.holdDurations),
      );
    })) as DayPositionRow[];

    if (candidates.length === 0) {
      return { flattened: 0, reason: "no-day-positions-open" };
    }

    // Step 3 — flatten each. Per-position step.run isolates failures; one
    // analyst's stuck order doesn't block another's clean close.
    let flattened = 0;
    let failed = 0;
    const results: FlattenResult[] = [];

    for (const position of candidates) {
      const result = (await step.run(`flatten-${position.id}`, async () => {
        const ticker = position.symbol;
        const analystName = position.analyst?.name ?? "(unknown analyst)";
        try {
          const creds =
            (await resolveAlpacaCredentials(position.userId)) ?? undefined;
          const auditReason = `EOD flatten — DAY analyst ${analystName} must be flat by close. Position auto-closed by intraday-eod-flatten cron at 15:45 ET.`;

          const closed = await closeOpenPosition(
            position.id,
            "TIME",
            creds,
            "agent",
            auditReason,
            undefined,
          );

          // Mark linked thesis CLOSED + write audit row. Mirrors the
          // close_position agent tool path so the timeline + tactical-run
          // close-out gate stay coherent for these positions.
          try {
            // ACTIVE + WATCHING — defensive against the edge case where
            // tactical-run filled an entry but the agent's update_thesis
            // didn't flip status WATCHING → ACTIVE. Without this, the
            // EOD-flatten close happens but the thesis stays WATCHING
            // forever with no audit row.
            const activeThesis = await prisma.thesis.findFirst({
              where: {
                ticker,
                status: { in: ["ACTIVE", "WATCHING"] },
                direction: { not: "PASS" },
                researchRun: { agentConfigId: position.analystId },
              },
              orderBy: { createdAt: "desc" },
            });
            if (activeThesis) {
              const priorStatus = activeThesis.status;
              await prisma.thesis.update({
                where: { id: activeThesis.id },
                data: {
                  status: "CLOSED",
                  closedAt: new Date(),
                  closeReason: "EOD_FLATTEN — DAY analyst end-of-session auto-close",
                },
              });
              await writeThesisUpdate({
                thesisId: activeThesis.id,
                type: "CLOSED",
                summary: `EOD flatten — closed ${ticker} (${closed.outcome}, $${closed.realizedPnl.toFixed(2)})`,
                rationale: auditReason,
                fieldChanges: { status: { from: priorStatus, to: "CLOSED" } },
                priceAtTime: closed.closePrice ?? null,
              });
            }
          } catch (thesisErr) {
            console.warn(
              `[intraday-eod-flatten] thesis-close write failed for ${ticker}:`,
              thesisErr instanceof Error ? thesisErr.message : thesisErr,
            );
          }

          return {
            ticker,
            analyst: analystName,
            status: "FLATTENED" as const,
            pnl: closed.realizedPnl,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          console.error(
            `[intraday-eod-flatten] FAILED to close ${ticker} for ${analystName}: ${msg}`,
          );
          return {
            ticker,
            analyst: analystName,
            status: "FAILED" as const,
            error: msg,
          };
        }
      })) as FlattenResult;

      if (result.status === "FLATTENED") flattened++;
      else failed++;
      results.push(result);
    }

    return {
      flattened,
      failed,
      total: candidates.length,
      results,
    };
  },
);
