/**
 * The stock page's numbers, in the order and words they are shown. The
 * Overview's key stats are nine cells read down three columns, like a
 * broker's quote page; the Financials tab's full set is one table in
 * sections. Everything here is a pure read of the quote and Finnhub's
 * `/stock/metric` map, so the page cannot print a number this file doesn't
 * name, and a metric Finnhub lacks for a stock reads "—" (or drops out of
 * the Financials table) instead of a guessed value.
 */

export type Stat = { label: string; value: string };
export type StatColumns = Stat[][];
export type StatSection = { label: string; columns: StatColumns };

type Metrics = Record<string, number | string> | null | undefined;
type Quote = { o: number; h: number; l: number } | null | undefined;

const NONE = "—";

function num(m: Metrics, key: string): number | null {
  const v = m?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export const fmtNum = (n: number | null, digits = 2) => (n != null ? n.toFixed(digits) : NONE);
export const fmtMoney = (n: number | null) =>
  n != null
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n)
    : NONE;
export const fmtPct = (n: number | null, digits = 1) => (n != null ? `${n.toFixed(digits)}%` : NONE);
/** "+9.7%" / "−5.3%": a return or a growth rate, with its sign. */
export const fmtSignedPct = (n: number | null, digits = 1) =>
  n != null ? `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%` : NONE;
/** "$4.93T", "$28.41B", "$120.03M" from dollars. */
export const fmtBig = (n: number | null, prefix = "$") => {
  if (n == null) return NONE;
  if (n >= 1e12) return `${prefix}${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${prefix}${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${prefix}${(n / 1e6).toFixed(2)}M`;
  return `${prefix}${n.toFixed(0)}`;
};
/** Finnhub's volumes and values come in millions. */
const millions = (n: number | null) => (n != null ? n * 1_000_000 : null);

/**
 * The Overview's nine: the session's prices, what the company is worth and
 * earns, and where the price has been. `marketCap` is in dollars (the
 * page already picks the profile's over the metric's).
 */
export function keyStatColumns(quote: Quote, metrics: Metrics, marketCap: number | null): StatColumns {
  const m = metrics;
  return [
    [
      { label: "Open", value: fmtMoney(quote?.o ?? null) },
      { label: "High", value: fmtMoney(quote?.h ?? null) },
      { label: "Low", value: fmtMoney(quote?.l ?? null) },
    ],
    [
      { label: "Market cap", value: fmtBig(marketCap) },
      { label: "P/E", value: fmtNum(num(m, "peTTM")) },
      { label: "EPS", value: fmtMoney(num(m, "epsTTM")) },
    ],
    [
      { label: "52-wk high", value: fmtMoney(num(m, "52WeekHigh")) },
      { label: "52-wk low", value: fmtMoney(num(m, "52WeekLow")) },
      { label: "Avg volume", value: fmtBig(millions(num(m, "3MonthAverageTradingVolume")), "") },
    ],
  ];
}

/** Lays stats down `n` columns, top to bottom then left to right. */
function inColumns(stats: Stat[], n = 3): StatColumns {
  const per = Math.ceil(stats.length / n);
  const cols: StatColumns = [];
  for (let i = 0; i < stats.length; i += per) cols.push(stats.slice(i, i + per));
  return cols;
}

/**
 * The Financials tab's full set, by section. A stat Finnhub has no number for
 * is left out, and a section with nothing left is left out too.
 */
