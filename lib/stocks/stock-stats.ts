/**
 * The stock page's numbers, in the order and words they are shown (the
 * owner's layouts, 2026-11-05, after Robinhood's). The Overview shows two
 * range bars (today, 52 weeks); the Fundamentals tab opens with six key
 * stats down one column beside the company's facts, then the rest in tabs
 * (see `fundamentals`). Everything here is a pure read of the
 * quote, the profile and Finnhub's `/stock/metric` map, so the page cannot
 * print a number this file doesn't name, and a metric Finnhub lacks for a
 * stock reads "—" on the Overview and drops out of the Fundamentals.
 */

export type Stat = { label: string; value: string };
export type StatColumns = Stat[][];
/** A stat drawn as a bar too: `n` is the number the bar's length comes from. */
export type BarStat = Stat & { n: number };

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

/** Where the price sits today and over the year: the two bars on the Overview. */
export function rangeBars(
  quote: { h: number; l: number; c: number } | null | undefined,
  metrics: Metrics,
): Array<{ label: string; low: number | null; high: number | null; current: number | null }> {
  const current = quote?.c ?? null;
  return [
    { label: "Today", low: quote?.l ?? null, high: quote?.h ?? null, current },
    { label: "52 week", low: num(metrics, "52WeekLow"), high: num(metrics, "52WeekHigh"), current },
  ];
}

/** The six key stats at the top of Fundamentals, one row each: what the company is worth and earns; how it trades. */
export function keyStats(metrics: Metrics, marketCap: number | null): Stat[] {
  const m = metrics;
  return [
    { label: "Market cap", value: fmtBig(marketCap) },
    { label: "P/E", value: fmtNum(num(m, "peTTM")) },
    { label: "EPS", value: fmtMoney(num(m, "epsTTM")) },
    { label: "Volume, 10-day avg", value: fmtBig(millions(num(m, "10DayAverageTradingVolume")), "") },
    { label: "Volume, 3-month avg", value: fmtBig(millions(num(m, "3MonthAverageTradingVolume")), "") },
    { label: "Beta", value: fmtNum(num(m, "beta")) },
  ];
}

/** The company's facts, beside the valuation on the Fundamentals tab. The website is a chip on the Overview, not a row here. */
export function companyFactRows(
  profile: { finnhubIndustry?: string; country?: string; ipo?: string; shareOutstanding?: number } | null | undefined,
  exchange: string | null,
  nextReportDate: string | null,
): Stat[] {
  return [
    { label: "Industry", value: profile?.finnhubIndustry || NONE },
    { label: "Exchange", value: exchange || NONE },
    { label: "Country", value: profile?.country || NONE },
    { label: "IPO", value: profile?.ipo || NONE },
    { label: "Shares outstanding", value: fmtBig(millions(profile?.shareOutstanding ?? null), "") },
    { label: "Next earnings", value: nextReportDate ? fmtDay(nextReportDate) : NONE },
  ];
}

/** "Feb 11" from "2026-02-11", read as a calendar day, not a UTC instant. */
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** The stats that have a number, with their words; a missing one is left out, never guessed. */
function rows(stats: Array<[string, number | null, (n: number | null) => string]>): Stat[] {
  return stats.filter(([, n]) => n != null).map(([label, n, fmt]) => ({ label, value: fmt(n) }));
}
function barRows(stats: Array<[string, number | null, (n: number | null) => string]>): BarStat[] {
  return stats.filter((s): s is [string, number, (n: number | null) => string] => s[1] != null).map(([label, n, fmt]) => ({ label, value: fmt(n), n }));
}

/**
 * The rest of the Fundamentals tab, under the key stats: four tabs of plain
 * rows the full width of the page (the owner, 2026-11-05) — Valuation;
 * Growth & returns (the business's growth, then the stock's price returns);
 * Profitability; Balance sheet & per share. The groups are ours: Finnhub's
 * metric map is one flat list of keys. Only the three margins carry a bar
 * (a share of revenue on a 0–100 scale). A stat Finnhub has no number for
 * is left out, and an empty tab is not drawn.
 */
