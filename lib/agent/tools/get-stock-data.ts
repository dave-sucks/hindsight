/**
 * get_stock_data — migrated to defineTool().
 *
 * Gets comprehensive stock data: quote, company profile, financials,
 * the chart (lib/market-data/price-structure.ts — a year of daily bars:
 * moving averages, ATR, swings, base, gaps, relative strength), analyst
 * consensus, and recent news. Finnhub for quote/profile/metrics/news,
 * Alpaca for bars.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { finnhub } from "@/lib/agent/research-helpers";
import { getDailyBars } from "@/lib/alpaca";
import {
  computePriceStructure,
  sectorEtfFor,
  type PriceStructure,
} from "@/lib/market-data/price-structure";
import { getBenchmarkBars, CHART_SESSIONS } from "@/lib/market-data/benchmark-bars";
import type { NewsItem } from "@/lib/agent/tool-types";
import { checkUniverse } from "@/lib/agent/universe";
import type { UniverseCheck } from "@/lib/agent/universe";
import {
  getTickerHistory,
  formatTickerHistory,
  formatTickerHistoryShort,
} from "@/lib/agent/context-bundle";

export const getStockData = defineTool({
  description:
    "Get comprehensive data for a stock: price quote, company profile, key financials, analyst ratings, recent news, and the chart — a year of daily bars read into moving averages (20/50/150/200-day with slope), ATR, swing high/low, the current base and its pivot, recent gaps, volume vs average, relative strength vs SPY and the sector ETF, and a trend verdict. This is your primary research tool — includes everything you need for a single ticker.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
    include_technicals: z
      .boolean()
      .optional()
      .describe("Include the chart (price structure from a year of daily bars). Default true."),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.ticker.toUpperCase()}'s snapshot`,

  execute: async ({ ticker, include_technicals }, ctx) => {
    // Mark this ticker as researched in the in-run tracker so record_thesis
    // can gate against it ("was get_stock_data called for this ticker?").
    // Populated before any early-return paths so even failed/partial fetches
    // count as "researched" — the agent attempted, which is what the gate
    // checks. Falls back gracefully if ctx.calledTickers is undefined
    // (older call sites that don't initialize the tracker).
    if (ctx.calledTickers) {
      const key = ticker.toUpperCase();
      const existing = ctx.calledTickers.get(key) ?? new Set<string>();
      existing.add("get_stock_data");
      ctx.calledTickers.set(key, existing);
    }

    const doTechnicals = include_technicals !== false;

    // ── Our history with THIS name, attached to the research call ────────
    // This is the tool that runs on every candidate, so it is where "what
    // happened last time we looked at this stock" belongs. Leaving it to a
    // separate get_theses call the agent may or may not make is the exact
    // shape of the 2026-08-25 failure: the triage graded 13 names, called
    // no history tool at all, and scored them on a scout's public record
    // instead of our own P&L.
    //
    // Covers what the book-level block cannot: names we researched and
    // declined, or watched and dropped, without ever trading them.
    // Fail-open — history is context, never a reason a data pull dies.
    // Account-wide, not seat-only (principal's call, 2026-08-27): a name is
    // a name. AKAM lost $396 on Catalyst and $675 on Momentum independently
    // and neither run could see the other's result. Other seats' trades are
    // labelled with the seat so a different mandate reads as evidence
    // rather than a verdict.
    const priorCoverage = ctx.analystId
      ? await getTickerHistory({
          analystId: ctx.analystId,
          accountId: ctx.accountId,
          ticker,
        })
      : null;
    const priorCoverageNote = priorCoverage
      ? formatTickerHistory(priorCoverage)
      : null;
    // The chat row gets a one-liner; the full paragraph goes to the model.
    const priorCoverageChip = priorCoverage
      ? formatTickerHistoryShort(priorCoverage)
      : null;

    // Candle data comes from Alpaca only (getDailyBars: SIP, IEX fallback).
    // Finnhub `/stock/candle` requires the paid plan (403 on basic) and FMP
    // is gone (2026-09-08).
    const [quoteResult, profileResult, financialsResult, newsResult, recsResult, priceTargetResult] =
      await Promise.all([
        finnhub(`/quote?symbol=${ticker}`, 2),
        finnhub(`/stock/profile2?symbol=${ticker}`, 2),
        finnhub(`/stock/metric?symbol=${ticker}&metric=all`, 2),
        finnhub(
          `/company-news?symbol=${ticker}&from=${new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`,
          2,
        ),
        finnhub(`/stock/recommendation?symbol=${ticker}`, 2),
        // Price targets: no source on the current plans (FMP removed
        // 2026-09-08; Finnhub gates /stock/price-target). Kept as a null
        // slot so the snapshot shape is unchanged.
        Promise.resolve({ data: null as unknown, error: undefined as string | undefined }),
      ]);

    const quote = quoteResult.data as Record<string, number> | null;
    const profile = profileResult.data as Record<string, unknown> | null;
    const financials = financialsResult.data as { metric?: Record<string, unknown> } | null;
    const news = newsResult.data;
    const recommendations = recsResult.data;

    const errors: string[] = [];
    if (quoteResult.error) errors.push(quoteResult.error);
    if (profileResult.error) errors.push(profileResult.error);
    if (financialsResult.error) errors.push(financialsResult.error);

    const recentNews: NewsItem[] = Array.isArray(news)
      ? news.slice(0, 3).map((n: { headline: string; summary: string; source: string; url: string; datetime: number }) => ({
          headline: n.headline,
          summary: n.summary?.slice(0, 80),
          source: n.source,
          url: n.url,
          date: new Date(n.datetime * 1000).toISOString().slice(0, 10),
        }))
      : [];

    const latestRec = Array.isArray(recommendations)
      ? (recommendations as Record<string, number>[])[0]
      : null;

    // ── The chart ──────────────────────────────────────────────────────────
    // A year of completed daily sessions → lib/market-data/price-structure.ts.
    // SPY and the sector ETF come from the shared benchmark cache. The live
    // quote is the price distances are measured from. Fail-open: no bars, no
    // chart block — never a reason the research call dies.
    let techData: (PriceStructure & { volumeFeed: "sip" | "iex" }) | null = null;
    if (doTechnicals) {
      const sectorEtf = sectorEtfFor((profile?.finnhubIndustry as string | undefined) ?? null);
      const [own, spy, sector] = await Promise.all([
        getDailyBars(ticker, CHART_SESSIONS, ctx.alpacaCreds).catch((err) => {
          console.warn(`[tool] get_stock_data: bars failed for ${ticker}:`, err instanceof Error ? err.message : err);
          return null;
        }),
        getBenchmarkBars("SPY", ctx.alpacaCreds).catch(() => undefined),
        sectorEtf ? getBenchmarkBars(sectorEtf, ctx.alpacaCreds).catch(() => undefined) : undefined,
      ]);
      const structure = own
        ? computePriceStructure({
            bars: own.bars,
            price: quote?.c ?? null,
            spyBars: spy,
            sectorBars: sector,
            sectorEtf,
          })
        : null;
      if (structure && own) techData = { ...structure, volumeFeed: own.feed };
      else if (own) console.warn(`[tool] get_stock_data: ${own.bars.length} bars for ${ticker} — too few for a chart.`);
    }

    // ── Price targets ──────────────────────────────────────────────────────
    const ptArr = priceTargetResult.data as { targetConsensus?: number; targetHigh?: number; targetLow?: number; targetMedian?: number; numberOfAnalysts?: number }[];
    const targetsData = Array.isArray(ptArr) && ptArr.length > 0
      ? {
          consensus: ptArr[0].targetConsensus,
          high: ptArr[0].targetHigh,
          low: ptArr[0].targetLow,
          median: ptArr[0].targetMedian,
          numAnalysts: ptArr[0].numberOfAnalysts,
        }
      : null;

    // ── Normalize data ─────────────────────────────────────────────────────
    const fPct = (n: number | null | undefined) => n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "";
    const fCompact = (n: number | null | undefined) => {
      if (n == null) return "";
      if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
      if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
      if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
      return `$${n.toLocaleString()}`;
    };

    const quoteData = quote && quote.c
      ? { price: quote.c, change: quote.d ?? 0, changePct: quote.dp ?? 0, high: quote.h, low: quote.l, open: quote.o, prevClose: quote.pc }
      : null;
    const companyData = profile && profile.name
      ? { name: profile.name as string, sector: (profile.finnhubIndustry as string) ?? "", marketCap: profile.marketCapitalization ? (profile.marketCapitalization as number) * 1_000_000 : null, exchange: (profile.exchange as string) ?? "", country: (profile.country as string) ?? "" }
      : null;
    const financialsData = financials?.metric
      ? { peRatio: financials.metric.peNormalizedAnnual as number | null, pbRatio: financials.metric.pbAnnual as number | null, high52w: financials.metric["52WeekHigh"] as number | null, low52w: financials.metric["52WeekLow"] as number | null, avgVolume10d: financials.metric["10DayAverageTradingVolume"] as number | null, beta: financials.metric.beta as number | null }
      : null;
    const consensusData = latestRec
      ? { buy: latestRec.buy, hold: latestRec.hold, sell: latestRec.sell, strongBuy: latestRec.strongBuy, strongSell: latestRec.strongSell }
      : null;

    // ── Summary ────────────────────────────────────────────────────────────
    const sParts: string[] = [];
    if (companyData?.name) sParts.push(`${ticker} — ${companyData.name}`);
    else sParts.push(ticker);
    if (quoteData) sParts.push(`$${quoteData.price} (${fPct(quoteData.changePct)})`);

    const metaParts: string[] = [];
    if (companyData?.sector) metaParts.push(companyData.sector);
    if (companyData?.marketCap) metaParts.push(fCompact(companyData.marketCap));
    if (financialsData?.peRatio != null) metaParts.push(`P/E ${financialsData.peRatio.toFixed(1)}`);
    if (consensusData) {
      const total = consensusData.strongBuy + consensusData.buy + consensusData.hold + consensusData.sell + consensusData.strongSell;
      if (total > 0) metaParts.push(`${Math.round((consensusData.strongBuy + consensusData.buy) / total * 100)}% Buy`);
    }
    if (metaParts.length > 0) sParts.push(metaParts.join(" · "));
    if (techData) {
      const techParts: string[] = [];
      if (techData.verdict) techParts.push(techData.verdict);
      if (techData.rsi14 != null) techParts.push(`RSI ${techData.rsi14.toFixed(1)}`);
      if (techParts.length > 0) sParts.push(techParts.join(", "));
    }
    if (recentNews.length > 0) sParts.push(`${recentNews.length} news`);

    const tickerSummaryParts: string[] = [];
    if (companyData?.name) tickerSummaryParts.push(companyData.name);
    if (metaParts.length > 0) tickerSummaryParts.push(metaParts.join(" · "));
    if (techData?.verdict) tickerSummaryParts.push(techData.verdict);

    // ── Universe check (informational) ──────────────────────────────────
    // If the analyst has a Universe fence, check whether this ticker falls
    // inside it. The result is included in the data payload so the agent
    // sees "outside Universe — sector mismatch" in the tool result and can
    // decide whether to proceed. This is belt-and-suspenders alongside the
    // prompt-level enforcement.
    let universeCheck: UniverseCheck | undefined;
    const hasFence =
      (ctx.sectors?.length ?? 0) > 0 ||
      (ctx.industries?.length ?? 0) > 0 ||
      (ctx.exclusionList?.length ?? 0) > 0 ||
      ctx.marketCapMin != null ||
      ctx.marketCapMax != null;

    if (hasFence) {
      // Finnhub labels the field `finnhubIndustry` but populates it with a
      // mix of sectors ("Technology"), industries ("Semiconductors"), and
      // shorthand ("Tech", "Biotech"). checkUniverse normalizes through the
      // canonical alias table + industry→parent-sector lookup so an IT fence
      // matches any of those. Held + watchlisted tickers bypass the fence
      // in code — never flagged "outside universe".
      universeCheck = checkUniverse(
        {
          ticker,
          sector: companyData?.sector ?? null,
          industry: null, // Finnhub doesn't separately expose GICS industry
          marketCap: companyData?.marketCap ?? null,
        },
        {
          sectors: ctx.sectors,
          industries: ctx.industries,
          marketCapMin: ctx.marketCapMin ?? null,
          marketCapMax: ctx.marketCapMax ?? null,
          exclusionList: ctx.exclusionList,
          positionTickers: ctx.positionTickers,
          watchlistTickers: ctx.watchlist,
        },
      );
      if (!universeCheck.inUniverse) {
        sParts.push(`⚠ Outside Universe: ${universeCheck.failedReasons.join("; ")}`);
      }
    }

    return {
      // Prior coverage leads the summary. The model reads this line before
      // it reads the price — which is the point.
      summary:
        (priorCoverageNote ? `[Our history with $${ticker}] ${priorCoverageNote} ` : "") +
        sParts.join(". ") +
        ".",
      data: {
        ...(priorCoverageNote ? { priorCoverage: priorCoverageNote } : {}),
        quote: quoteData,
        company: companyData,
        financials: financialsData,
        technicals: techData,
        analystConsensus: consensusData,
        priceTargets: targetsData,
        news: recentNews,
        ...(universeCheck ? { universeCheck } : {}),
        ...(errors.length > 0 ? { apiErrors: errors } : {}),
        tickers: [
          {
            ticker,
            tag: priorCoverageChip ? "Prior coverage" : "Research",
            summary: priorCoverageChip
              ? `${priorCoverageChip} ${tickerSummaryParts.join(". ")}`
              : tickerSummaryParts.join(". "),
          },
        ],
      },
      sources: [
        { provider: "Finnhub", title: `${ticker} Real-Time Quote`, url: "https://finnhub.io/docs/api/quote" },
        { provider: "Finnhub", title: `${ticker} Company Profile`, url: "https://finnhub.io/docs/api/company-profile2" },
        { provider: "Finnhub", title: `${ticker} Key Financials`, url: "https://finnhub.io/docs/api/stock-basic-financials" },
        ...(consensusData ? [{ provider: "Finnhub", title: `${ticker} Analyst Consensus`, url: "https://finnhub.io/docs/api/recommendation-trends" }] : []),
        ...(techData ? [{ provider: "Alpaca", title: `${ticker} One-Year Daily Bars`, url: "https://alpaca.markets/docs/api-references/market-data-api/stock-pricing-data/historical/" }] : []),
      ],
    };
  },
});
