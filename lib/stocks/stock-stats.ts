/**
 * The stock page's numbers, in the order and words they are shown (the
 * owner's layouts, 2026-11-05, after Robinhood's). The Overview shows two
 * range bars (today, 52 weeks) and six stats in two columns; the
 * Fundamentals tab opens with the key figures in two columns beside the
 * company's facts, then the full set as one table in sections. Everything
 * here is a pure read of the quote, the profile and Finnhub's
 * `/stock/metric` map, so the page cannot print a number this file doesn't
 * name, and a metric Finnhub lacks for a stock reads "—" (or drops out of
 * the table) instead of a guessed value.
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

/** The Overview's six, in two columns: what the company is worth and earns; how it trades. */
export function overviewStatColumns(metrics: Metrics, marketCap: number | null): StatColumns {
  const m = metrics;
  return [
    [
      { label: "Market cap", value: fmtBig(marketCap) },
      { label: "P/E", value: fmtNum(num(m, "peTTM")) },
      { label: "EPS", value: fmtMoney(num(m, "epsTTM")) },
    ],
    [
      { label: "Volume, 10-day avg", value: fmtBig(millions(num(m, "10DayAverageTradingVolume")), "") },
      { label: "Volume, 3-month avg", value: fmtBig(millions(num(m, "3MonthAverageTradingVolume")), "") },
      { label: "Beta", value: fmtNum(num(m, "beta")) },
    ],
  ];
}

/** The Fundamentals tab's key figures, in two columns: the valuation, then the business. */
export function keyFigureColumns(metrics: Metrics, marketCap: number | null): StatColumns {
  const m = metrics;
  return [
    [
      { label: "Market cap", value: fmtBig(marketCap) },
      { label: "Enterprise value", value: fmtBig(millions(num(m, "enterpriseValue"))) },
      { label: "P/E (TTM)", value: fmtNum(num(m, "peTTM")) },
      { label: "Forward P/E", value: fmtNum(num(m, "forwardPE")) },
      { label: "EPS (TTM)", value: fmtMoney(num(m, "epsTTM")) },
    ],
    [
      { label: "Revenue growth, TTM", value: fmtSignedPct(num(m, "revenueGrowthTTMYoy")) },
      { label: "Gross margin", value: fmtPct(num(m, "grossMarginTTM")) },
      { label: "Net margin", value: fmtPct(num(m, "netProfitMarginTTM")) },
      { label: "Dividend yield", value: fmtPct(num(m, "dividendYieldIndicatedAnnual"), 2) },
      { label: "Beta", value: fmtNum(num(m, "beta")) },
    ],
  ];
}

/** The company's facts, for the Fundamentals tab's right column. The website is a link; the page draws it. */
export function companyFactRows(
  profile: { finnhubIndustry?: string; country?: string; ipo?: string; shareOutstanding?: number; weburl?: string } | null | undefined,
  exchange: string | null,
  nextReportDate: string | null,
): Array<{ label: string; value: string; href?: string }> {
  const rows: Array<{ label: string; value: string; href?: string }> = [
    { label: "Industry", value: profile?.finnhubIndustry || NONE },
    { label: "Exchange", value: exchange || NONE },
    { label: "Country", value: profile?.country || NONE },
    { label: "IPO", value: profile?.ipo || NONE },
    { label: "Shares outstanding", value: fmtBig(millions(profile?.shareOutstanding ?? null), "") },
    { label: "Next earnings", value: nextReportDate ? fmtDay(nextReportDate) : NONE },
  ];
  if (profile?.weburl) {
    rows.push({ label: "Website", value: profile.weburl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), href: profile.weburl });
  }
  return rows;
}

/** "Feb 11" from "2026-02-11", read as a calendar day, not a UTC instant. */
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Lays stats down `n` columns, top to bottom then left to right. */
function inColumns(stats: Stat[], n = 3): StatColumns {
  const per = Math.ceil(stats.length / n);
  const cols: StatColumns = [];
  for (let i = 0; i < stats.length; i += per) cols.push(stats.slice(i, i + per));
  return cols;
}

/**
 * The Fundamentals tab's full set, by section. A stat Finnhub has no number for
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
