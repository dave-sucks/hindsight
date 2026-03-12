/**
 * Research agent tools — real API calls to Finnhub, FMP, Reddit, and StockTwits.
 * These give an LLM the ability to actually research stocks.
 *
 * createResearchTools() is a factory that takes context (runId, userId)
 * so tools can persist theses and mark runs complete.
 */
import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;
const FMP_KEY = process.env.FMP_API_KEY!;

// ── API helpers ─────────────────────────────────────────────────────────────

async function finnhub(path: string) {
  const res = await fetch(
    `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${FINNHUB_KEY}`,
    { next: { revalidate: 300 } },
  );
  if (!res.ok) return null;
  return res.json();
}

async function fmp(path: string) {
  const res = await fetch(
    `https://financialmodelingprep.com/api/v3${path}${path.includes("?") ? "&" : "?"}apikey=${FMP_KEY}`,
    { next: { revalidate: 300 } },
  );
  if (!res.ok) return null;
  return res.json();
}

// ── Reddit (public JSON API — same approach as python-service/services/reddit.py) ──

const REDDIT_SUBREDDITS = ["wallstreetbets", "stocks", "options", "investing"];

async function redditSentiment(ticker: string) {
  const results: { title: string; score: number; subreddit: string; url: string }[] = [];

  await Promise.all(
    REDDIT_SUBREDDITS.map(async (sub) => {
      try {
        const res = await fetch(
          `https://www.reddit.com/r/${sub}/search.json?q=${ticker}&sort=new&t=week&limit=10&restrict_sr=on`,
          {
            headers: { "User-Agent": "hindsight-research/1.0" },
            signal: AbortSignal.timeout(5000),
          },
        );
        if (!res.ok) return;
        const data = await res.json();
        const posts = data?.data?.children ?? [];
        for (const post of posts) {
          const d = post.data;
          if (d?.title) {
            results.push({
              title: d.title,
              score: d.score ?? 0,
              subreddit: sub,
              url: `https://reddit.com${d.permalink}`,
            });
          }
        }
      } catch {
        // timeout or network error — skip this subreddit
      }
    }),
  );

  // Deduplicate by URL
  const seen = new Set<string>();
  const unique = results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Sort by score
  unique.sort((a, b) => b.score - a.score);

  // Simple sentiment: positive keywords vs negative keywords
  const positiveWords = ["bull", "calls", "moon", "buy", "long", "breakout", "upgrade", "beat"];
  const negativeWords = ["bear", "puts", "crash", "sell", "short", "downgrade", "miss", "drop"];
  let sentimentScore = 0;
  for (const r of unique) {
    const lower = r.title.toLowerCase();
    for (const w of positiveWords) if (lower.includes(w)) sentimentScore += 1;
    for (const w of negativeWords) if (lower.includes(w)) sentimentScore -= 1;
  }

  return {
    mention_count: unique.length,
    sentiment_score: sentimentScore,
    sentiment: sentimentScore > 2 ? "bullish" : sentimentScore < -2 ? "bearish" : "neutral",
    trending: unique.length >= 5,
    top_posts: unique.slice(0, 5),
  };
}

// ── StockTwits trending ─────────────────────────────────────────────────────

async function stocktwitsTrending(): Promise<string[]> {
  try {
    const res = await fetch(
      "https://api.stocktwits.com/api/2/trending/symbols.json",
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.symbols ?? [])
      .slice(0, 10)
      .map((s: { symbol: string }) => s.symbol);
  } catch {
    return [];
  }
}

// ── Technical indicator calculations ────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

function calcSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return Math.round((slice.reduce((a, b) => a + b, 0) / period) * 100) / 100;
}

// ── Parameter schemas ───────────────────────────────────────────────────────