export function financialStatSections(metrics: Metrics, marketCap: number | null): StatSection[] {
  const m = metrics;
  const sections: Array<{ label: string; stats: Array<[string, string]> }> = [
    {
      label: "Valuation",
      stats: [
        ["Market cap", fmtBig(marketCap)],
        ["Enterprise value", fmtBig(millions(num(m, "enterpriseValue")))],
        ["P/E (TTM)", fmtNum(num(m, "peTTM"))],
        ["Forward P/E", fmtNum(num(m, "forwardPE"))],
        ["PEG", fmtNum(num(m, "pegTTM"))],
        ["P/S", fmtNum(num(m, "psTTM"))],
        ["P/B", fmtNum(num(m, "pb"))],
        ["EV / EBITDA", fmtNum(num(m, "evEbitdaTTM"))],
        ["EV / revenue", fmtNum(num(m, "evRevenueTTM"))],
      ],
    },
    {
      label: "Growth",
      stats: [
        // Read down the columns, each column is one horizon: revenue over EPS.
        ["Revenue, TTM vs year ago", fmtSignedPct(num(m, "revenueGrowthTTMYoy"))],
        ["EPS, TTM vs year ago", fmtSignedPct(num(m, "epsGrowthTTMYoy"))],
        ["Revenue, 3-year", fmtSignedPct(num(m, "revenueGrowth3Y"))],
        ["EPS, 3-year", fmtSignedPct(num(m, "epsGrowth3Y"))],
        ["Revenue, 5-year", fmtSignedPct(num(m, "revenueGrowth5Y"))],
        ["EPS, 5-year", fmtSignedPct(num(m, "epsGrowth5Y"))],
      ],
    },
    {
      label: "Profitability",
      stats: [
        ["Gross margin", fmtPct(num(m, "grossMarginTTM"))],
        ["Operating margin", fmtPct(num(m, "operatingMarginTTM"))],
        ["Net margin", fmtPct(num(m, "netProfitMarginTTM"))],
        ["Return on equity", fmtPct(num(m, "roeTTM"))],
        ["Return on assets", fmtPct(num(m, "roaTTM"))],
        ["Return on investment", fmtPct(num(m, "roiTTM"))],
      ],
    },
    {
      label: "Balance sheet",
      stats: [
        ["Current ratio", fmtNum(num(m, "currentRatioQuarterly"))],
        ["Quick ratio", fmtNum(num(m, "quickRatioQuarterly"))],
        ["Debt / equity", fmtNum(num(m, "totalDebt/totalEquityQuarterly"))],
        ["Long-term debt / equity", fmtNum(num(m, "longTermDebt/equityQuarterly"))],
        ["Interest coverage", fmtNum(num(m, "netInterestCoverageTTM"), 1)],
        ["Book value / share", fmtMoney(num(m, "bookValuePerShareQuarterly"))],
      ],
    },
    {
      label: "Per share",
      stats: [
        ["EPS (TTM)", fmtMoney(num(m, "epsTTM"))],
        ["Revenue / share", fmtMoney(num(m, "revenuePerShareTTM"))],
        ["Cash / share", fmtMoney(num(m, "cashPerSharePerShareQuarterly"))],
        ["Dividend / share", fmtMoney(num(m, "dividendPerShareTTM"))],
        ["Dividend yield", fmtPct(num(m, "dividendYieldIndicatedAnnual"), 2)],
        ["Payout ratio", fmtPct(num(m, "payoutRatioTTM"))],
      ],
    },
    {
      label: "Price",
      stats: [
        ["5 days", fmtSignedPct(num(m, "5DayPriceReturnDaily"))],
        ["13 weeks", fmtSignedPct(num(m, "13WeekPriceReturnDaily"))],
        ["26 weeks", fmtSignedPct(num(m, "26WeekPriceReturnDaily"))],
        ["52 weeks", fmtSignedPct(num(m, "52WeekPriceReturnDaily"))],
        ["Year to date", fmtSignedPct(num(m, "yearToDatePriceReturnDaily"))],
        ["vs S&P 500, 52 weeks", fmtSignedPct(num(m, "priceRelativeToS&P50052Week"))],
      ],
    },
  ];
  return sections
    .map((s) => ({
      label: s.label,
      columns: inColumns(s.stats.filter(([, v]) => v !== NONE).map(([label, value]) => ({ label, value }))),
    }))
    .filter((s) => s.columns.length > 0);
}
