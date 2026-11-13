/**
 * market-numbers.ts — the market's numbers, written by code: the S&P 500 and
 * the Nasdaq 100 (SPY, QQQ), the regime sizing uses (SPY against its 50- and
 * 200-day, lib/agent/regime.ts), the 11 sector funds best to worst, VIXY's
 * move (a fund of VIX futures: no plan we hold serves the VIX index), and the
 * book's stocks reporting in the next 14 days. get_market_context, every
 * agent's Market and portfolio block and the Market Reviewer's first message
 * read these numbers, so none of them can disagree. Numbers only, no view.
 * Pure: the loader is load-market-numbers.ts.
 */
import type { LiveQuoteResult } from "@/lib/market-data/live-quote";
import { readPrice, type PriceReading } from "@/lib/market-data/quote-age";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";
import { computeRegime, type RegimeReading } from "@/lib/agent/regime";
import { EARNINGS_LOOKAHEAD_DAYS, type EarningsReport } from "@/lib/agent/triggers/earnings";

export const INDEXES = [
  { symbol: "SPY", name: "S&P 500" },
  { symbol: "QQQ", name: "Nasdaq 100" },
] as const;
/** The 11 S&P sector funds, each with the word the text gives it. */
export const SECTORS: Record<string, string> = {
  XLK: "tech", XLF: "financials", XLV: "health care", XLY: "discretionary", XLP: "staples", XLE: "energy",
  XLI: "industrials", XLB: "materials", XLRE: "real estate", XLU: "utilities", XLC: "communications",
};
/** Every symbol priced, in the one quotes call. */
export const MARKET_SYMBOLS = [...INDEXES.map((i) => i.symbol), ...Object.keys(SECTORS), "VIXY"];

export interface IndexNumbers {
  symbol: string;
  name: string;
  price: number | null;
  /** The day's move; null when the prior close is unknown (never a made-up zero). */
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  /** How old the price is (quote-age.ts). */
  reading: PriceReading;
}

export interface MarketNumbers {
  indexes: IndexNumbers[];
  regime: RegimeReading | null;
  /** The close the regime reads (YYYY-MM-DD), from the 06:30 snapshot. */
  regimeAsOf: string | null;
  /** Sector funds that were priced, best to worst. */
  sectors: { symbol: string; changePct: number }[];
  vixy: { price: number; changePct: number | null } | null;
  /** Held and watched stocks reporting in the next 14 days, soonest first; null when the calendar couldn't be read; absent when no book was asked. */
  reporting?: { ticker: string; held: boolean; date: string; hour: string | null }[] | null;
  /** Why a symbol has no price, in the vendor's words. */
  errors: string[];
}

export function buildMarketNumbers(i: {
  now: Date;
  quotes: Record<string, LiveQuoteResult>;
  spy: IndicatorSnapshot | null;
  /** The calendar's next report per stock; null when it couldn't be read. */
  upcoming?: Map<string, EarningsReport> | null;
  book?: { held: string[]; watched: string[] } | null;
}): MarketNumbers {
  const errors: string[] = [];
  const quoteOf = (symbol: string) => {
    const r = i.quotes[symbol];
    if (!r?.quote && r?.error) errors.push(r.error);
    return r?.quote && r.quote.c > 0 ? r.quote : null;
  };
  const indexes = INDEXES.map(({ symbol, name }) => {
    const q = quoteOf(symbol);
    return {
      symbol,
      name,
      price: q?.c ?? null,
      changePct: q?.dp ?? null,
      dayHigh: q ? q.h ?? q.c : null,
      dayLow: q ? q.l ?? q.c : null,
      reading: readPrice({ ticker: symbol, quote: q, quoteError: i.quotes[symbol]?.error, now: i.now }),
    };
  });
  const sectors = Object.keys(SECTORS)
    .map((symbol) => ({ symbol, changePct: quoteOf(symbol)?.dp ?? null }))
    .filter((s): s is { symbol: string; changePct: number } => s.changePct != null)
    .sort((a, b) => b.changePct - a.changePct);
  // Its day's move tracks fear; its price does not measure it (the fund bleeds value rolling futures).
  const v = quoteOf("VIXY");
  const vixy = v ? { price: v.c, changePct: v.dp ?? null } : null;

  const { book, upcoming } = i;
  const reporting = !book
    ? undefined
    : !upcoming
      ? null
      : [...new Set([...book.held, ...book.watched])]
          .flatMap((t) => (upcoming.has(t) ? [{ ticker: t, held: book.held.includes(t), date: upcoming.get(t)!.reportDate, hour: upcoming.get(t)!.hour }] : []))
          .sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  return { indexes, regime: computeRegime(i.spy, []), regimeAsOf: i.spy?.asOf ?? null, sectors, vixy, reporting, errors };
}