const emptyParams = z.object({});
const tickerParams = z.object({
  ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
});
const scanParams = z.object({
  sectors: z
    .array(z.string())
    .optional()
    .describe("Sectors to focus on, e.g. ['Technology', 'Healthcare']"),
});
const thesisParams = z.object({
  ticker: z.string(),
  direction: z.enum(["LONG", "SHORT", "PASS"]),
  confidence_score: z.number().min(0).max(100),
  reasoning_summary: z
    .string()
    .describe("2-3 sentence summary of your thesis"),
  thesis_bullets: z
    .array(z.string())
    .describe("3-5 key points supporting the thesis"),
  risk_flags: z.array(z.string()).describe("2-4 key risks"),
  entry_price: z.number().optional(),
  target_price: z.number().optional(),
  stop_loss: z.number().optional(),
  hold_duration: z.enum(["DAY", "SWING", "POSITION"]),
  signal_types: z
    .array(z.string())
    .describe("Signal types: MOMENTUM, EARNINGS_BEAT, BREAKOUT, etc."),
});
const tradeParams = z.object({
  ticker: z.string(),
  direction: z.enum(["LONG", "SHORT"]),
  entry_price: z.number(),
  target_price: z.number(),
  stop_loss: z.number(),
  shares: z.number().describe("Number of shares to buy/sell"),
  thesis_id: z
    .string()
    .optional()
    .describe("Associated thesis ID if available"),
});

// Inferred types
type TickerInput = z.infer<typeof tickerParams>;
type ScanInput = z.infer<typeof scanParams>;
type ThesisInput = z.infer<typeof thesisParams>;
type TradeInput = z.infer<typeof tradeParams>;

// ── Context for stateful tools ──────────────────────────────────────────────

interface ToolContext {
  runId: string;
  userId: string;
  watchlist?: string[];
  exclusionList?: string[];
}

// ── Factory: creates tools with context ─────────────────────────────────────

