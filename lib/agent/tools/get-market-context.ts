/**
 * get_market_context: the market, for any run. SPY now; the VIX and the
 * 10-year yield at the last close; VIXY's day move; the sector funds; the
 * regime; the market's own calendar for the next three weeks with the
 * betting odds on the next Fed decision; and the day's market headlines.
 *
 * The VIX: no plan we pay for serves the index (DAV-339, probe 2026-09-29:
 * Finnhub "Market data subscription required for CFD indices", Alpaca has
 * no index bars). For months this tool reported VIXY, an ETF of VIX
 * futures, as "VIX". Since 2026-11-06 the level comes from Cboe's own daily
 * file, as of its last close (lib/market-data/market-gauges.ts). VIXY stays,
 * by its day's move only, as the one fear read during the session.
 *
 * The calendar replaces `macroEvents`, empty since 2026-08-19 when the paid
 * economic calendars went (FMP 402, Finnhub 403). On Nov 2, 2026 this tool
 * told every morning run the regime and the sectors, and nothing about the
 * vote the next day (get-market-context.nov2-replay.test.ts).
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { finnhub } from "@/lib/agent/research-helpers";
import { sma } from "@/lib/market-data/price-structure";
import { getBars } from "@/lib/alpaca";
import { readPrice, type PriceReading } from "@/lib/market-data/quote-age";
import { getLiveQuotes } from "@/lib/market-data/live-quote";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";
import { computeRegime } from "@/lib/agent/regime";
import { loadGauges, type IndexClose } from "@/lib/market-data/market-gauges";
import { loadMarketHeadlines, etTime } from "@/lib/market-data/market-news";
import { loadNextFedOdds, oddsLine } from "@/lib/market-data/fed-odds";
import {
  addDays,
  calendarGaps,
  dayLabel,
  etToday,
  moverReports,
  nextFedDecision,
  scheduledMarketDates,
} from "@/lib/market-data/market-calendar";
import type { ToolUIItem } from "@/lib/agent/tool-result";

/** "11/2" from "2026-11-02", read as written (no time zone to shift it). */
function formatShortDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

const SECTOR_ETFS = ["XLK", "XLF", "XLV", "XLY", "XLP", "XLE", "XLI", "XLB", "XLRE", "XLU", "XLC"];
/** How far ahead the market's calendar looks. */
const CALENDAR_DAYS = 21;
/** Finnhub's earnings calendar stops at this many rows, so a count of it is a floor. */
const EARNINGS_ROW_CAP = 1500;
/** A close older than this many days is said to be stale. */
const STALE_CLOSE_DAYS = 5;