const pct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
const dayOf = (ymd: string, weekday: "long" | "short") =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday, month: "short", day: "numeric", timeZone: "UTC" });
/** "Thursday's close, Nov 12" for a day YYYY-MM-DD. */
const closeOf = (ymd: string) => {
  const [weekday, date] = dayOf(ymd, "long").split(", ");
  return `${weekday}'s close, ${date}`;
};
const etDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
/** How old an index's price is, in words: live, not current in the session, or which close. */
const whenOf = ({ reading: r }: IndexNumbers) =>
  r.live ? "live" : r.warning ? `not current (${r.ageMinutes ?? "?"} minutes old)` : r.asOf ? `at ${closeOf(etDay(r.asOf))}` : "of unknown age";
const BELL: Record<string, string> = { bmo: " before the open", amc: " after the close" };

/** The numbers as lines, one fact a line, each opening with "- " so no line reads as a heading. */
export function marketNumbersText(n: MarketNumbers): string {
  const priced = n.indexes.filter((x) => x.price != null);
  // One stamp for the line when every index is priced and of the same age; otherwise each carries its own.
  const one = priced.length === n.indexes.length && new Set(priced.map(whenOf)).size === 1;
  const index = (x: IndexNumbers) =>
    x.price == null
      ? `${x.name} (${x.symbol}) couldn't be priced`
      : `${x.name} (${x.symbol}) $${x.price.toFixed(2)}${x.changePct != null ? ` ${pct(x.changePct)}` : ""}${one ? "" : `, ${whenOf(x)}`}`;
  const sectorCount = Object.keys(SECTORS).length;
  const lines = [
    `- ${n.indexes.map(index).join(" · ")}${one && priced.length ? `, ${whenOf(priced[0])}` : ""}.`,
    n.regime
      ? `- ${n.regime.line.replace(/\.$/, "")}${n.regimeAsOf ? ` (as of ${closeOf(n.regimeAsOf)})` : ""}.`
      : "- The regime is unavailable: no SPY reading in the daily indicator snapshot.",
    n.sectors.length
      ? `- Sectors on the day, best to worst${n.sectors.length < sectorCount ? ` (${n.sectors.length} of ${sectorCount} priced)` : ""}: ${n.sectors.map((s) => `${s.symbol} ${SECTORS[s.symbol]} ${pct(s.changePct)}`).join(", ")}.`
      : "- The sector funds couldn't be priced.",
    n.vixy?.changePct != null ? `- VIXY, a fund of VIX futures (not the VIX itself): ${pct(n.vixy.changePct)} on the day.` : "- VIXY's day move couldn't be read.",
  ];
  if (n.reporting === null) lines.push("- Report dates for our stocks couldn't be read for this request.");
  else if (n.reporting?.length === 0) lines.push(`- None of our held or watched stocks reports in the next ${EARNINGS_LOOKAHEAD_DAYS} days.`);
  else if (n.reporting)
    lines.push(
      `- Our stocks reporting in the next ${EARNINGS_LOOKAHEAD_DAYS} days: ${n.reporting
        .map((r) => `${r.ticker} (${r.held ? "held" : "watched"}) ${dayOf(r.date, "short")}${BELL[r.hour ?? ""] ?? ""}`)
        .join("; ")}.`,
    );
  return lines.join("\n");
}
