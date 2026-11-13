/**
 * get_market_context — migrated to defineTool().
 *
 * Gets current market conditions: SPY and QQQ, VIXY's day move, sector ETFs,
 * earnings density, and the market regime. All but the SMA-20 and the
 * earnings density come from loadMarketNumbers
 * (lib/market-data/load-market-numbers.ts), the numbers every agent's Market
 * and portfolio block prints, so the tool and the block can't disagree.
 *
 * No plan we pay for serves the VIX index (DAV-339, probe 2026-09-29:
 * Finnhub "Market data subscription required for CFD indices", Alpaca has
 * no index bars). For months this tool fell back to VIXY — an ETF of VIX
 * futures — and reported its share price as "VIX", and its RISK_ON line
 * was "VIX" under 16. The two sit in a similar range, which is why nobody
 * noticed. VIXY is now reported as what it is, by its day's move only, and
 * the regime is the playbook's (SPY against its 50- and 200-day averages,
 * lib/agent/regime.ts): the one sizing uses and every proposal shows.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { finnhub } from "@/lib/agent/research-helpers";
import { sma } from "@/lib/market-data/price-structure";
import { getBars } from "@/lib/alpaca";
import { loadMarketNumbers } from "@/lib/market-data/load-market-numbers";
import { SECTORS } from "@/lib/market-data/market-numbers";
import type { MacroEvent } from "@/lib/discovery/types";

function formatShortDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const SECTOR_COUNT = Object.keys(SECTORS).length;

export const getMarketContext = defineTool({
  description:
    "Get current market conditions: the S&P 500 and the Nasdaq 100 (SPY, QQQ), VIXY's move today (an ETF of VIX futures — its price is not the VIX level, and no plan we have serves the VIX index), sector ETF performance, and the market regime (SPY against its 50- and 200-day averages, as of the last close — the same regime that sizes every buy). A quick snapshot for market orientation.",
  schema: z.object({}),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: () => "Checking today's market regime",

  execute: async (_args, ctx) => {
    const errors: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const fiveDaysForward = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);

    // SPY candle via Alpaca (Finnhub /stock/candle is paid-only since
    // 2024).
    const spyBarsStart = new Date(Date.now() - 30 * 86400_000)
      .toISOString()
      .slice(0, 10);
    const [numbers, spyBarsResult, earningsDensityResult] =
      await Promise.all([
        // SPY, QQQ, the regime, the sector ETFs and VIXY: the numbers every
        // agent's Market and portfolio block prints (lib/market-data/market-numbers.ts).
        loadMarketNumbers({ creds: ctx.alpacaCreds }),
        // Alpaca returns daily bars; convert to the {c, s} shape the
        // downstream code expects.
        (async () => {
          try {
            const bars = await getBars(
              "SPY",
              { start: spyBarsStart, end: today },
              ctx.alpacaCreds,
            );
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
      ]);

    errors.push(...numbers.errors);
    const [spyData, qqqData] = numbers.indexes;
    // VIXY as itself (never a VIX level); the regime as of the last close, the one sizing uses.
    const { vixy, sectors, regime: regimeReading, regimeAsOf } = numbers;

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


    // Macro events: DROPPED 2026-08-19 (DAV-191). FMP /stable/economic-calendar
    // is 402 on our plan and Finnhub /calendar/economic is 403 — no vendor we
    // pay for serves an economic calendar, so this stays empty rather than
    // pretending. Re-add here (and restore the source line) if a plan changes.
    const macroEventsToday: MacroEvent[] = [];

    // Earnings density
    let earningsDensity: { count: number; period: string } = { count: 0, period: `${today}–${fiveDaysForward}` };
    try {
      const earningsRaw = earningsDensityResult.data as { earningsCalendar?: { symbol: string }[] } | null;
      if (earningsRaw?.earningsCalendar) {
        earningsDensity = {
          count: earningsRaw.earningsCalendar.length,
          period: `${formatShortDate(today)}–${formatShortDate(fiveDaysForward)}`,
        };
      }
    } catch { /* non-fatal */ }

    const fPct = (n: number | null | undefined) => n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "";
    const spyReading = spyData.reading;
    const warnings: string[] = [];
    if (spyReading.warning) warnings.push(spyReading.warning);
    if (!regimeReading) warnings.push("The market regime is unavailable: no SPY reading in today's indicator snapshot.");
    if (!vixy) warnings.push("VIXY's quote failed — no read on today's fear gauge.");
    if (sectors.length < SECTOR_COUNT) {
      warnings.push(`Only ${sectors.length} of ${SECTOR_COUNT} sector ETF quotes came back — the sector ranking is partial.`);
    }
    const trendAsOf = " (daily closes)";
    const summaryParts: string[] = warnings.map((w) => `⚠ ${w}`);
    if (spyData.price != null) summaryParts.push(`SPY $${spyData.price} (${fPct(spyData.changePct)})`);
    if (qqqData.price != null) summaryParts.push(`QQQ $${qqqData.price} (${fPct(qqqData.changePct)})`);
    if (vixy?.changePct != null) summaryParts.push(`VIXY ${fPct(vixy.changePct)} today (VIX futures ETF; not the VIX level)`);
    if (regimeReading) {
      summaryParts.push(`${regimeReading.line.replace(/\.$/, "")}${regimeAsOf ? ` (as of the ${regimeAsOf} close)` : ""}`);
    }
    if (macroEventsToday.length > 0) summaryParts.push(`${macroEventsToday.length} macro event${macroEventsToday.length !== 1 ? "s" : ""} today`);
    if (earningsDensity.count > 0) summaryParts.push(`${earningsDensity.count} earnings ${earningsDensity.period}`);

    return {
      summary: summaryParts.join(". ") + ".",
      data: {
        spy: spyData.price != null
          ? { price: spyData.price, changePct: spyData.changePct, dayHigh: spyData.dayHigh, dayLow: spyData.dayLow, asOf: spyReading.asOf, ageMinutes: spyReading.ageMinutes, live: spyReading.live }
          : null,
        qqq: qqqData.price != null ? { price: qqqData.price, changePct: qqqData.changePct, live: qqqData.reading.live } : null,
        ...(warnings.length > 0 ? { warnings } : {}),
        vixy,
        regime: regimeReading?.regime ?? null,
        regimeLine: regimeReading?.line ?? null,
        regimeAsOf,
        spyTrend: spyTrend
          ? { sma20: spyTrend.sma_20, position: spyTrend.position, pctFromSma: spyTrend.pct_from_sma, measuredFrom: "daily closes" }
          : null,
        sectors,
        macroEvents: macroEventsToday,
        earningsDensity,
        ...(errors.length > 0 ? { apiErrors: errors } : {}),
        // Tool UI renders the summary; raw market data lives on data for downstream consumers
        tickers: [
          ...(spyData.price != null
            ? [{ ticker: "SPY", summary: `${spyReading.warningShort ? `⚠ ${spyReading.warningShort} · ` : ""}$${spyData.price} (${fPct(spyData.changePct)})${spyTrend ? `, ${spyTrend.position} SMA-20 by ${fPct(spyTrend.pct_from_sma)}${trendAsOf}` : ""}` }]
            : spyReading.warningShort
              ? [{ ticker: "SPY", summary: `⚠ ${spyReading.warningShort}` }]
              : []),
        ],
      },
      sources: [
        { provider: "Alpaca", title: "SPY and QQQ Real-Time Quotes", url: "https://docs.alpaca.markets/reference/stocksnapshots-1" },
        { provider: "Alpaca", title: "VIXY (ProShares VIX Short-Term Futures ETF)", url: "https://docs.alpaca.markets/reference/stocksnapshots-1" },
        { provider: "Alpaca", title: "SPY 50- and 200-day averages (daily indicator snapshot, regime)", url: "https://alpaca.markets/docs/api-references/market-data-api/stock-pricing-data/historical/" },
        { provider: "Alpaca", title: "S&P 500 Sector ETF Performance", url: "https://docs.alpaca.markets/reference/stocksnapshots-1" },
        { provider: "Alpaca", title: "SPY 30-Day Bars (SMA-20)", url: "https://alpaca.markets/docs/api-references/market-data-api/stock-pricing-data/historical/" },
        { provider: "Finnhub", title: "Earnings Calendar (5-Day Density)", url: "https://finnhub.io/docs/api/earnings-calendar" },
      ],
    };
  },
});
