/**
 * Filed financial statements from Finnhub — `/stock/financials-reported`,
 * the SEC XBRL numbers exactly as the company filed them.
 *
 * Why this exists (2026-09-08): the FMP tier we hold refuses 26 of the 28
 * names on the book ("this value set for 'symbol' is not available under
 * your current subscription"), so the writer's income statement, cash flow
 * and key-metrics pulls came back empty for almost every thesis while the
 * run reported "all sources ok". DAV-191 (August) already ruled Finnhub the
 * vendor; this finishes that move. This endpoint is on the Finnhub plan we
 * hold (verified 2026-09-08 on SMMT, ETN, ABT).
 *
 * Concept names vary by filer (Revenues vs RevenueFromContractWith
 * CustomerExcludingAssessedTax, CostOfRevenue vs CostOfGoodsAndServicesSold
 * …), so every field is read through an ordered candidate list — the first
 * concept present wins. A field with no matching concept is null, never 0.
 */

import { finnhub } from "@/lib/agent/research-helpers";

export interface ReportedPeriod {
  /** Period end, YYYY-MM-DD. */
  period: string;
  /** Period start, YYYY-MM-DD, when the filing carries it. */
  periodStart: string | null;
  year: number;
  /** 1–4 for a 10-Q; null for a fiscal-year 10-K. */
  quarter: number | null;
  form: string;
  revenue: number | null;
  costOfRevenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  dilutedEps: number | null;
  depreciation: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  freeCashFlow: number | null;
  cash: number | null;
  totalAssets: number | null;
  equity: number | null;
}

interface ReportItem {
  concept?: string;
  label?: string;
  value?: number | string | null;
}

interface FinnhubReport {
  year?: number;
  quarter?: number;
  form?: string;
  startDate?: string;
  endDate?: string;
  filedDate?: string;
  report?: { bs?: ReportItem[]; ic?: ReportItem[]; cf?: ReportItem[] };
}

// Ordered candidate concepts per field. Bare names — the `us-gaap_` prefix
// (and any other taxonomy prefix) is stripped before matching.
const CONCEPTS = {
  revenue: [
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "RevenuesNetOfInterestExpense",
    "TotalRevenuesAndOtherIncome",
  ],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  dilutedEps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
  depreciation: ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "Depreciation"],
  operatingCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  totalAssets: ["Assets"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
} as const;

