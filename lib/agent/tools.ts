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

async function fetchRedditSubreddit(
  sub: string,
  ticker: string,
  maxRetries = 2,
): Promise<{ title: string; score: number; subreddit: string; url: string }[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(
        `https://www.reddit.com/r/${sub}/search.json?q=${ticker}&sort=new&t=week&limit=10&restrict_sr=on`,
        {
          headers: {
            "User-Agent": "hindsight-research/1.0 (by /u/hindsight-bot)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (res.status === 429 || res.status === 403) {
        // Rate-limited or blocked — wait and retry
        console.warn(
          `[reddit] r/${sub} returned ${res.status} for ${ticker} (attempt ${attempt + 1}/${maxRetries + 1})`,
        );
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return [];
      }
      if (!res.ok) {
        console.warn(`[reddit] r/${sub} returned ${res.status} for ${ticker}`);
        return [];
      }
      const data = await res.json();
      const posts = data?.data?.children ?? [];
      const results: { title: string; score: number; subreddit: string; url: string }[] = [];
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
      return results;
    } catch (err) {
      console.warn(
        `[reddit] r/${sub} fetch error for ${ticker} (attempt ${attempt + 1}/${maxRetries + 1}):`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return [];
    }
  }
  return [];
}

async function redditSentiment(ticker: string) {
  const results: { title: string; score: number; subreddit: string; url: string }[] = [];
  let failedCount = 0;
  let blockedCount = 0;

  const subResults = await Promise.all(
    REDDIT_SUBREDDITS.map((sub) => fetchRedditSubreddit(sub, ticker)),
  );
  for (const subPosts of subResults) {
    if (subPosts.length === 0) failedCount++;
    results.push(...subPosts);
  }

  // If all subreddits returned empty, it's likely a block/rate-limit issue.
  // Track this separately from "no mentions found".
  if (failedCount === REDDIT_SUBREDDITS.length) {
    blockedCount = failedCount;
  }

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
    // Diagnostic info: did all subreddits fail (likely blocked) vs just no mentions?
    all_blocked: blockedCount === REDDIT_SUBREDDITS.length,
    failed_subreddits: failedCount,
    total_subreddits: REDDIT_SUBREDDITS.length,
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
        const [spyQuote, sectors] = await Promise.all([
          fmp("/quote/SPY"),
          fmp("/quote/XLK,XLF,XLV,XLY,XLP,XLE,XLI,XLB,XLRE,XLU,XLC"),
        ]);

        const spy = spyQuote?.[0];

        // VIX: Finnhub needs ^VIX (not plain VIX which returns 0).
        // Try ^VIX first, fall back to FMP /quote/%5EVIX.
        let vixLevel: number | null = null;
        let vixChangePct: number | null = null;

        const vixFinnhub = await finnhub("/quote?symbol=%5EVIX");
        if (vixFinnhub && typeof vixFinnhub.c === "number" && vixFinnhub.c > 0) {
          vixLevel = vixFinnhub.c;
          vixChangePct = vixFinnhub.dp ?? null;
        } else {
          // Fallback: FMP VIX quote
          const vixFmp = await fmp("/quote/%5EVIX");
          const vixItem = Array.isArray(vixFmp) ? vixFmp[0] : null;
          if (vixItem && typeof vixItem.price === "number" && vixItem.price > 0) {
            vixLevel = vixItem.price;
            vixChangePct = vixItem.changesPercentage ?? null;
          }
        }

        return {
          spy: spy
            ? {
                price: spy.price as number,
                change_pct: spy.changesPercentage as number,
                day_high: spy.dayHigh as number,
                day_low: spy.dayLow as number,
              }
            : null,
          vix: vixLevel !== null
            ? {
                level: vixLevel,
                change_pct: vixChangePct,
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
          _sources: [
            { provider: "FMP", title: "SPY Real-Time Quote" },
            { provider: "Finnhub", title: "CBOE VIX Index" },
            { provider: "FMP", title: "S&P 500 Sector ETF Performance" },
          ],
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
          _sources: [
            { provider: "Finnhub", title: "Earnings Calendar (Next 7 Days)" },
            { provider: "FMP", title: "Top Gainers & Losers" },
            { provider: "StockTwits", title: "Trending Symbols" },
            ...(ctx.watchlist?.length
              ? [{ provider: "Watchlist", title: "Custom Watchlist" }]
              : []),
          ],
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
          _sources: [
            { provider: "Finnhub", title: `${ticker} Real-Time Quote` },
            { provider: "Finnhub", title: `${ticker} Company Profile` },
            { provider: "Finnhub", title: `${ticker} Key Financials` },
            ...(latestRec
              ? [{ provider: "Finnhub", title: `${ticker} Analyst Consensus` }]
              : []),
            ...recentNews.map((n: { source: string; headline: string; url: string; summary: string }) => ({
              provider: n.source,
              title: n.headline,
              url: n.url,
              excerpt: n.summary,
            })),
          ],
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
        let priceProvider = "Finnhub";
        let candles = await finnhub(
          `/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${now}`,
        );

        if (!candles || candles.s !== "ok" || !candles.c?.length) {
          // Fallback: try FMP historical prices
          priceProvider = "FMP";
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
          _sources: [
            { provider: priceProvider, title: `${ticker} 90-Day Price History` },
          ],
        };
      },
    }),

    get_reddit_sentiment: tool({
      description:
        "Get Reddit sentiment for a stock from r/wallstreetbets, r/stocks, r/options, r/investing. Shows mention count, sentiment direction, and top posts.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        const data = await redditSentiment(ticker);

        // If public Reddit API was fully blocked, try Python service (PRAW) as fallback
        if (data.mention_count === 0 && data.all_blocked) {
          const pythonUrl = process.env.PYTHON_SERVICE_URL;
          const pythonSecret = process.env.PYTHON_SERVICE_SECRET;
          if (pythonUrl) {
            try {
              console.log(`[reddit] Public API blocked, trying Python PRAW fallback for ${ticker}`);
              const res = await fetch(`${pythonUrl}/research/reddit-sentiment?ticker=${ticker}`, {
                headers: {
                  "X-Service-Secret": pythonSecret ?? "",
                  Accept: "application/json",
                },
                signal: AbortSignal.timeout(15000),
              });
              if (res.ok) {
                const pyData = await res.json();
                if (pyData && (pyData.mention_count > 0 || pyData.posts?.length > 0)) {
                  const posts = (pyData.posts ?? pyData.top_posts ?? []) as {
                    title: string;
                    score: number;
                    subreddit: string;
                    url: string;
                  }[];
                  return {
                    available: true,
                    mention_count: pyData.mention_count ?? posts.length,
                    sentiment: pyData.sentiment ?? "neutral",
                    sentiment_score: pyData.sentiment_score ?? 0,
                    trending: pyData.trending ?? posts.length >= 5,
                    sources: posts.slice(0, 5).map((p) => ({
                      provider: `r/${p.subreddit}`,
                      title: p.title,
                      url: p.url,
                      score: p.score,
                    })),
                    data_source: "python_praw",
                    _sources: posts.slice(0, 5).map((p) => ({
                      provider: `Reddit r/${p.subreddit}`,
                      title: p.title,
                      url: p.url,
                    })),
                  };
                }
              } else {
                console.warn(`[reddit] Python PRAW fallback returned ${res.status} for ${ticker}`);
              }
            } catch (err) {
              console.warn(
                `[reddit] Python PRAW fallback failed for ${ticker}:`,
                err instanceof Error ? err.message : err,
              );
            }
          }

          return {
            available: false,
            reason: "blocked",
            note: `Reddit API returned 403/429 for all subreddits (likely IP-based rate limiting). No Reddit sentiment data available for ${ticker}. Continue analysis with other data sources.`,
            _sources: [{ provider: "Reddit", title: `${ticker} Reddit Sentiment (Blocked)` }],
          };
        }

        if (data.mention_count === 0) {
          return {
            available: false,
            reason: "no_mentions",
            note: `No recent Reddit mentions found for ${ticker}. This doesn't necessarily mean anything negative — some stocks simply aren't discussed on Reddit.`,
            _sources: [{ provider: "Reddit", title: `${ticker} Reddit Search (No Results)` }],
          };
        }

        const redditSources = data.top_posts.map((p) => ({
          provider: `Reddit r/${p.subreddit}`,
          title: p.title,
          url: p.url,
        }));

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
          _sources: redditSources,
        };
      },
    }),

    get_options_flow: tool({
      description:
        "Get unusual options activity for a stock: put/call ratio, unusual volume contracts, and implied volatility signals.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        // Primary: FMP options chain (no expiration needed, returns all contracts)
        // This matches the Python service approach and is more reliable.
        const fmpData = await fmp(`/options/chain/${ticker.toUpperCase()}`);

        if (Array.isArray(fmpData) && fmpData.length > 0) {
          let totalCallVol = 0;
          let totalPutVol = 0;
          const unusualContracts: {
            type: string;
            strike: number;
            expiration: string;
            volume: number;
            openInterest: number;
            premium: number;
          }[] = [];

          const stockPrice = fmpData[0]?.underlyingPrice ?? 0;

          for (const contract of fmpData) {
            const ctype = (contract.type ?? "").toUpperCase();
            const vol = Number(contract.volume ?? 0);
            const oi = Number(contract.openInterest ?? 0);
            const lastPrice = Number(contract.lastPrice ?? 0);

            if (ctype === "CALL") totalCallVol += vol;
            else if (ctype === "PUT") totalPutVol += vol;

            // Flag unusual: volume >5x open interest or large premium
            const volOiRatio = oi > 0 ? vol / oi : vol;
            const premium = lastPrice * vol * 100;
            if (vol > 0 && (volOiRatio >= 5 || premium >= 500_000)) {
              unusualContracts.push({
                type: ctype,
                strike: Number(contract.strike ?? 0),
                expiration: contract.expirationDate ?? "",
                volume: vol,
                openInterest: oi,
                premium: Math.round(premium),
              });
            }
          }

          // Sort unusual by premium desc, cap at 5
          unusualContracts.sort((a, b) => b.premium - a.premium);

          return {
            available: true,
            put_call_ratio:
              totalCallVol > 0
                ? Math.round((totalPutVol / totalCallVol) * 100) / 100
                : null,
            total_call_volume: totalCallVol,
            total_put_volume: totalPutVol,
            contracts_available: fmpData.length,
            unusual_contracts: unusualContracts.slice(0, 5),
            signal:
              totalCallVol > 0 && totalPutVol / totalCallVol < 0.7
                ? "bullish (low put/call ratio)"
                : totalCallVol > 0 && totalPutVol / totalCallVol > 1.3
                  ? "bearish (high put/call ratio)"
                  : "neutral",
            data_source: "fmp",
            _sources: [
              { provider: "FMP", title: `${ticker} Options Chain` },
            ],
          };
        }

        // Fallback: Finnhub option chain (requires expiration date guess)
        const expDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
        const finnhubData = await finnhub(
          `/stock/option-chain?symbol=${ticker}&expiration=${expDate}`,
        );

        if (finnhubData?.data?.length) {
          const options = finnhubData.data[0];
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
            available: true,
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
            data_source: "finnhub",
            _sources: [
              { provider: "Finnhub", title: `${ticker} Options Chain` },
            ],
          };
        }

        return {
          available: false,
          note: `No options data available for ${ticker}. This may be a smaller-cap stock without liquid options, or the options data providers may be temporarily unavailable.`,
          _sources: [
            { provider: "Finnhub", title: `${ticker} Options Chain (No Data)` },
          ],
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
          _sources: [
            { provider: "Finnhub", title: `${ticker} Earnings Calendar` },
            { provider: "Finnhub", title: `${ticker} Earnings History` },
          ],
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
