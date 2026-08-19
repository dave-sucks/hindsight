/**
 * get_earnings_history — 8 quarters of earnings beats / misses + revenue + EPS.
 *
 * Deeper version of `get_earnings_data` (which returns the upcoming-earnings
 * snapshot + a beat-rate %). This one returns the per-quarter table:
 * revenue actual vs estimate vs surprise%, EPS actual vs estimate vs
 * surprise%, BEAT/MISS/INLINE outcome.
 *
 * Backs the thesis 'Latest Earnings' bullets section. Uses Finnhub
 * /stock/earnings for the EPS history and FMP /historical/earning_calendar
 * for the revenue side.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { finnhub } from "@/lib/agent/research-helpers";
import { fmp } from "@/lib/market-data/fmp";

interface FinnhubEarningsRow {
  period: string;
  actual: number;
  estimate: number;
  surprise?: number;
  surprisePercent?: number;
}

interface FmpEarningsCalendarRow {
  date: string;
  symbol: string;
  // Legacy /api/v3 shape — kept for backward compat if FMP ever flips back.
  eps?: number | null;
  revenue?: number | null;
  fiscalDateEnding?: string;
  // /stable/ shape (current — 2026-05-19+).
  epsActual?: number | null;
  epsEstimated?: number | null;
  revenueActual?: number | null;
  revenueEstimated?: number | null;
}

function outcomeFor(actual: number | null | undefined, estimate: number | null | undefined): "BEAT" | "MISS" | "INLINE" | "UNK" {
  if (actual == null || estimate == null) return "UNK";
  if (estimate === 0) return actual > 0 ? "BEAT" : actual < 0 ? "MISS" : "INLINE";
  const surprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;
  if (surprisePct >= 1) return "BEAT";
  if (surprisePct <= -1) return "MISS";
  return "INLINE";
}

export const getEarningsHistory = defineTool({
  description:
    "Get the last 8 quarters of earnings results — revenue actual vs estimate, EPS actual vs " +
    "estimate, surprise %, beat/miss/inline outcome. Backs the thesis 'Latest Earnings' bullets. " +
    "Combines Finnhub EPS-surprise history with FMP earnings-calendar revenue data.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
    quarters: z
      .number()
      .int()
      .min(1)
      .max(16)
      .optional()
      .describe("How many recent quarters to return (default 8)."),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.ticker.toUpperCase()}'s earnings history`,

  execute: async ({ ticker, quarters }) => {
    const T = ticker.toUpperCase();
    const n = quarters ?? 8;

    const [epsRes, calRes] = await Promise.all([
      finnhub(`/stock/earnings?symbol=${T}&limit=${n}`, 2),
      // /stable/earnings replaces /historical/earning_calendar; free
      // tier caps `limit` at 5, so clamp downward when the agent asks
      // for more. The Finnhub /stock/earnings call below is the
      // canonical n-quarter source — FMP is just enrichment.
      fmp<FmpEarningsCalendarRow[]>(
        `/stable/earnings?symbol=${T}&limit=${Math.min(n + 2, 5)}`,
      ),
    ]);

    const errors: string[] = [];
    if (calRes.error) errors.push(`fmp-earnings: ${calRes.error}`);

    const epsRows = Array.isArray(epsRes.data) ? (epsRes.data as FinnhubEarningsRow[]) : [];
    const calRows = (calRes.data ?? []).filter((r) => r.symbol === T);

    // Index FMP calendar by period (YYYY-MM-DD) so we can join with Finnhub by date proximity.
    type Joined = {
      quarter: string; // "Q1 2026" style label, derived from Finnhub period
      reportedAt: string | null;
      revenue: { actual: number | null; estimate: number | null; surprisePct: number | null };
      eps: { actual: number; estimate: number; surprisePct: number | null };
      outcome: "BEAT" | "MISS" | "INLINE" | "UNK";
    };

    const history: Joined[] = epsRows.slice(0, n).map((er) => {
      // Match against FMP by closest date. Finnhub 'period' is quarter-end (YYYY-MM-DD).
      const qEnd = er.period;
      let best: FmpEarningsCalendarRow | null = null;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (const cr of calRows) {
        const calDate = (cr.fiscalDateEnding ?? cr.date ?? "").slice(0, 10);
        if (!calDate) continue;
        const diff = Math.abs(new Date(calDate).getTime() - new Date(qEnd).getTime());
        if (diff < bestDiff) {
          bestDiff = diff;
          best = cr;
        }
      }
      // Accept the match only if within ~120 days (matches the same fiscal quarter).
      const matched = bestDiff < 120 * 86400_000 ? best : null;

      // /stable/ returns `revenueActual`; legacy /api/v3 returned `revenue`.
      // Read either shape — they're populated by the FMP response.
      const revActual = matched?.revenueActual ?? matched?.revenue ?? null;
      const revEst = matched?.revenueEstimated ?? null;
      const revSurprisePct =
        revActual != null && revEst != null && revEst !== 0
          ? ((revActual - revEst) / Math.abs(revEst)) * 100
          : null;

      const epsSurprisePct =
        er.surprisePercent ??
        (er.estimate !== 0 ? ((er.actual - er.estimate) / Math.abs(er.estimate)) * 100 : null);

      const epsOutcome = outcomeFor(er.actual, er.estimate);
      const revOutcome = outcomeFor(revActual, revEst);

      // Combined outcome: BEAT only if both beat; MISS if either misses;
      // else INLINE / UNK based on whichever is known.
      let combined: "BEAT" | "MISS" | "INLINE" | "UNK";
      if (epsOutcome === "BEAT" && (revOutcome === "BEAT" || revOutcome === "UNK")) combined = "BEAT";
      else if (epsOutcome === "MISS" || revOutcome === "MISS") combined = "MISS";
      else if (epsOutcome === "BEAT" && revOutcome === "INLINE") combined = "BEAT";
      else if (epsOutcome === "INLINE" || revOutcome === "INLINE") combined = "INLINE";
      else combined = "UNK";

      // Derive quarter label from period date (e.g. "2026-03-31" → "Q1 2026").
      const d = new Date(er.period);
      const month = d.getUTCMonth() + 1;
      const year = d.getUTCFullYear();
      const qNum = Math.min(4, Math.ceil(month / 3));
      const quarter = `Q${qNum} ${year}`;

      return {
        quarter,
        reportedAt: matched?.date ?? null,
        revenue: {
          actual: revActual,
          estimate: revEst,
          surprisePct: revSurprisePct,
        },
        eps: {
          actual: er.actual,
          estimate: er.estimate,
          surprisePct: epsSurprisePct,
        },
        outcome: combined,
      };
    });

    const beats = history.filter((q) => q.outcome === "BEAT").length;
    const misses = history.filter((q) => q.outcome === "MISS").length;
    const known = history.filter((q) => q.outcome !== "UNK").length;
    const beatRatePct = known > 0 ? Math.round((beats / known) * 100) : null;

    const items: Array<
      | { kind: "generic"; text: string }
      | { kind: "ticker"; ticker: string; tag: string; text: string }
    > = [];

    if (history.length > 0) {
      items.push({
        kind: "ticker",
        ticker: T,
        tag:
          beatRatePct != null ? `${beatRatePct}% beat (${beats}/${known})` : `${history.length}q`,
        text:
          history.length > 0
            ? `${history[0].quarter} → ${history[history.length - 1].quarter}: ${beats} beats, ${misses} misses.`
            : "No earnings history.",
      });
    } else {
      items.push({
        kind: "ticker",
        ticker: T,
        tag: "no data",
        text: "Finnhub returned no earnings rows.",
      });
    }

    for (const q of history.slice(0, 5)) {
      const revText =
        q.revenue.actual != null && q.revenue.estimate != null
          ? ` rev $${(q.revenue.actual / 1e9).toFixed(2)}B vs $${(q.revenue.estimate / 1e9).toFixed(2)}B est`
          : "";
      const surprise = q.eps.surprisePct != null ? `${q.eps.surprisePct >= 0 ? "+" : ""}${q.eps.surprisePct.toFixed(1)}%` : "n/a";
      items.push({
        kind: "generic",
        text: `${q.quarter}${q.reportedAt ? ` (${q.reportedAt})` : ""}: EPS $${q.eps.actual.toFixed(2)} vs $${q.eps.estimate.toFixed(2)} (${surprise})${revText} — ${q.outcome}`,
      });
    }
    if (history.length > 5) {
      items.push({ kind: "generic", text: `… ${history.length} quarters total in data.` });
    }
    if (errors.length > 0) {
      items.push({
        kind: "generic",
        text: `Partial data — ${errors.join("; ")}`,
      });
    }

    return {
      summary:
        history.length > 0
          ? `$${T} earnings — ${beats} beats / ${misses} misses over ${history.length} quarters.`
          : `$${T} earnings — no history (${errors.join("; ") || "empty"}).`,
      data: {
        ticker: T,
        history,
        beats,
        misses,
        beatRatePct,
        errors,
        items,
      },
      sources: [
        { provider: "Finnhub", title: `${T} EPS Surprise History`, url: "https://finnhub.io/docs/api/company-earnings" },
        { provider: "FMP", title: `${T} Earnings Calendar History`, url: `https://financialmodelingprep.com/earnings-calendar` },
      ],
    };
  },
});
