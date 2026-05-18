/**
 * get_financials_deep — 5-year FMP income statement + cash flow + ratios + forward estimates.
 *
 * Provides the multi-year financial trajectory the thesis-writer needs:
 * revenue growth curve, margin trend, EBITDA, FCF, EPS, plus 2-year forward
 * analyst estimates. The companion to `get_stock_data` (which is point-in-time);
 * this is the time-series view.
 *
 * Falls back gracefully on per-endpoint 403s — some FMP tiers gate
 * /analyst-estimates and /key-metrics. Returns partial data with an
 * `errors[]` array describing what couldn't be fetched.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";

const FMP_KEY = process.env.FMP_API_KEY!;

interface FmpResult<T> {
  data: T | null;
  error?: string;
}

async function fmp<T>(path: string): Promise<FmpResult<T>> {
  const base = path.startsWith("/v4/")
    ? `https://financialmodelingprep.com/api${path}`
    : `https://financialmodelingprep.com/api/v3${path}`;
  const url = `${base}${path.includes("?") ? "&" : "?"}apikey=${FMP_KEY}`;
  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { data: null, error: `FMP ${res.status} on ${path.split("?")[0]}` };
    const data = (await res.json()) as T;
    return { data };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : "fmp error" };
  }
}

interface IncomeStatementRow {
  date: string;
  calendarYear?: string;
  revenue?: number;
  grossProfit?: number;
  ebitda?: number;
  netIncome?: number;
  eps?: number;
  epsdiluted?: number;
}

interface CashFlowRow {
  date: string;
  operatingCashFlow?: number;
  capitalExpenditure?: number;
  freeCashFlow?: number;
}

interface KeyMetricsRow {
  date: string;
  peRatio?: number;
  pegRatio?: number;
  debtToEquity?: number;
  currentRatio?: number;
  returnOnAssets?: number;
  returnOnEquity?: number;
  roic?: number;
}

interface AnalystEstimateRow {
  date: string;
  estimatedRevenueAvg?: number;
  estimatedEpsAvg?: number;
}

export const getFinancialsDeep = defineTool({
  description:
    "Get 5-year annual income statement, cash flow, key ratios, and 2-year forward analyst " +
    "estimates for a stock. Use for the time-series fundamentals view that backs the thesis " +
    "'Fundamentals' section — revenue trajectory, margin trend, FCF, EBITDA, EPS, plus what " +
    "analysts expect for the next 2 years. Gracefully degrades when FMP tier-gates specific " +
    "endpoints (returns partial data + errors[] noting what's missing).",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.ticker.toUpperCase()}'s 5-year financials`,

  execute: async ({ ticker }) => {
    const T = ticker.toUpperCase();
    const [incomeRes, cashRes, metricsRes, estimatesRes] = await Promise.all([
      fmp<IncomeStatementRow[]>(`/income-statement/${T}?limit=5&period=annual`),
      fmp<CashFlowRow[]>(`/cash-flow-statement/${T}?limit=5&period=annual`),
      fmp<KeyMetricsRow[]>(`/key-metrics/${T}?limit=5&period=annual`),
      fmp<AnalystEstimateRow[]>(`/analyst-estimates/${T}?period=annual&limit=2`),
    ]);

    const errors: string[] = [];
    if (incomeRes.error) errors.push(`income-statement: ${incomeRes.error}`);
    if (cashRes.error) errors.push(`cash-flow: ${cashRes.error}`);
    if (metricsRes.error) errors.push(`key-metrics: ${metricsRes.error}`);
    if (estimatesRes.error) errors.push(`analyst-estimates: ${estimatesRes.error}`);

    const incomeRows = (incomeRes.data ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const cashRows = (cashRes.data ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const metricsRows = (metricsRes.data ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const estimateRows = (estimatesRes.data ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));

    const cashByDate = new Map(cashRows.map((r) => [r.date, r]));

    // Build annual series with YoY growth + margins.
    const annual = incomeRows.map((row, i) => {
      const prev = i > 0 ? incomeRows[i - 1] : null;
      const revenueGrowth =
        prev?.revenue && row.revenue
          ? ((row.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100
          : null;
      const epsGrowth =
        prev?.epsdiluted != null && row.epsdiluted != null && prev.epsdiluted !== 0
          ? ((row.epsdiluted - prev.epsdiluted) / Math.abs(prev.epsdiluted)) * 100
          : null;
      const grossMargin =
        row.revenue && row.grossProfit ? (row.grossProfit / row.revenue) * 100 : null;
      const ebitdaMargin =
        row.revenue && row.ebitda != null ? (row.ebitda / row.revenue) * 100 : null;
      const netMargin =
        row.revenue && row.netIncome != null ? (row.netIncome / row.revenue) * 100 : null;
      const cash = cashByDate.get(row.date);

      return {
        period: row.date,
        year: row.calendarYear ?? row.date.slice(0, 4),
        revenue: row.revenue ?? null,
        revenueGrowthPct: revenueGrowth,
        grossProfit: row.grossProfit ?? null,
        grossMarginPct: grossMargin,
        ebitda: row.ebitda ?? null,
        ebitdaMarginPct: ebitdaMargin,
        netIncome: row.netIncome ?? null,
        netMarginPct: netMargin,
        dilutedEps: row.epsdiluted ?? row.eps ?? null,
        epsGrowthPct: epsGrowth,
        operatingCashFlow: cash?.operatingCashFlow ?? null,
        capex: cash?.capitalExpenditure ?? null,
        freeCashFlow: cash?.freeCashFlow ?? null,
      };
    });

    const forwardEstimates = estimateRows.map((row, i) => {
      // `prev` can be either the last actual income-statement row (when computing
      // the first forward year's growth) or the prior forward estimate (when
      // computing year N+1's growth). Unify via duck-typing — extract revenue
      // and EPS via field-presence checks so TypeScript doesn't choke on the
      // union.
      const prev:
        | IncomeStatementRow
        | AnalystEstimateRow
        | null =
        i === 0 && incomeRows.length > 0
          ? incomeRows[incomeRows.length - 1]
          : i > 0
            ? estimateRows[i - 1]
            : null;

      const prevRev: number | null = prev
        ? ("revenue" in prev && prev.revenue != null
            ? prev.revenue
            : "estimatedRevenueAvg" in prev && prev.estimatedRevenueAvg != null
              ? prev.estimatedRevenueAvg
              : null)
        : null;
      const prevEps: number | null = prev
        ? ("epsdiluted" in prev && prev.epsdiluted != null
            ? prev.epsdiluted
            : "eps" in prev && prev.eps != null
              ? prev.eps
              : "estimatedEpsAvg" in prev && prev.estimatedEpsAvg != null
                ? prev.estimatedEpsAvg
                : null)
        : null;

      const revenueGrowth =
        prevRev && row.estimatedRevenueAvg
          ? ((row.estimatedRevenueAvg - prevRev) / Math.abs(prevRev)) * 100
          : null;
      const epsGrowth =
        prevEps != null && row.estimatedEpsAvg != null && prevEps !== 0
          ? ((row.estimatedEpsAvg - prevEps) / Math.abs(prevEps)) * 100
          : null;

      return {
        period: row.date,
        year: row.date.slice(0, 4),
        revenue: row.estimatedRevenueAvg ?? null,
        revenueGrowthPct: revenueGrowth,
        eps: row.estimatedEpsAvg ?? null,
        epsGrowthPct: epsGrowth,
      };
    });

    const latestMetrics = metricsRows[metricsRows.length - 1] ?? null;
    const ratios = latestMetrics
      ? {
          pe: latestMetrics.peRatio ?? null,
          pegRatio: latestMetrics.pegRatio ?? null,
          debtToEquity: latestMetrics.debtToEquity ?? null,
          currentRatio: latestMetrics.currentRatio ?? null,
          roa: latestMetrics.returnOnAssets ?? null,
          roe: latestMetrics.returnOnEquity ?? null,
          roic: latestMetrics.roic ?? null,
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
        tag: `${annual.length}-yr fundamentals`,
        text: revLine ?? `${annual.length} annual periods returned`,
      });
    } else {
      items.push({
        kind: "ticker",
        ticker: T,
        tag: "no data",
        text: "FMP returned no annual income statement rows.",
      });
    }
    if (forwardEstimates.length > 0) {
      const last = forwardEstimates[forwardEstimates.length - 1];
      const revText =
        last.revenue != null ? ` rev $${(last.revenue / 1e9).toFixed(1)}B` : "";
      const epsText = last.eps != null ? ` EPS $${last.eps.toFixed(2)}` : "";
      items.push({
        kind: "generic",
        text: `Forward estimates through ${last.year}:${revText}${epsText}`.trim(),
      });
    }
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
        text: `Partial data — ${errors.length} endpoint(s) unavailable: ${errors.join("; ")}`,
      });
    }

    return {
      summary:
        annual.length > 0
          ? `$${T} financials — ${annual.length} annual periods + ${forwardEstimates.length} forward estimates.`
          : `$${T} financials — no FMP data (${errors.join("; ") || "empty"}).`,
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
          provider: "FMP",
          title: `${T} 5-Year Financials`,
          url: `https://financialmodelingprep.com/financial-statements/${T}`,
        },
      ],
    };
  },
});