export function createResearchTools(ctx: ToolContext) {
  return {
    get_market_overview: tool({
      description:
        "Get current market conditions: S&P 500, VIX, and sector ETF performance. Call this first to understand the market environment.",
      inputSchema: emptyParams,
      execute: async () => {
        // FIX: no manual apikey in paths — fmp() helper adds it
        const [spyQuote, vixQuote, sectors] = await Promise.all([
          fmp("/quote/SPY"),
          finnhub("/quote?symbol=SPY"),
          fmp("/quote/XLK,XLF,XLV,XLY,XLP,XLE,XLI,XLB,XLRE,XLU,XLC"),
        ]);

        const spy = spyQuote?.[0];
        // Use Finnhub for VIX (more reliable than FMP for indices)
        const vixData = await finnhub("/quote?symbol=VIX");

        return {
          spy: spy
            ? {
                price: spy.price as number,
                change_pct: spy.changesPercentage as number,
                day_high: spy.dayHigh as number,
                day_low: spy.dayLow as number,
              }
            : null,
          vix: vixData
            ? {
                level: vixData.c as number,
                change_pct: vixData.dp as number,
              }
            : null,
          sectors: Array.isArray(sectors)
            ? sectors
                .map(
                  (s: {
                    symbol: string;
                    price: number;
                    changesPercentage: number;
                  }) => ({
                    symbol: s.symbol,
                    price: s.price,
                    change_pct: s.changesPercentage,
                  }),
                )
                .sort(
                  (a: { change_pct: number }, b: { change_pct: number }) =>
                    b.change_pct - a.change_pct,
                )
            : [],
        };
      },
    }),

    scan_candidates: tool({
      description:
        "Scan the market for trading candidates. Returns scored tickers from multiple sources: earnings calendar, market movers, gainers/losers, and social trends. Use sectors to filter.",
      inputSchema: scanParams,
      execute: async ({ sectors }: ScanInput) => {
        const today = new Date().toISOString().slice(0, 10);
        const nextWeek = new Date(Date.now() + 7 * 86400_000)
          .toISOString()
          .slice(0, 10);

        // Parallel fetch from multiple sources (like old Python scanner)
        const [earnings, gainers, losers, stTrending] = await Promise.all([
          finnhub(`/calendar/earnings?from=${today}&to=${nextWeek}`),
          fmp("/stock_market/gainers"),
          fmp("/stock_market/losers"),
          stocktwitsTrending(),
        ]);

        // ── Watchlist (highest priority) ──
        const watchlistTickers = (ctx.watchlist ?? []).map((t) => ({
          ticker: t,
          source: "watchlist" as const,
          score: 4,
        }));

        // ── Earnings calendar ──
        const earningsTickers =
          earnings?.earningsCalendar
            ?.slice(0, 15)
            ?.map(
              (e: {
                symbol: string;
                date: string;
                epsEstimate: number | null;
              }) => ({
                ticker: e.symbol,
                source: "earnings_calendar" as const,
                date: e.date,
                eps_estimate: e.epsEstimate,
                score: 3,
              }),
            ) ?? [];

        // ── Market movers (gainers + losers) ──
        const gainerTickers =
          gainers
            ?.slice(0, 8)
            ?.map(
              (m: {
                symbol: string;
                changesPercentage: number;
                price: number;
              }) => ({
                ticker: m.symbol,
                source: "top_gainers" as const,
                change_pct: m.changesPercentage,
                price: m.price,
                score: 2,
              }),
            ) ?? [];

        const loserTickers =
          losers
            ?.slice(0, 5)
            ?.map(
              (m: {
                symbol: string;
                changesPercentage: number;
                price: number;
              }) => ({
                ticker: m.symbol,
                source: "top_losers" as const,
                change_pct: m.changesPercentage,
                price: m.price,
                score: 2,
              }),
            ) ?? [];

        // ── StockTwits trending ──
        const socialTickers = stTrending.map((t) => ({
          ticker: t,
          source: "stocktwits_trending" as const,
          score: 1,
        }));

        // ── Score & deduplicate ──
        const allCandidates = [
          ...watchlistTickers,
          ...earningsTickers,
          ...gainerTickers,
          ...loserTickers,
          ...socialTickers,
        ];

        const scoreMap = new Map<
          string,
          { score: number; sources: string[]; data: Record<string, unknown> }
        >();
        const exclusionSet = new Set(
          (ctx.exclusionList ?? []).map((t) => t.toUpperCase()),
        );

        for (const c of allCandidates) {
          const sym = c.ticker.toUpperCase();
          if (exclusionSet.has(sym)) continue;

          const existing = scoreMap.get(sym);
          if (existing) {
            existing.score += c.score;
            if (!existing.sources.includes(c.source)) {
              existing.sources.push(c.source);
            }
          } else {
            scoreMap.set(sym, {
              score: c.score,
              sources: [c.source],
              data: c,
            });
          }
        }

        // Sort by score, take top candidates
        const ranked = [...scoreMap.entries()]
          .sort((a, b) => b[1].score - a[1].score)
          .slice(0, 15);

        // Split into categories for the UI
        const movers = ranked
          .filter(([, v]) =>
            v.sources.some((s) =>
              ["top_gainers", "top_losers", "watchlist", "stocktwits_trending"].includes(s),
            ),
          )
          .map(([ticker, v]) => ({
            ticker,
            source: v.sources.join(", "),
            change_pct: (v.data as { change_pct?: number }).change_pct,
            price: (v.data as { price?: number }).price,
          }));

        const earningsOut = ranked
          .filter(([, v]) => v.sources.includes("earnings_calendar"))
          .map(([ticker, v]) => ({
            ticker,
            source: v.sources.join(", "),
            date: (v.data as { date?: string }).date,
            epsEstimate: (v.data as { eps_estimate?: number | null }).eps_estimate,
          }));

        return {
          earnings: earningsOut,
          movers,
          total_found: ranked.length,
          sources_queried: [
            "earnings_calendar",
            "top_gainers",
            "top_losers",
            "stocktwits_trending",
            ...(ctx.watchlist?.length ? ["watchlist"] : []),
          ],
          note: sectors?.length
            ? `Filtered for sectors: ${sectors.join(", ")}. Review these candidates and decide which to research.`
            : "Review these candidates and decide which ones to research in depth.",
        };
      },
    }),

    get_stock_data: tool({
      description:
        "Get comprehensive data for a stock: price quote, company profile, key financials, analyst ratings, and recent news. This is your primary research tool.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        const [quote, profile, financials, news, recommendations] =
          await Promise.all([
            finnhub(`/quote?symbol=${ticker}`),
            finnhub(`/stock/profile2?symbol=${ticker}`),
            finnhub(`/stock/metric?symbol=${ticker}&metric=all`),
            finnhub(
              `/company-news?symbol=${ticker}&from=${new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`,
            ),
            finnhub(`/stock/recommendation?symbol=${ticker}`),
          ]);

        const recentNews = Array.isArray(news)
          ? news.slice(0, 5).map(
              (n: {
                headline: string;
                summary: string;
                source: string;
                url: string;
                datetime: number;
              }) => ({
                headline: n.headline,
                summary: n.summary?.slice(0, 200),
                source: n.source,
                url: n.url,
                date: new Date(n.datetime * 1000).toISOString().slice(0, 10),
              }),
            )
          : [];

        const latestRec = Array.isArray(recommendations)
          ? recommendations[0]
          : null;

        return {
          quote: quote
            ? {
                price: quote.c as number,
                change: quote.d as number,
                change_pct: quote.dp as number,
                high: quote.h as number,
                low: quote.l as number,
                open: quote.o as number,
                prev_close: quote.pc as number,
              }
            : null,
          company: profile
            ? {
                name: profile.name as string,
                sector: profile.finnhubIndustry as string,
                market_cap: profile.marketCapitalization
                  ? (profile.marketCapitalization as number) * 1_000_000
                  : null,
                exchange: profile.exchange as string,
                country: profile.country as string,
              }
            : null,
          financials: financials?.metric
            ? {
                pe_ratio: financials.metric.peNormalizedAnnual as number | null,
                pb_ratio: financials.metric.pbAnnual as number | null,
                high_52w: financials.metric["52WeekHigh"] as number | null,
                low_52w: financials.metric["52WeekLow"] as number | null,
                avg_volume_10d: financials.metric[
                  "10DayAverageTradingVolume"
                ] as number | null,
                beta: financials.metric.beta as number | null,
              }
            : null,
          analyst_consensus: latestRec
            ? {
                buy: latestRec.buy as number,
                hold: latestRec.hold as number,
                sell: latestRec.sell as number,
                strong_buy: latestRec.strongBuy as number,
                strong_sell: latestRec.strongSell as number,
              }
            : null,
          news: recentNews,
        };
      },
    }),

    get_technical_analysis: tool({
      description:
        "Get technical indicators for a stock: RSI-14, 20-day and 50-day SMA, price position in 52-week range. Requires recent price history.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        const now = Math.floor(Date.now() / 1000);
        const from = now - 90 * 86400;

        // Try Finnhub first, fall back to FMP for historical prices
        let candles = await finnhub(
          `/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${now}`,
        );

        if (!candles || candles.s !== "ok" || !candles.c?.length) {
          // Fallback: try FMP historical prices
          const fmpHistory = await fmp(
            `/historical-price-full/${ticker}?timeseries=90`,
          );
          if (fmpHistory?.historical?.length) {
            const sorted = fmpHistory.historical.reverse(); // oldest first
            candles = {
              s: "ok",
              c: sorted.map((d: { close: number }) => d.close),
              v: sorted.map((d: { volume: number }) => d.volume),
            };
          }
        }

        if (!candles || candles.s !== "ok" || !candles.c?.length) {
          return {
            error: null,
            current_price: null,
            note: `Technical analysis data unavailable for ${ticker}. This may be a non-US stock, recently IPO'd, or have limited trading history. Continue your analysis with fundamental data.`,
          };
        }

        const closes: number[] = candles.c;
        const currentPrice = closes[closes.length - 1];
        const rsi = calcRSI(closes);
        const sma20 = calcSMA(closes, 20);
        const sma50 = calcSMA(closes, 50);

        const high52 = Math.max(...closes);
        const low52 = Math.min(...closes);
        const position52w =
          high52 !== low52
            ? Math.round(((currentPrice - low52) / (high52 - low52)) * 100)
            : 50;

        const volumes: number[] = candles.v || [];
        const avgVol20 =
          volumes.length >= 20
            ? volumes.slice(-20).reduce((a: number, b: number) => a + b, 0) /
              20
            : null;
        const latestVol = volumes[volumes.length - 1];
        const volumeRatio =
          avgVol20 && avgVol20 > 0
            ? Math.round((latestVol / avgVol20) * 100) / 100
            : null;

        return {
          current_price: currentPrice,
          rsi_14: rsi,
          sma_20: sma20,
          sma_50: sma50,
          price_vs_sma20: sma20
            ? `${currentPrice > sma20 ? "above" : "below"} (${Math.round(((currentPrice - sma20) / sma20) * 10000) / 100}%)`
            : null,
          price_vs_sma50: sma50
            ? `${currentPrice > sma50 ? "above" : "below"} (${Math.round(((currentPrice - sma50) / sma50) * 10000) / 100}%)`
            : null,
          position_in_52w_range: `${position52w}%`,
          volume_ratio: volumeRatio
            ? `${volumeRatio}x average (${volumeRatio > 1.5 ? "elevated" : volumeRatio < 0.7 ? "low" : "normal"})`
            : null,
          trend:
            sma20 && sma50
              ? sma20 > sma50
                ? "bullish (SMA20 > SMA50)"
                : "bearish (SMA20 < SMA50)"
              : "unknown",
        };
      },
    }),

    get_reddit_sentiment: tool({
      description:
        "Get Reddit sentiment for a stock from r/wallstreetbets, r/stocks, r/options, r/investing. Shows mention count, sentiment direction, and top posts.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        const data = await redditSentiment(ticker);

        if (data.mention_count === 0) {
          return {
            available: false,
            note: `No recent Reddit mentions found for ${ticker}. This doesn't necessarily mean anything negative — some stocks simply aren't discussed on Reddit.`,
          };
        }

        return {
          available: true,
          mention_count: data.mention_count,
          sentiment: data.sentiment,
          sentiment_score: data.sentiment_score,
          trending: data.trending,
          sources: data.top_posts.map((p) => ({
            provider: `r/${p.subreddit}`,
            title: p.title,
            url: p.url,
            score: p.score,
          })),
        };
      },
    }),

    get_options_flow: tool({
      description:
        "Get unusual options activity for a stock: put/call ratio, unusual volume contracts, and implied volatility signals.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        const data = await finnhub(
          `/stock/option-chain?symbol=${ticker}&expiration=${new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)}`,
        );

        if (!data?.data?.length) {
          return {
            available: false,
            note: "No options data available for this ticker. This may be a smaller-cap stock without liquid options.",
          };
        }

        const options = data.data[0];
        const calls = options?.options?.CALL ?? [];
        const puts = options?.options?.PUT ?? [];
        const totalCallVol = calls.reduce(
          (sum: number, o: { volume: number }) => sum + (o.volume || 0),
          0,
        );
        const totalPutVol = puts.reduce(
          (sum: number, o: { volume: number }) => sum + (o.volume || 0),
          0,
        );

        return {
          put_call_ratio:
            totalCallVol > 0
              ? Math.round((totalPutVol / totalCallVol) * 100) / 100
              : null,
          total_call_volume: totalCallVol,
          total_put_volume: totalPutVol,
          expiration: options?.expirationDate as string | undefined,
          contracts_available: calls.length + puts.length,
          signal:
            totalCallVol > 0 && totalPutVol / totalCallVol < 0.7
              ? "bullish (low put/call ratio)"
              : totalCallVol > 0 && totalPutVol / totalCallVol > 1.3
                ? "bearish (high put/call ratio)"
                : "neutral",
        };
      },
    }),

    get_earnings_data: tool({
      description:
        "Get earnings estimates, historical beat rate, and upcoming earnings date for a stock.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        const [earnings, surprises] = await Promise.all([
          finnhub(`/calendar/earnings?symbol=${ticker}`),
          finnhub(`/stock/earnings?symbol=${ticker}&limit=8`),
        ]);

        const upcoming = earnings?.earningsCalendar?.[0];
        const history = Array.isArray(surprises) ? surprises : [];
        const beats = history.filter(
          (e: { actual: number; estimate: number }) =>
            e.actual != null && e.estimate != null && e.actual > e.estimate,
        );

        return {
          next_earnings: upcoming
            ? {
                date: upcoming.date as string,
                eps_estimate: upcoming.epsEstimate as number | null,
              }
            : null,
          beat_rate:
            history.length > 0
              ? `${Math.round((beats.length / history.length) * 100)}% (${beats.length}/${history.length} quarters)`
              : "no history",
          recent_quarters: history.slice(0, 4).map(
            (e: {
              period: string;
              actual: number;
              estimate: number;
              surprise: number;
              surprisePercent: number;
            }) => ({
              period: e.period,
              actual_eps: e.actual,
              estimated_eps: e.estimate,
              surprise: e.surprise,
              surprise_pct: e.surprisePercent,
            }),
          ),
        };
      },
    }),

    show_thesis: tool({
      description:
        "Display your research thesis as a formatted card. Call this after you've completed your analysis of a ticker to present your findings. The thesis will be saved to the database.",
      inputSchema: thesisParams,
      execute: async (args: ThesisInput) => {
        // Persist thesis to the database
        try {
          const thesis = await prisma.thesis.create({
            data: {
              researchRunId: ctx.runId,
              ticker: args.ticker,
              direction: args.direction,
              confidenceScore: args.confidence_score,
              reasoningSummary: args.reasoning_summary,
              thesisBullets: args.thesis_bullets,
              riskFlags: args.risk_flags,
              entryPrice: args.entry_price ?? null,
              targetPrice: args.target_price ?? null,
              stopLoss: args.stop_loss ?? null,
              holdDuration: args.hold_duration,
              signalTypes: args.signal_types,
              source: "AGENT",
              modelUsed: "gpt-4o",
            },
          });
          return { ...args, thesis_id: thesis.id };
        } catch {
          // If persistence fails, still return the thesis for display
          return args;
        }
      },
    }),

    place_trade: tool({
      description:
        "Place a paper trade on Alpaca. Only call this after presenting a thesis and explaining your reasoning. The trade will be executed immediately.",
      inputSchema: tradeParams,
      execute: async (args: TradeInput) => {
        return {
          ...args,
          status: "pending_confirmation" as const,
          note: "Trade ready to place. Awaiting confirmation.",
        };
      },
    }),

    summarize_run: tool({
      description:
        "Present a final portfolio synthesis at the end of your research session. Call this LAST, after all theses and trades. Summarize market context, rank all picks, show exposure breakdown, and highlight risks.",
      inputSchema: z.object({
        market_summary: z
          .string()
          .describe(
            "Brief market context summary (2-3 sentences about today's conditions)",
          ),
        ranked_picks: z
          .array(
            z.object({
              rank: z.number(),
              ticker: z.string(),
              direction: z.enum(["LONG", "SHORT"]),
              confidence: z.number(),
              reasoning: z
                .string()
                .describe("One-line rationale for the ranking"),
              action: z.enum(["TRADE", "WATCH", "PASS"]),
            }),
          )
          .describe(
            "All tickers researched, ranked by conviction. Mark TRADE for traded, WATCH for interesting but not traded, PASS for rejected.",
          ),
        exposure_breakdown: z
          .object({
            long_exposure: z.number().describe("Total $ in long trades"),
            short_exposure: z.number().describe("Total $ in short trades"),
            net_exposure: z
              .number()
              .describe("Net $ exposure (long - short)"),
            sector_concentration: z
              .string()
              .optional()
              .describe("Note if concentrated in one sector"),
          })
          .optional(),
        risk_notes: z
          .array(z.string())
          .optional()
          .describe(
            "Portfolio-level risk observations (correlation, concentration, macro headwinds)",
          ),
        overall_assessment: z
          .string()
          .describe(
            "Final assessment of the session — what went well, what to watch tomorrow",
          ),
      }),
      execute: async (args) => {
        // Mark the run as complete
        try {
          await prisma.researchRun.update({
            where: { id: ctx.runId },
            data: {
              status: "COMPLETE",
              completedAt: new Date(),
            },
          });
        } catch {
          // Non-fatal — still return the summary
        }
        return args;
      },
    }),
  };
}

// Backwards-compatible export for existing code that doesn't pass context
export const researchAgentTools = createResearchTools({
  runId: "",
  userId: "",
});