function bareConcept(c: string | undefined): string {
  if (!c) return "";
  const i = c.indexOf("_");
  return i >= 0 ? c.slice(i + 1) : c;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** First candidate concept present in `items`, as a number; null if none. */
export function pickConcept(items: ReportItem[] | undefined, candidates: readonly string[]): number | null {
  if (!items || items.length === 0) return null;
  for (const want of candidates) {
    const hit = items.find((it) => bareConcept(it.concept) === want);
    if (hit) {
      const n = toNumber(hit.value);
      if (n != null) return n;
    }
  }
  return null;
}

/** One filed report → the flat period row the tools consume. */
export function normalizeReport(r: FinnhubReport): ReportedPeriod | null {
  const period = (r.endDate ?? "").slice(0, 10);
  if (!period || r.year == null) return null;
  const ic = r.report?.ic;
  const cf = r.report?.cf;
  const bs = r.report?.bs;
  const revenue = pickConcept(ic, CONCEPTS.revenue);
  const costOfRevenue = pickConcept(ic, CONCEPTS.costOfRevenue);
  const grossProfitFiled = pickConcept(ic, CONCEPTS.grossProfit);
  const grossProfit =
    grossProfitFiled ?? (revenue != null && costOfRevenue != null ? revenue - costOfRevenue : null);
  const operatingCashFlow = pickConcept(cf, CONCEPTS.operatingCashFlow);
  // Capex is filed as a positive "payments" figure; FCF = OCF − capex.
  const capexRaw = pickConcept(cf, CONCEPTS.capex);
  const capex = capexRaw != null ? Math.abs(capexRaw) : null;
  const form = r.form ?? "";
  return {
    period,
    periodStart: (r.startDate ?? "").slice(0, 10) || null,
    year: r.year,
    quarter: form.startsWith("10-K") ? null : (r.quarter ?? null),
    form,
    revenue,
    costOfRevenue,
    grossProfit,
    operatingIncome: pickConcept(ic, CONCEPTS.operatingIncome),
    netIncome: pickConcept(ic, CONCEPTS.netIncome) ?? pickConcept(cf, CONCEPTS.netIncome),
    dilutedEps: pickConcept(ic, CONCEPTS.dilutedEps),
    depreciation: pickConcept(cf, CONCEPTS.depreciation),
    operatingCashFlow,
    capex,
    freeCashFlow: operatingCashFlow != null && capex != null ? operatingCashFlow - capex : null,
    cash: pickConcept(bs, CONCEPTS.cash),
    totalAssets: pickConcept(bs, CONCEPTS.totalAssets),
    equity: pickConcept(bs, CONCEPTS.equity),
  };
}

/**
 * The last `limit` filed periods for a symbol, oldest → newest. Amended
 * filings (10-K/A, 10-Q/A) for the same period end replace the original.
 */
export async function getReportedFinancials(
  symbol: string,
  freq: "annual" | "quarterly",
  limit: number,
): Promise<{ periods: ReportedPeriod[]; error?: string }> {
  const T = symbol.toUpperCase();
  const res = await finnhub(`/stock/financials-reported?symbol=${T}&freq=${freq}`, 2);
  if (res.error) return { periods: [], error: res.error };
  const raw = (res.data as { data?: FinnhubReport[] } | null)?.data;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { periods: [], error: `financials-reported: no ${freq} filings returned` };
  }
  // Newest filing first so an amendment wins the period-end slot.
  const sorted = raw
    .slice()
    .sort((a, b) => (b.filedDate ?? "").localeCompare(a.filedDate ?? ""));
  const byPeriod = new Map<string, ReportedPeriod>();
  for (const r of sorted) {
    const row = normalizeReport(r);
    if (!row) continue;
    if (!byPeriod.has(row.period)) byPeriod.set(row.period, row);
  }
  const periods = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
  return { periods: (freq === "quarterly" ? deCumulate(periods) : periods).slice(-limit) };
}

const FLOW_FIELDS = [
  "revenue",
  "costOfRevenue",
  "grossProfit",
  "operatingIncome",
  "netIncome",
  "dilutedEps",
  "depreciation",
  "operatingCashFlow",
  "capex",
  "freeCashFlow",
] as const;

function spanDays(p: ReportedPeriod): number | null {
  if (!p.periodStart) return null;
  return Math.round((Date.parse(p.period) - Date.parse(p.periodStart)) / 86_400_000);
}

/**
 * Many 10-Qs carry YEAR-TO-DATE figures (ETN's Q2 "revenue" is six months,
 * Q3 is nine). Finnhub passes them through as filed. A flow that spans more
 * than ~100 days is cumulative: subtract the prior filing's cumulative
 * figure for the same fiscal year to get the quarter. Balance-sheet fields
 * are point-in-time and untouched. Exported for tests.
 */
export function deCumulate(periods: ReportedPeriod[]): ReportedPeriod[] {
  const ytd = new Map<string, ReportedPeriod>(periods.map((p) => [p.period, { ...p }]));
  return periods.map((p, i) => {
    const span = spanDays(p);
    if (span == null || span <= 100) return p;
    // Prior filing in the same fiscal year, as filed (cumulative).
    let prev: ReportedPeriod | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (periods[j].year === p.year && periods[j].period < p.period) {
        prev = ytd.get(periods[j].period) ?? null;
        break;
      }
    }
    if (!prev) return p;
    const out: ReportedPeriod = { ...p };
    for (const f of FLOW_FIELDS) {
      const cur = p[f];
      const before = prev[f];
      out[f] = cur != null && before != null ? cur - before : cur;
    }
    return out;
  });
}
