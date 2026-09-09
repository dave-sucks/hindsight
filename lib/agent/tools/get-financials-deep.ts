/**
 * get_financials_deep — 5-year filed income statement + cash flow + ratios.
 *
 * Provides the multi-year financial trajectory the thesis-writer needs:
 * revenue growth curve, margin trend, EBITDA, FCF, EPS. The companion to
 * `get_stock_data` (which is point-in-time); this is the time-series view.
 *
 * Sources (2026-09-08, DAV-191 finished): statements come from Finnhub's
 * as-filed SEC numbers (`lib/market-data/finnhub-financials.ts`), ratios
 * from Finnhub `/stock/metric`. FMP was removed — the tier we hold refused
 * 26 of the 28 names on the book while the run reported "all sources ok".
 *
 * Forward analyst estimates are NOT available on the data plans we hold
 * (Finnhub gates `/stock/eps-estimate` and `/stock/revenue-estimate`;
 * FMP never served them for these names). `forwardEstimates` is always []
 * and the items say so, so the writer never mistakes silence for consensus.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { finnhub } from "@/lib/agent/research-helpers";
import { getReportedFinancials } from "@/lib/market-data/finnhub-financials";

/** Finnhub `/stock/metric?metric=all` — the handful of keys we read. */
interface FinnhubMetric {
  peTTM?: number | null;
  peBasicExclExtraTTM?: number | null;
  pegTTM?: number | null;
  currentRatioAnnual?: number | null;
  currentRatioQuarterly?: number | null;
  "totalDebt/totalEquityAnnual"?: number | null;
  "totalDebt/totalEquityQuarterly"?: number | null;
  roaTTM?: number | null;
  roeTTM?: number | null;
  roiTTM?: number | null;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export const getFinancialsDeep = defineTool({
  description:
    "Get 5 years of filed annual financials — revenue, gross margin, EBITDA, net income, " +
    "diluted EPS, operating cash flow, capex and free cash flow — plus current valuation " +
    "and balance-sheet ratios. Backs the thesis 'Fundamentals' section. Forward analyst " +
    "estimates are not available on the current data plan and are reported as absent, " +
    "never guessed.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.ticker.toUpperCase()}'s 5-year financials`,

  execute: async ({ ticker }) => {
    const T = ticker.toUpperCase();
    const [filed, metricRes] = await Promise.all([
      getReportedFinancials(T, "annual", 5),
      finnhub(`/stock/metric?symbol=${T}&metric=all`, 2),
    ]);

    const errors: string[] = [];
    if (filed.error) errors.push(`financials-reported: ${filed.error}`);
    if (metricRes.error) errors.push(`metric: ${metricRes.error}`);

    const periods = filed.periods;

    // Build annual series with YoY growth + margins. Shape is unchanged from
    // the FMP era so the data-block formatter reads it as before.
    const annual = periods.map((row, i) => {
      const prev = i > 0 ? periods[i - 1] : null;
      const revenueGrowth =
        prev?.revenue && row.revenue
          ? ((row.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100
          : null;
      const epsGrowth =
        prev?.dilutedEps != null && row.dilutedEps != null && prev.dilutedEps !== 0
          ? ((row.dilutedEps - prev.dilutedEps) / Math.abs(prev.dilutedEps)) * 100
          : null;
      const ebitda =
        row.operatingIncome != null && row.depreciation != null
          ? row.operatingIncome + row.depreciation
          : null;
      const grossMargin =
        row.revenue && row.grossProfit != null ? (row.grossProfit / row.revenue) * 100 : null;
      const ebitdaMargin = row.revenue && ebitda != null ? (ebitda / row.revenue) * 100 : null;
      const netMargin =
        row.revenue && row.netIncome != null ? (row.netIncome / row.revenue) * 100 : null;

      return {
        period: row.period,
        year: String(row.year),
        revenue: row.revenue,
        revenueGrowthPct: revenueGrowth,
        grossProfit: row.grossProfit,
        grossMarginPct: grossMargin,
        ebitda,
        ebitdaMarginPct: ebitdaMargin,
        netIncome: row.netIncome,
        netMarginPct: netMargin,
        dilutedEps: row.dilutedEps,
        epsGrowthPct: epsGrowth,
        operatingCashFlow: row.operatingCashFlow,
        capex: row.capex,
        freeCashFlow: row.freeCashFlow,
      };
    });

    // Not on our plans. Kept as an (always empty) field so consumers and the
    // formatter keep one shape; the item below tells the writer why.
    const forwardEstimates: Array<{
      period: string;
      year: string;
      revenue: number | null;
      revenueGrowthPct: number | null;
      eps: number | null;
      epsGrowthPct: number | null;
    }> = [];

    const m = (metricRes.data as { metric?: FinnhubMetric } | null)?.metric ?? null;
    const ratios = m
      ? {
          pe: num(m.peTTM) ?? num(m.peBasicExclExtraTTM),
          pegRatio: num(m.pegTTM),
          debtToEquity:
            num(m["totalDebt/totalEquityQuarterly"]) ?? num(m["totalDebt/totalEquityAnnual"]),
          currentRatio: num(m.currentRatioQuarterly) ?? num(m.currentRatioAnnual),
          // Finnhub reports these as percentages; the formatter multiplies by
          // 100 for display, so hand it fractions like FMP used to.
          roa: num(m.roaTTM) != null ? (m.roaTTM as number) / 100 : null,
          roe: num(m.roeTTM) != null ? (m.roeTTM as number) / 100 : null,
          roic: num(m.roiTTM) != null ? (m.roiTTM as number) / 100 : null,
        }
      : null;

    // Build progress items.
    const items: Array<
      | { kind: "generic"; text: string }
      | { kind: "ticker"; ticker: string; tag: string; text: string }
    > = [];

    if (annual.length > 0) {
      const oldest = annual[0];
      const newest = annual[annual.length - 1];
      const revLine =
        oldest.revenue && newest.revenue
          ? `Revenue ${oldest.year}: $${(oldest.revenue / 1e9).toFixed(1)}B → ${newest.year}: $${(newest.revenue / 1e9).toFixed(1)}B`
          : null;
      items.push({
        kind: "ticker",
        ticker: T,
        tag: `${annual.length}-yr filed`,
        text: revLine ?? `${annual.length} annual filings returned`,
      });
    } else {
      items.push({
        kind: "ticker",
        ticker: T,
        tag: "no data",
        text: "Finnhub returned no annual filings for this symbol.",
      });
    }
    items.push({
      kind: "generic",
      text: "Forward estimates: not available on the current data plan — reason from the filed trajectory, not from a consensus number you did not see.",
    });
    if (ratios) {
      const parts: string[] = [];
      if (ratios.pe != null) parts.push(`P/E ${ratios.pe.toFixed(1)}`);
      if (ratios.debtToEquity != null) parts.push(`D/E ${ratios.debtToEquity.toFixed(2)}`);
      if (ratios.roe != null) parts.push(`ROE ${(ratios.roe * 100).toFixed(1)}%`);
      if (parts.length > 0) {
        items.push({ kind: "generic", text: `Latest ratios — ${parts.join(" · ")}` });
      }
    }
    if (errors.length > 0) {
      items.push({
        kind: "generic",
        text: `Partial data — ${errors.length} source(s) unavailable: ${errors.join("; ")}`,
      });
    }

    return {
      summary:
        annual.length > 0
          ? `$${T} financials — ${annual.length} filed annual periods; forward estimates not on plan.`
          : `$${T} financials — no filed data (${errors.join("; ") || "empty"}).`,
      data: {
        ticker: T,
        annual,
        forwardEstimates,
        ratios,
        errors,
        items,
      },
      sources: [
        {
          provider: "Finnhub",
          title: `${T} Financials as Reported (SEC)`,
          url: "https://finnhub.io/docs/api/financials-reported",
        },
        ...(ratios
          ? [{ provider: "Finnhub", title: `${T} Basic Financials`, url: "https://finnhub.io/docs/api/company-basic-financials" }]
          : []),
      ],
    };
  },
});
