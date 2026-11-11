/**
 * market-numbers.ts — the market's numbers, read by code. The one copy: the
 * Market and portfolio block prints them (lib/agent/market-and-portfolio.ts),
 * and the 7:30 market run reads the same loader for its inputs.
 *
 * - SPY and QQQ: the latest session's move, from the live-quote batch
 *   get_market_context uses (one Alpaca call with the sector funds). Outside
 *   the session that is the last close, so the line names the session's day.
 * - SPY against its 50- and 200-day averages, at the last close in the daily
 *   indicator snapshot (the same numbers the market regime reads).
 * - The VIX and the 10-year yield at the last close, from Cboe's daily files
 *   (lib/market-data/market-gauges.ts).
 * - The 11 sector funds, best to worst.
 * - The market dates in the next 7 days (lib/market-data/market-calendar.ts).
 * Each piece that can't be read is left out. This file builds and words the
 * numbers and reads nothing; the reading is load-market-numbers.ts.
 */
import type { Gauges, IndexClose } from "@/lib/market-data/market-gauges";
import { calendarGaps, dayLabel, etToday, scheduledMarketDates, type MarketDate } from "@/lib/market-data/market-calendar";

/** The 11 sector funds and what each holds. */
export const SECTOR_FUNDS: ReadonlyArray<readonly [ticker: string, name: string]> = [
  ["XLK", "Tech"], ["XLF", "Financials"], ["XLV", "Health care"], ["XLY", "Consumer discretionary"], ["XLP", "Consumer staples"],
  ["XLE", "Energy"], ["XLI", "Industrials"], ["XLB", "Materials"], ["XLRE", "Real estate"], ["XLU", "Utilities"], ["XLC", "Communication"],
];

/** How many days ahead the market dates reach. */
export const MARKET_DATES_DAYS = 7;

export interface MarketNumbers {
  /** The New York day of the session the moves are from. */
  session: string | null;
  spyPct: number | null;
  qqqPct: number | null;
  /** SPY's close against its averages, in %, at `asOf`'s close. */
  spyAverages: { vs50: number; vs200: number; asOf: string } | null;
  vix: IndexClose | null;
  tenYear: IndexClose | null;
  /** Best to worst. */
  sectors: Array<{ ticker: string; name: string; pct: number }>;
  dates: MarketDate[];
  /** A date list that runs out inside the window, in words: a blank calendar must not read as a quiet one. */
  calendarGaps: string[];
}

/** What the numbers are built from: the quotes, SPY's daily snapshot and Cboe's closes. */
export interface MarketInputs {
  quotes: Record<string, { quote: { dp: number | null; t: number } | null } | undefined>;
  spy: { asOf: string; closes: number[]; sma: { 50: number | null; 200: number | null } } | null;
  gauges: Pick<Gauges, "vix" | "tenYear">;
}

/** The numbers from what was read. Pure: the loader below reads, this assembles. */
export function marketNumbersFrom(input: MarketInputs, now: Date): MarketNumbers {
  const pct = (t: string) => {
    const dp = input.quotes[t]?.quote?.dp;
    return typeof dp === "number" && Number.isFinite(dp) ? dp : null;
  };
  const spyQuote = input.quotes.SPY?.quote ?? null;
  const spy = input.spy;
  const close = spy?.closes?.[spy.closes.length - 1];
  const s50 = spy?.sma?.[50];
  const s200 = spy?.sma?.[200];
  const today = etToday(now);
  return {
    session: spyQuote ? etToday(new Date(spyQuote.t * 1000)) : null,
    spyPct: pct("SPY"),
    qqqPct: pct("QQQ"),
    spyAverages: spy && close && s50 && s200 ? { vs50: (close / s50 - 1) * 100, vs200: (close / s200 - 1) * 100, asOf: spy.asOf } : null,
    vix: input.gauges.vix,
    tenYear: input.gauges.tenYear,
    sectors: SECTOR_FUNDS.flatMap(([ticker, name]) => {
      const p = pct(ticker);
      return p == null ? [] : [{ ticker, name, pct: p }];
    }).sort((a, b) => b.pct - a.pct),
    dates: scheduledMarketDates(today, MARKET_DATES_DAYS, now),
    calendarGaps: calendarGaps(today, MARKET_DATES_DAYS),
  };
}

const MINUS = "−";
const signed = (n: number, digits = 2) => `${n < 0 ? MINUS : "+"}${Math.abs(n).toFixed(digits)}%`;
const vsAverage = (n: number, label: string) => `${Math.abs(n).toFixed(1)}% ${n < 0 ? "below" : "above"} its ${label}`;

/** The numbers as lines, each left out when its piece is missing. `now` names a session that isn't today's by its day. */
export function marketNumbersLines(n: MarketNumbers, now: Date): string[] {
  const when = n.session && n.session !== etToday(now) ? `on ${dayLabel(n.session)}` : "today";
  const lines: string[] = [];
  const spy: string[] = [];
  if (n.spyPct != null) spy.push(`S&P 500 (SPY) ${signed(n.spyPct)} ${when}`);
  if (n.spyAverages) spy.push(`${vsAverage(n.spyAverages.vs50, "50-day")} and ${vsAverage(n.spyAverages.vs200, "200-day")} at the ${dayLabel(n.spyAverages.asOf)} close`);
  if (spy.length) lines.push(spy.join("; "));
  if (n.qqqPct != null) lines.push(`Nasdaq (QQQ) ${signed(n.qqqPct)} ${when}`);
  const gauges = [n.vix && { g: n.vix, name: "VIX", unit: "" }, n.tenYear && { g: n.tenYear, name: "10-year yield", unit: "%" }].filter((x): x is { g: IndexClose; name: string; unit: string } => !!x);
  const oneDay = gauges.every((x) => x.g.asOf === gauges[0]?.g.asOf);
  const gauge = ({ g, name, unit }: (typeof gauges)[number]) =>
    `${name} ${g.close.toFixed(2)}${unit}${g.prevClose != null ? ` (${g.prevClose.toFixed(2)}${unit} the day before)` : ""}${oneDay ? "" : ` at the ${dayLabel(g.asOf)} close`}`;
  if (gauges.length) lines.push(`${gauges.map(gauge).join(", ")}${oneDay ? ` at the ${dayLabel(gauges[0].g.asOf)} close` : ""}`);
  if (n.sectors.length) lines.push(`Sectors ${when}, best to worst: ${n.sectors.map((s) => `${s.name} ${signed(s.pct, 1)}`).join(" · ")}`);
  if (n.dates.length) lines.push(`Market dates in the next ${MARKET_DATES_DAYS} days: ${n.dates.map((d) => `${dayLabel(d.date)} ${d.what}`).join(" · ")}`);
  lines.push(...n.calendarGaps);
  return lines;
}