export type Fundamentals = {
  valuation: Stat[];
  growth: Stat[];
  priceReturns: Stat[];
  margins: BarStat[];
  returns: Stat[];
  balanceSheet: Stat[];
  perShare: Stat[];
};

export function fundamentals(metrics: Metrics, marketCap: number | null): Fundamentals {
  const m = metrics;
  const money = (n: number | null) => fmtMoney(n);
  const ratio = (n: number | null) => fmtNum(n);
  const pct = (n: number | null) => fmtPct(n);
  const signed = (n: number | null) => fmtSignedPct(n);
  return {
    valuation: rows([
        ["Market cap", marketCap, (n) => fmtBig(n)],
        ["Enterprise value", millions(num(m, "enterpriseValue")), (n) => fmtBig(n)],
        ["P/E (TTM)", num(m, "peTTM"), ratio],
        ["Forward P/E", num(m, "forwardPE"), ratio],
        ["PEG", num(m, "pegTTM"), ratio],
        ["P/S", num(m, "psTTM"), ratio],
        ["P/B", num(m, "pb"), ratio],
        ["EV / EBITDA", num(m, "evEbitdaTTM"), ratio],
        ["EV / revenue", num(m, "evRevenueTTM"), ratio],
    ]),
    growth: rows([
      ["Revenue, TTM", num(m, "revenueGrowthTTMYoy"), signed],
      ["Revenue, 3-year", num(m, "revenueGrowth3Y"), signed],
      ["Revenue, 5-year", num(m, "revenueGrowth5Y"), signed],
      ["EPS, TTM", num(m, "epsGrowthTTMYoy"), signed],
      ["EPS, 3-year", num(m, "epsGrowth3Y"), signed],
      ["EPS, 5-year", num(m, "epsGrowth5Y"), signed],
    ]),
    priceReturns: rows([
      ["5 days", num(m, "5DayPriceReturnDaily"), signed],
      ["13 weeks", num(m, "13WeekPriceReturnDaily"), signed],
      ["26 weeks", num(m, "26WeekPriceReturnDaily"), signed],
      ["52 weeks", num(m, "52WeekPriceReturnDaily"), signed],
      ["Year to date", num(m, "yearToDatePriceReturnDaily"), signed],
      ["vs S&P 500, 52 weeks", num(m, "priceRelativeToS&P50052Week"), signed],
    ]),
    margins: barRows([
      ["Gross margin", num(m, "grossMarginTTM"), pct],
      ["Operating margin", num(m, "operatingMarginTTM"), pct],
      ["Net margin", num(m, "netProfitMarginTTM"), pct],
    ]),
    returns: rows([
      ["ROE", num(m, "roeTTM"), pct],
      ["ROA", num(m, "roaTTM"), pct],
      ["ROI", num(m, "roiTTM"), pct],
    ]),
    balanceSheet: rows([
      ["Current ratio", num(m, "currentRatioQuarterly"), ratio],
      ["Quick ratio", num(m, "quickRatioQuarterly"), ratio],
      ["Debt / equity", num(m, "totalDebt/totalEquityQuarterly"), ratio],
      ["Long-term debt / equity", num(m, "longTermDebt/equityQuarterly"), ratio],
      ["Interest coverage", num(m, "netInterestCoverageTTM"), (n) => fmtNum(n, 1)],
    ]),
    perShare: rows([
      ["EPS (TTM)", num(m, "epsTTM"), money],
      ["Revenue / share", num(m, "revenuePerShareTTM"), money],
      ["Cash / share", num(m, "cashPerSharePerShareQuarterly"), money],
      ["Book value / share", num(m, "bookValuePerShareQuarterly"), money],
      ["Dividend / share", num(m, "dividendPerShareTTM"), money],
      ["Dividend yield", num(m, "dividendYieldIndicatedAnnual"), (n) => fmtPct(n, 2)],
      ["Payout ratio", num(m, "payoutRatioTTM"), pct],
    ]),
  };
}