export const getMarketContext = defineTool({
  description:
    "Get the market: the S&P 500 (SPY) now; the VIX and the 10-year Treasury yield at the last close (Cboe); VIXY's move today (an ETF of VIX futures, not the VIX level); sector ETF performance; the market regime (SPY against its 50- and 200-day averages, as of the last close: the same regime that sizes every buy); the market's calendar for the next three weeks (Fed decisions with Polymarket's odds on the next one, inflation and jobs reports, US elections, and reports from the biggest companies in the next five days); and the day's market headlines.",
  schema: z.object({}),
  ui: "tool-ui" as const,
  groupId: "Researching",

  // The rows on screen are built from the same fields the model reads; it
  // doesn't need them twice.
  forModel: (result) => {
    if (!result.ok) return result;
    const data = { ...(result.data as Record<string, unknown>) };
    delete data.items;
    return { ...result, data };
  },

  progressLabel: () => "Checking today's market",

  execute: async (_args, ctx) => {
    const now = new Date();
    const errors: string[] = [];
    const today = etToday(now);
    const fiveDaysForward = addDays(today, 5);

    const allSymbols = ["SPY", ...SECTOR_ETFS];
    // How old SPY's price is, in words when it isn't live (quote-age).
    const spyQuote: { reading: PriceReading | null } = { reading: null };
    // SPY candle via Alpaca (Finnhub /stock/candle is paid-only since
    // 2024).
    const spyBarsStart = addDays(today, -30);
    const [live, spyBarsResult, earningsDensityResult, gauges, news, fed] = await Promise.all([
      // SPY, the sector ETFs and VIXY in one call.
      getLiveQuotes([...allSymbols, "VIXY"], { caller: "other", creds: ctx.alpacaCreds }),
      // Alpaca returns daily bars; convert to the {c, s} shape the
      // downstream code expects.
      (async () => {
        try {
          const bars = await getBars("SPY", { start: spyBarsStart, end: today }, ctx.alpacaCreds);
          return bars.length > 0
            ? { data: { s: "ok" as const, c: bars.map((b) => b.close) } }
            : { data: null as null, error: "Alpaca SPY bars empty" };
        } catch (err) {
          return {
            data: null as null,
            error: err instanceof Error ? err.message : "Alpaca bars error",
          };
        }
      })(),
      finnhub(`/calendar/earnings?from=${today}&to=${fiveDaysForward}`, 2),
      loadGauges().catch(() => ({ vix: null, tenYear: null, errors: ["Cboe did not answer"] })),
      loadMarketHeadlines(now).catch(() => ({ headlines: [], error: "Finnhub's market news failed" })),
      loadNextFedOdds(now),
    ]);

    const quoteResults = allSymbols.map((sym) => {
      const { quote: d, error } = live[sym] ?? { quote: null };
      if (sym === "SPY") spyQuote.reading = readPrice({ ticker: "SPY", quote: d, quoteError: error, now });
      if (d) {
        return { symbol: sym, price: d.c, changesPercentage: d.dp ?? 0, dayHigh: d.h ?? d.c, dayLow: d.l ?? d.c };
      }
      if (error) errors.push(error);
      return null;
    });
    const spyData = quoteResults[0];
    const sectorsRaw = quoteResults.slice(1).filter(Boolean);

    // VIXY, as itself, from the same batch. Its daily move tracks fear; its
    // price does not measure it (the fund bleeds value rolling futures), so
    // no threshold is ever read off the price.
    const vixyQuote = live.VIXY?.quote ?? null;
    const vixy =
      vixyQuote && typeof vixyQuote.c === "number" && vixyQuote.c > 0
        ? { price: vixyQuote.c, changePct: typeof vixyQuote.dp === "number" ? vixyQuote.dp : null }
        : null;

    // The regime: the playbook's, from the daily snapshot — as of the last
    // close, the same reading sizing and the proposals use.
    const spySnapshot = (await loadIndicatorSnapshots(["SPY"]).catch(() => new Map())).get("SPY") ?? null;
    const regimeReading = computeRegime(spySnapshot, []);
    const regimeAsOf = spySnapshot?.asOf ?? null;

    // SPY's short trend, for context (the regime above is the 50/200-day one).
    let spyTrend: { sma_20: number; position: "above" | "below"; pct_from_sma: number } | null = null;

    const spyCandle = spyBarsResult.data as { c?: number[]; s?: string } | null;
    if (spyCandle && spyCandle.s === "ok" && Array.isArray(spyCandle.c) && spyCandle.c.length >= 5) {
      const closes = spyCandle.c;
      const rawSma20 = sma(closes, 20);
      const sma20 = rawSma20 != null ? Math.round(rawSma20 * 100) / 100 : null;
      const currentPrice = closes[closes.length - 1];
      if (sma20 !== null) {
        const position: "above" | "below" = currentPrice >= sma20 ? "above" : "below";
        const pctFromSma = Math.round(((currentPrice - sma20) / sma20) * 10000) / 100;
        spyTrend = { sma_20: sma20, position, pct_from_sma: pctFromSma };
      }
    } else if (spyBarsResult.error) {
      errors.push(spyBarsResult.error);
    }

    // Earnings: the count for the next five days, and the market movers'
    // reports in them. Finnhub stops the list at 1,500 rows, so a full list
    // is a floor, and a big report past the cut can be missing.
    const earningsRows =
      (earningsDensityResult.data as { earningsCalendar?: { symbol?: string; date?: string; hour?: string | null }[] } | null)
        ?.earningsCalendar ?? [];
    const earningsDensity = {
      count: earningsRows.length,
      period: `${formatShortDate(today)}–${formatShortDate(fiveDaysForward)}`,
      capped: earningsRows.length >= EARNINGS_ROW_CAP,
    };

    // The market's calendar: the scheduled dates for three weeks, the
    // movers' reports for five days.
    const calendar = [...scheduledMarketDates(today, CALENDAR_DAYS), ...moverReports(earningsRows, today, 5)].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const nextFed = nextFedDecision(today);
    const fedOdds = fed.odds;

    const sectors = sectorsRaw
      .filter((s): s is NonNullable<typeof s> => s != null)
      .map((s) => ({ symbol: s.symbol, changePct: s.changesPercentage }))
      .sort((a, b) => b.changePct - a.changePct);

    const fPct = (n: number | null | undefined) => n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "";
    const spyReading = spyQuote.reading;
    const staleBefore = addDays(today, -STALE_CLOSE_DAYS);
    const closeWarning = (name: string, g: IndexClose | null) =>
      g == null
        ? `The ${name} is unavailable${gauges.errors.length ? ` (${gauges.errors.join("; ")})` : ""}.`
        : g.asOf < staleBefore
          ? `Cboe's ${name} file ends at the ${g.asOf} close; there is no newer one.`
          : null;

    const warnings: string[] = [];
    if (spyReading?.warning) warnings.push(spyReading.warning);
    if (!regimeReading) warnings.push("The market regime is unavailable: no SPY reading in today's indicator snapshot.");
    if (!vixy) warnings.push("VIXY's quote failed — no read on today's fear gauge.");
    for (const w of [closeWarning("VIX close", gauges.vix), closeWarning("10-year yield", gauges.tenYear)]) if (w) warnings.push(w);
    if (sectors.length < SECTOR_ETFS.length) {
      warnings.push(`Only ${sectors.length} of ${SECTOR_ETFS.length} sector ETF quotes came back — the sector ranking is partial.`);
    }
    warnings.push(...calendarGaps(today, CALENDAR_DAYS));
    if (fed.error) warnings.push(`No betting odds on the next Fed decision: ${fed.error}.`);
    if (news.error) warnings.push(`No market headlines: ${news.error}.`);

    const vixLine = gauges.vix
      ? `VIX ${gauges.vix.close.toFixed(2)} at the ${dayLabel(gauges.vix.asOf)} close${gauges.vix.prevClose != null ? ` (${gauges.vix.prevClose.toFixed(2)} the close before)` : ""}`
      : null;
    const tenYearBp =
      gauges.tenYear?.prevClose != null ? Math.round((gauges.tenYear.close - gauges.tenYear.prevClose) * 100) : null;
    const tenYearLine = gauges.tenYear
      ? `10-year Treasury yield ${gauges.tenYear.close.toFixed(2)}% at the ${dayLabel(gauges.tenYear.asOf)} close${tenYearBp != null ? ` (${tenYearBp >= 0 ? "+" : ""}${tenYearBp} bp)` : ""}`
      : null;
    const regimeLine = regimeReading
      ? `${regimeReading.line.replace(/\.$/, "")}${regimeAsOf ? ` (as of the ${regimeAsOf} close)` : ""}`
      : null;
    const calendarLine = `Market dates, next 3 weeks: ${calendar.length > 0 ? calendar.map((d) => `${dayLabel(d.date)} ${d.what}`).join("; ") : "none on file"}`;
    const fedLine = nextFed
      ? `Next Fed decision ${dayLabel(nextFed)}${fedOdds ? ` (Polymarket, "${fedOdds.title}": ${oddsLine(fedOdds)})` : ""}`
      : null;
    const earningsLine =
      earningsDensity.count === 0
        ? null
        : earningsDensity.capped
          ? `${EARNINGS_ROW_CAP.toLocaleString("en-US")}+ earnings ${earningsDensity.period} (the vendor's list stops at ${EARNINGS_ROW_CAP.toLocaleString("en-US")})`
          : `${earningsDensity.count} earnings ${earningsDensity.period}`;

    const summaryParts: string[] = warnings.map((w) => `⚠ ${w}`);
    if (spyData) summaryParts.push(`SPY $${spyData.price} (${fPct(spyData.changesPercentage)})`);
    if (vixLine) summaryParts.push(vixLine);
    if (vixy?.changePct != null) summaryParts.push(`VIXY ${fPct(vixy.changePct)} today (VIX futures ETF; not the VIX level)`);
    if (tenYearLine) summaryParts.push(tenYearLine);
    if (regimeLine) summaryParts.push(regimeLine);
    summaryParts.push(calendarLine);
    if (fedLine) summaryParts.push(fedLine);
    if (earningsLine) summaryParts.push(earningsLine);

    const generic = (text: string): ToolUIItem => ({ kind: "generic", text });
    const spyRowText = spyData
      ? `${spyReading?.warningShort ? `⚠ ${spyReading.warningShort} · ` : ""}$${spyData.price} (${fPct(spyData.changesPercentage)})${spyTrend ? `, ${spyTrend.position} SMA-20 by ${fPct(spyTrend.pct_from_sma)} (daily closes)` : ""}`
      : spyReading?.warningShort
        ? `⚠ ${spyReading.warningShort}`
        : null;
    const items: ToolUIItem[] = [
      ...warnings.filter((w) => w !== spyReading?.warning).map((w) => generic(`⚠ ${w}`)),
      ...(spyRowText ? [{ kind: "ticker" as const, ticker: "SPY", text: spyRowText }] : []),
      ...[vixLine, tenYearLine, regimeLine].filter((l): l is string => l != null).map(generic),
      ...calendar.map((d) => generic(`${dayLabel(d.date)} · ${d.what}`)),
      ...(fedLine ? [generic(fedLine)] : []),
      ...news.headlines.map((h) => generic(`${h.source}, ${etTime(h.at)} · ${h.headline}`)),
    ];

    return {
      summary: summaryParts.join(". ") + ".",
      data: {
        spy: spyData
          ? { price: spyData.price, changePct: spyData.changesPercentage, dayHigh: spyData.dayHigh, dayLow: spyData.dayLow, asOf: spyReading?.asOf ?? null, ageMinutes: spyReading?.ageMinutes ?? null, live: spyReading?.live ?? false }
          : null,
        ...(warnings.length > 0 ? { warnings } : {}),
        vixy,
        vixClose: gauges.vix,
        tenYear: gauges.tenYear ? { yieldPct: gauges.tenYear.close, prevYieldPct: gauges.tenYear.prevClose, changeBp: tenYearBp, asOf: gauges.tenYear.asOf } : null,
        regime: regimeReading?.regime ?? null,
        regimeLine: regimeReading?.line ?? null,
        regimeAsOf,
        spyTrend: spyTrend
          ? { sma20: spyTrend.sma_20, position: spyTrend.position, pctFromSma: spyTrend.pct_from_sma, measuredFrom: "daily closes" }
          : null,
        sectors,
        calendar,
        nextFedDecision: nextFed ? { date: nextFed, odds: fedOdds } : null,
        earningsDensity,
        headlines: news.headlines,
        ...(errors.length > 0 ? { apiErrors: errors } : {}),
        items,
      },
      sources: [
        { provider: "Alpaca", title: "SPY Real-Time Quote", url: "https://docs.alpaca.markets/reference/stocksnapshots-1" },
        { provider: "Alpaca", title: "VIXY (ProShares VIX Short-Term Futures ETF)", url: "https://docs.alpaca.markets/reference/stocksnapshots-1" },
        { provider: "Cboe", title: "VIX daily closes", url: "https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv" },
        { provider: "Cboe", title: "10-year Treasury yield (TNX) daily closes", url: "https://cdn.cboe.com/api/global/us_indices/daily_prices/TNX_History.csv" },
        { provider: "Alpaca", title: "SPY 50- and 200-day averages (daily indicator snapshot, regime)", url: "https://alpaca.markets/docs/api-references/market-data-api/stock-pricing-data/historical/" },
        { provider: "Alpaca", title: "S&P 500 Sector ETF Performance", url: "https://docs.alpaca.markets/reference/stocksnapshots-1" },
        { provider: "Alpaca", title: "SPY 30-Day Bars (SMA-20)", url: "https://alpaca.markets/docs/api-references/market-data-api/stock-pricing-data/historical/" },
        { provider: "Federal Reserve", title: "FOMC meeting calendar", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
        { provider: "BLS", title: "CPI and jobs report release schedules", url: "https://www.bls.gov/schedule/news_release/cpi.htm" },
        ...(fedOdds ? [{ provider: "Polymarket", title: fedOdds.title, url: fedOdds.url }] : []),
        { provider: "Finnhub", title: "Earnings Calendar (5-Day Density)", url: "https://finnhub.io/docs/api/earnings-calendar" },
        { provider: "Finnhub", title: "Market news", url: "https://finnhub.io/docs/api/market-news" },
      ],
    };
  },
});
