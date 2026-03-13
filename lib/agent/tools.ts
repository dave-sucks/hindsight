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
import { placeMarketOrder, getOrder, getLatestPrice } from "@/lib/alpaca";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;
const FMP_KEY = process.env.FMP_API_KEY!;

// ── API helpers (with logging + error detail) ───────────────────────────────

async function finnhub(path: string): Promise<{ data: unknown; error?: string }> {
  const url = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${FINNHUB_KEY}`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) {
      const msg = `Finnhub ${path.split("?")[0]} returned ${res.status}`;
      console.warn(`[finnhub] ${msg}`);
      return { data: null, error: msg };
    }
    return { data: await res.json() };
  } catch (err) {
    const msg = `Finnhub ${path.split("?")[0]} fetch failed: ${err instanceof Error ? err.message : "unknown"}`;
    console.error(`[finnhub] ${msg}`);
    return { data: null, error: msg };
  }
}

async function fmp(path: string): Promise<{ data: unknown; error?: string }> {
  // Support both v3 and v4 paths: if path starts with /v4/, use it directly
  const base = path.startsWith("/v4/")
    ? `https://financialmodelingprep.com/api${path}`
    : `https://financialmodelingprep.com/api/v3${path}`;
  const url = `${base}${path.includes("?") ? "&" : "?"}apikey=${FMP_KEY}`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `FMP ${path.split("?")[0]} returned ${res.status}: ${body.slice(0, 200)}`;
      console.warn(`[fmp] ${msg}`);
      return { data: null, error: msg };
    }
    const data = await res.json();
    // FMP returns { "Error Message": "..." } on bad API key or invalid endpoint
    if (data && typeof data === "object" && !Array.isArray(data) && "Error Message" in data) {
      const msg = `FMP ${path.split("?")[0]}: ${(data as Record<string, string>)["Error Message"]}`;
      console.warn(`[fmp] ${msg}`);
      return { data: null, error: msg };
    }
    // FMP sometimes returns empty array for valid-but-unsupported symbols
    if (Array.isArray(data) && data.length === 0) {
      console.warn(`[fmp] ${path.split("?")[0]} returned empty array`);
    }
    return { data };
  } catch (err) {
    const msg = `FMP ${path.split("?")[0]} fetch failed: ${err instanceof Error ? err.message : "unknown"}`;
    console.error(`[fmp] ${msg}`);
    return { data: null, error: msg };
  }
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

  unique.sort((a, b) => b.score - a.score);

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

// ── Twitter/X sentiment (StockTwits stream + FMP social sentiment) ──────────

async function twitterSentiment(ticker: string): Promise<{
  available: boolean;
  mention_count: number;
  sentiment: "bullish" | "bearish" | "neutral";
  sentiment_score: number;
  trending: boolean;
  watchlist_count: number;
  posts: { body: string; username: string; created_at: string; url: string; likes?: number }[];
  fmp_sentiment: { date: string; sentiment: number; mentions: number } | null;
}> {
  const posts: { body: string; username: string; created_at: string; url: string; likes?: number }[] = [];
  let watchlistCount = 0;
  let sentimentScore = 0;
  let mentionCount = 0;
  let trending = false;

  // 1. StockTwits stream (public API, no auth — closest proxy for Twitter stock discussion)
  try {
    const res = await fetch(
      `https://api.stocktwits.com/api/2/streams/symbol/${ticker.toUpperCase()}.json`,
      {
        headers: { "User-Agent": "hindsight-research/1.0" },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.ok) {
      const data = await res.json();
      const symbol = data?.symbol;
      watchlistCount = symbol?.watchlist_count ?? 0;
      trending = watchlistCount > 10000;

      const messages = (data?.messages ?? []) as {
        body: string;
        user: { username: string };
        created_at: string;
        id: number;
        entities?: { sentiment?: { basic: string } };
        likes?: { total: number };
      }[];

      mentionCount = messages.length;

      for (const msg of messages.slice(0, 8)) {
        const sentimentBasic = msg.entities?.sentiment?.basic;
        if (sentimentBasic === "Bullish") sentimentScore += 1;
        else if (sentimentBasic === "Bearish") sentimentScore -= 1;

        posts.push({
          body: msg.body.slice(0, 200),
          username: msg.user?.username ?? "anon",
          created_at: msg.created_at ?? "",
          url: `https://stocktwits.com/symbol/${ticker.toUpperCase()}`,
          likes: msg.likes?.total,
        });
      }
    }
  } catch (err) {
    console.warn(`[twitter] StockTwits failed for ${ticker}:`, err instanceof Error ? err.message : err);
  }

  // 2. FMP social sentiment (aggregates Twitter + StockTwits data)
  let fmpSentimentData: { date: string; sentiment: number; mentions: number } | null = null;
  try {
    const fmpResult = await fmp(`/v4/historical/social-sentiment?symbol=${ticker.toUpperCase()}&limit=1`);
    const arr = fmpResult.data as { date: string; stocktwitsSentiment?: number; twitterSentiment?: number; stocktwitsPostsMention?: number; twitterPostsMention?: number }[] | null;
    if (Array.isArray(arr) && arr.length > 0) {
      const latest = arr[0];
      const twitterSent = latest.twitterSentiment ?? latest.stocktwitsSentiment ?? 0;
      const twitterMentions = latest.twitterPostsMention ?? latest.stocktwitsPostsMention ?? 0;
      fmpSentimentData = {
        date: latest.date,
        sentiment: twitterSent,
        mentions: twitterMentions,
      };
      if (twitterSent > 0.6) sentimentScore += 2;
      else if (twitterSent < 0.4) sentimentScore -= 2;
      mentionCount = Math.max(mentionCount, twitterMentions);
    }
  } catch {
    // non-fatal
  }

  const sentiment = sentimentScore > 2 ? "bullish" : sentimentScore < -2 ? "bearish" : "neutral";

  return {
    available: posts.length > 0 || fmpSentimentData != null,
    mention_count: mentionCount,
    sentiment,
    sentiment_score: sentimentScore,
    trending,
    watchlist_count: watchlistCount,
    posts: posts.slice(0, 5),
    fmp_sentiment: fmpSentimentData,
  };
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
        console.log(`[tool] get_market_overview runId=${ctx.runId}`);
        const errors: string[] = [];

        // Use Finnhub as primary for all quotes (FMP /quote/ is deprecated)
        const SECTOR_ETFS = ["XLK", "XLF", "XLV", "XLY", "XLP", "XLE", "XLI", "XLB", "XLRE", "XLU", "XLC"];

        // Fetch SPY + all sector ETFs from Finnhub in parallel
        const allSymbols = ["SPY", ...SECTOR_ETFS];
        const quoteResults = await Promise.all(
          allSymbols.map(async (sym) => {
            const res = await finnhub(`/quote?symbol=${sym}`);
            const d = res.data as Record<string, number> | null;
            if (d && typeof d.c === "number" && d.c > 0) {
              return { symbol: sym, price: d.c, changesPercentage: d.dp ?? 0, dayHigh: d.h ?? d.c, dayLow: d.l ?? d.c };
            }
            if (res.error) errors.push(res.error);
            return null;
          })
        );

        const spyData = quoteResults[0];
        const sectorsRaw = quoteResults.slice(1).filter(Boolean);

        console.log(`[tool] get_market_overview SPY=${spyData ? `$${spyData.price}` : "null"} sectors=${sectorsRaw.length}`);

        // VIX: Finnhub first, then VIXY fallback
        let vixLevel: number | null = null;
        let vixChangePct: number | null = null;

        const vixFinnhubResult = await finnhub(`/quote?symbol=${encodeURIComponent("^VIX")}`);
        const vixFinnhub = vixFinnhubResult.data as Record<string, number> | null;
        if (vixFinnhub && typeof vixFinnhub.c === "number" && vixFinnhub.c > 0) {
          vixLevel = vixFinnhub.c;
          vixChangePct = vixFinnhub.dp ?? null;
          console.log(`[tool] VIX from Finnhub: ${vixLevel}`);
        } else {
          // Fallback: VIXY ETF via Finnhub
          const vixyResult = await finnhub("/quote?symbol=VIXY");
          const vixy = vixyResult.data as Record<string, number> | null;
          if (vixy && typeof vixy.c === "number" && vixy.c > 0) {
            vixLevel = vixy.c;
            vixChangePct = vixy.dp ?? null;
            console.log(`[tool] VIX from VIXY proxy: ${vixLevel}`);
          } else {
            console.warn(`[tool] All VIX sources failed`);
          }
        }

        const sectors = sectorsRaw
          .filter((s): s is NonNullable<typeof s> => s != null)
          .map((s) => ({
            symbol: s.symbol,
            price: s.price,
            change_pct: s.changesPercentage,
          }))
          .sort((a, b) => b.change_pct - a.change_pct);

        return {
          spy: spyData
            ? {
                price: spyData.price,
                change_pct: spyData.changesPercentage,
                day_high: spyData.dayHigh,
                day_low: spyData.dayLow,
              }
            : null,
          vix: vixLevel !== null
            ? { level: vixLevel, change_pct: vixChangePct }
            : null,
          sectors,
          // Tell the agent exactly what failed so it can adapt
          ...(errors.length > 0 ? { api_errors: errors, note: `Some data sources failed: ${errors.join("; ")}. Analyze what's available and proceed.` } : {}),
          _sources: [
            {
              provider: "Finnhub",
              title: "SPY Real-Time Quote",
              url: "https://finnhub.io/docs/api/quote",
              excerpt: spyData ? `SPY $${spyData.price} (${spyData.changesPercentage > 0 ? "+" : ""}${spyData.changesPercentage?.toFixed(2)}%)` : "SPY quote unavailable",
            },
            {
              provider: "Finnhub",
              title: "CBOE VIX Index",
              url: "https://finnhub.io/docs/api/quote",
              excerpt: vixLevel !== null ? `VIX at ${vixLevel.toFixed(1)}${vixChangePct != null ? ` (${vixChangePct > 0 ? "+" : ""}${vixChangePct.toFixed(1)}%)` : ""}` : "VIX data unavailable",
            },
            {
              provider: "Finnhub",
              title: "S&P 500 Sector ETF Performance",
              url: "https://finnhub.io/docs/api/quote",
              excerpt: sectors.length > 0
                ? `Top: ${sectors[0].symbol} ${sectors[0].change_pct > 0 ? "+" : ""}${sectors[0].change_pct?.toFixed(1)}% | Bottom: ${sectors[sectors.length - 1].symbol} ${sectors[sectors.length - 1].change_pct?.toFixed(1)}%`
                : "Sector data unavailable",
            },
          ],
        };
      },
    }),

    scan_candidates: tool({
      description:
        "Scan the market for trading candidates. Returns scored tickers from multiple sources: earnings calendar, market movers, gainers/losers, and social trends. Use sectors to filter.",
      inputSchema: scanParams,
      execute: async ({ sectors }: ScanInput) => {
        console.log(`[tool] scan_candidates sectors=${sectors?.join(",") ?? "all"} runId=${ctx.runId}`);
        const today = new Date().toISOString().slice(0, 10);
        const nextWeek = new Date(Date.now() + 7 * 86400_000)
          .toISOString()
          .slice(0, 10);

        const [earningsResult, gainersResult, losersResult, stTrending] = await Promise.all([
          finnhub(`/calendar/earnings?from=${today}&to=${nextWeek}`),
          fmp("/stock_market/gainers"),
          fmp("/stock_market/losers"),
          stocktwitsTrending(),
        ]);

        const earnings = earningsResult.data as Record<string, unknown> | null;
        const gainers = gainersResult.data as unknown[] | null;
        const losers = losersResult.data as unknown[] | null;

        // Watchlist (highest priority)
        const watchlistTickers = (ctx.watchlist ?? []).map((t) => ({
          ticker: t,
          source: "watchlist" as const,
          score: 4,
        }));

        // Earnings calendar
        const earningsTickers =
          (earnings as { earningsCalendar?: { symbol: string; date: string; epsEstimate: number | null }[] })
            ?.earningsCalendar
            ?.slice(0, 15)
            ?.map((e) => ({
              ticker: e.symbol,
              source: "earnings_calendar" as const,
              date: e.date,
              eps_estimate: e.epsEstimate,
              score: 3,
            })) ?? [];

        // Market movers
        const gainerTickers = Array.isArray(gainers)
          ? gainers
              .slice(0, 8)
              .map((m: unknown) => {
                const mov = m as { symbol: string; changesPercentage: number; price: number };
                return {
                  ticker: mov.symbol,
                  source: "top_gainers" as const,
                  change_pct: mov.changesPercentage,
                  price: mov.price,
                  score: 2,
                };
              })
          : [];

        const loserTickers = Array.isArray(losers)
          ? losers
              .slice(0, 5)
              .map((m: unknown) => {
                const mov = m as { symbol: string; changesPercentage: number; price: number };
                return {
                  ticker: mov.symbol,
                  source: "top_losers" as const,
                  change_pct: mov.changesPercentage,
                  price: mov.price,
                  score: 2,
                };
              })
          : [];

        // StockTwits trending
        const socialTickers = stTrending.map((t) => ({
          ticker: t,
          source: "stocktwits_trending" as const,
          score: 1,
        }));

        // Score & deduplicate
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

        const ranked = [...scoreMap.entries()]
          .sort((a, b) => b[1].score - a[1].score)
          .slice(0, 15);

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
            {
              provider: "Finnhub",
              title: "Earnings Calendar (Next 7 Days)",
              url: "https://finnhub.io/docs/api/earnings-calendar",
              excerpt: earningsOut.length > 0 ? `${earningsOut.length} upcoming: ${earningsOut.slice(0, 3).map((e) => e.ticker).join(", ")}` : "No upcoming earnings",
            },
            {
              provider: "FMP",
              title: "Top Gainers & Losers",
              url: "https://financialmodelingprep.com/api/v3/stock_market/gainers",
              excerpt: `${gainerTickers.length} gainers, ${loserTickers.length} losers scanned`,
            },
            {
              provider: "StockTwits",
              title: "Trending Symbols",
              url: "https://stocktwits.com/rankings/trending",
              excerpt: stTrending.length > 0 ? `Trending: ${stTrending.slice(0, 5).join(", ")}` : "No trending data",
            },
            ...(ctx.watchlist?.length
              ? [{
                  provider: "Watchlist",
                  title: "Custom Watchlist",
                  excerpt: `Watching: ${ctx.watchlist.join(", ")}`,
                }]
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
        console.log(`[tool] get_stock_data ticker=${ticker} runId=${ctx.runId}`);
        const [quoteResult, profileResult, financialsResult, newsResult, recsResult] =
          await Promise.all([
            finnhub(`/quote?symbol=${ticker}`),
            finnhub(`/stock/profile2?symbol=${ticker}`),
            finnhub(`/stock/metric?symbol=${ticker}&metric=all`),
            finnhub(
              `/company-news?symbol=${ticker}&from=${new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`,
            ),
            finnhub(`/stock/recommendation?symbol=${ticker}`),
          ]);

        const quote = quoteResult.data as Record<string, number> | null;
        const profile = profileResult.data as Record<string, unknown> | null;
        const financials = financialsResult.data as { metric?: Record<string, unknown> } | null;
        const news = newsResult.data;
        const recommendations = recsResult.data;

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
          ? (recommendations as Record<string, number>[])[0]
          : null;

        // Collect errors for the agent
        const errors: string[] = [];
        if (quoteResult.error) errors.push(quoteResult.error);
        if (profileResult.error) errors.push(profileResult.error);
        if (financialsResult.error) errors.push(financialsResult.error);

        return {
          quote: quote && quote.c
            ? {
                price: quote.c,
                change: quote.d,
                change_pct: quote.dp,
                high: quote.h,
                low: quote.l,
                open: quote.o,
                prev_close: quote.pc,
              }
            : null,
          company: profile && profile.name
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
                buy: latestRec.buy,
                hold: latestRec.hold,
                sell: latestRec.sell,
                strong_buy: latestRec.strongBuy,
                strong_sell: latestRec.strongSell,
              }
            : null,
          news: recentNews,
          ...(errors.length > 0 ? { api_errors: errors } : {}),
          _sources: [
            {
              provider: "Finnhub",
              title: `${ticker} Real-Time Quote`,
              url: "https://finnhub.io/docs/api/quote",
              excerpt: quote && quote.c ? `$${quote.c} ${quote.dp > 0 ? "+" : ""}${quote.dp?.toFixed(2)}% | High $${quote.h} Low $${quote.l}` : "Quote unavailable",
            },
            {
              provider: "Finnhub",
              title: `${ticker} Company Profile`,
              url: "https://finnhub.io/docs/api/company-profile2",
              excerpt: profile && profile.name ? `${profile.name} | ${profile.finnhubIndustry} | ${profile.exchange}` : "Profile unavailable",
            },
            {
              provider: "Finnhub",
              title: `${ticker} Key Financials`,
              url: "https://finnhub.io/docs/api/company-basic-financials",
              excerpt: financials?.metric
                ? `P/E ${(financials.metric.peNormalizedAnnual as number | null)?.toFixed(1) ?? "—"} | Beta ${(financials.metric.beta as number | null)?.toFixed(2) ?? "—"} | 52W $${(financials.metric["52WeekLow"] as number | null)?.toFixed(0) ?? "?"}-$${(financials.metric["52WeekHigh"] as number | null)?.toFixed(0) ?? "?"}`
                : "Financials unavailable",
            },
            ...(latestRec
              ? [{
                  provider: "Finnhub",
                  title: `${ticker} Analyst Consensus`,
                  url: "https://finnhub.io/docs/api/recommendation-trends",
                  excerpt: `Buy ${latestRec.buy + latestRec.strongBuy} | Hold ${latestRec.hold} | Sell ${latestRec.sell + latestRec.strongSell}`,
                }]
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
        console.log(`[tool] get_technical_analysis ticker=${ticker} runId=${ctx.runId}`);
        const now = Math.floor(Date.now() / 1000);
        const from = now - 90 * 86400;

        // Try Finnhub first, fall back to FMP for historical prices
        let priceProvider = "Finnhub";
        const candleResult = await finnhub(
          `/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${now}`,
        );
        let candles = candleResult.data as { s?: string; c?: number[]; v?: number[] } | null;

        if (!candles || candles.s !== "ok" || !candles.c?.length) {
          // Fallback: try FMP historical prices
          priceProvider = "FMP";
          const fmpResult = await fmp(
            `/historical-price-full/${ticker}?timeseries=90`,
          );
          const fmpHistory = fmpResult.data as { historical?: { close: number; volume: number }[] } | null;
          if (fmpHistory?.historical?.length) {
            const sorted = fmpHistory.historical.reverse();
            candles = {
              s: "ok",
              c: sorted.map((d) => d.close),
              v: sorted.map((d) => d.volume),
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
            {
              provider: priceProvider,
              title: `${ticker} 90-Day Price History`,
              url: priceProvider === "Finnhub"
                ? "https://finnhub.io/docs/api/stock-candles"
                : `https://financialmodelingprep.com/financial-statements/${ticker}`,
              excerpt: `RSI ${rsi?.toFixed(1) ?? "—"} | SMA20 $${sma20?.toFixed(2) ?? "—"} | SMA50 $${sma50?.toFixed(2) ?? "—"} | 52W position ${position52w}%`,
            },
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
            _sources: [{
              provider: "Reddit",
              title: `${ticker} Reddit Sentiment (Blocked)`,
              url: `https://www.reddit.com/search/?q=${ticker}&sort=new`,
              excerpt: "Reddit API returned 403/429 — IP-based rate limiting active",
            }],
          };
        }

        if (data.mention_count === 0) {
          return {
            available: false,
            reason: "no_mentions",
            note: `No recent Reddit mentions found for ${ticker}. This doesn't necessarily mean anything negative — some stocks simply aren't discussed on Reddit.`,
            _sources: [{
              provider: "Reddit",
              title: `${ticker} Reddit Search (No Results)`,
              url: `https://www.reddit.com/search/?q=${ticker}&sort=new`,
              excerpt: "No mentions found in r/wallstreetbets, r/stocks, r/options, r/investing",
            }],
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
          _sources: data.top_posts.map((p) => ({
            provider: `Reddit r/${p.subreddit}`,
            title: p.title,
            url: p.url,
          })),
        };
      },
    }),

    get_twitter_sentiment: tool({
      description:
        "Get Twitter/X social sentiment for a stock. Shows trending status, sentiment direction, recent social posts, and watchlist popularity from StockTwits + FMP social data.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        const data = await twitterSentiment(ticker);

        if (!data.available) {
          return {
            available: false,
            note: `No Twitter/social data available for ${ticker}. The stock may not be actively discussed on social media.`,
            _sources: [{
              provider: "StockTwits",
              title: `${ticker} Social Feed (No Data)`,
              url: `https://stocktwits.com/symbol/${ticker.toUpperCase()}`,
              excerpt: "No social sentiment data found",
            }],
          };
        }

        return {
          available: true,
          mention_count: data.mention_count,
          sentiment: data.sentiment,
          sentiment_score: data.sentiment_score,
          trending: data.trending,
          watchlist_count: data.watchlist_count,
          posts: data.posts.map((p) => ({
            body: p.body,
            username: p.username,
            created_at: p.created_at,
            likes: p.likes,
          })),
          fmp_sentiment: data.fmp_sentiment,
          _sources: [
            {
              provider: "StockTwits",
              title: `${ticker} Social Feed`,
              url: `https://stocktwits.com/symbol/${ticker.toUpperCase()}`,
              excerpt: `${data.mention_count} posts, sentiment: ${data.sentiment}`,
            },
            ...(data.fmp_sentiment ? [{
              provider: "FMP Social",
              title: `${ticker} Twitter/Social Sentiment`,
              url: `https://financialmodelingprep.com/api/v4/historical/social-sentiment?symbol=${ticker}`,
              excerpt: `Sentiment score: ${data.fmp_sentiment.sentiment.toFixed(2)}, ${data.fmp_sentiment.mentions} mentions`,
            }] : []),
          ],
        };
      },
    }),

    get_options_flow: tool({
      description:
        "Get unusual options activity for a stock: put/call ratio, unusual volume contracts, and implied volatility signals.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        // Primary: FMP options chain
        const fmpResult = await fmp(`/options/chain/${ticker.toUpperCase()}`);
        const fmpData = fmpResult.data;

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

          for (const contract of fmpData) {
            const ctype = (contract.type ?? "").toUpperCase();
            const vol = Number(contract.volume ?? 0);
            const oi = Number(contract.openInterest ?? 0);
            const lastPrice = Number(contract.lastPrice ?? 0);

            if (ctype === "CALL") totalCallVol += vol;
            else if (ctype === "PUT") totalPutVol += vol;

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
              {
                provider: "FMP",
                title: `${ticker} Options Chain`,
                url: `https://financialmodelingprep.com/api/v3/options/chain/${ticker}`,
                excerpt: `P/C ratio ${totalCallVol > 0 ? (totalPutVol / totalCallVol).toFixed(2) : "—"} | ${totalCallVol.toLocaleString()} calls / ${totalPutVol.toLocaleString()} puts | ${unusualContracts.length} unusual contracts`,
              },
            ],
          };
        }

        // Fallback: Finnhub option chain
        const expDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
        const finnhubResult = await finnhub(
          `/stock/option-chain?symbol=${ticker}&expiration=${expDate}`,
        );
        const finnhubData = finnhubResult.data as { data?: { options?: { CALL?: { volume: number }[]; PUT?: { volume: number }[] }; expirationDate?: string }[] } | null;

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
              {
                provider: "Finnhub",
                title: `${ticker} Options Chain`,
                url: "https://finnhub.io/docs/api/stock-option-chain",
                excerpt: `P/C ratio ${totalCallVol > 0 ? (totalPutVol / totalCallVol).toFixed(2) : "—"} | ${calls.length} calls / ${puts.length} puts`,
              },
            ],
          };
        }

        return {
          available: false,
          note: `No options data available for ${ticker}. This may be a smaller-cap stock without liquid options, or the options data providers may be temporarily unavailable.`,
          _sources: [
            {
              provider: "Finnhub",
              title: `${ticker} Options Chain (No Data)`,
              url: "https://finnhub.io/docs/api/stock-option-chain",
              excerpt: "No options contracts found — may be small-cap or illiquid",
            },
          ],
        };
      },
    }),

    get_earnings_data: tool({
      description:
        "Get earnings estimates, historical beat rate, and upcoming earnings date for a stock.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        const [earningsResult, surprisesResult] = await Promise.all([
          finnhub(`/calendar/earnings?symbol=${ticker}`),
          finnhub(`/stock/earnings?symbol=${ticker}&limit=8`),
        ]);

        const earnings = earningsResult.data as { earningsCalendar?: { date: string; epsEstimate: number | null }[] } | null;
        const surprises = surprisesResult.data;

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
            {
              provider: "Finnhub",
              title: `${ticker} Earnings Calendar`,
              url: "https://finnhub.io/docs/api/earnings-calendar",
              excerpt: upcoming ? `Next earnings: ${upcoming.date}${upcoming.epsEstimate != null ? ` (est. $${upcoming.epsEstimate})` : ""}` : "No upcoming earnings date",
            },
            {
              provider: "Finnhub",
              title: `${ticker} Earnings History`,
              url: "https://finnhub.io/docs/api/company-earnings",
              excerpt: history.length > 0
                ? `Beat rate: ${Math.round((beats.length / history.length) * 100)}% over ${history.length} quarters`
                : "No earnings history available",
            },
          ],
        };
      },
    }),

    show_thesis: tool({
      description:
        "Display your research thesis as a formatted card. Call this after you've completed your analysis of a ticker to present your findings. The thesis will be saved to the database.",
      inputSchema: thesisParams,
      execute: async (args: ThesisInput) => {
        console.log(`[tool] show_thesis ticker=${args.ticker} direction=${args.direction} confidence=${args.confidence_score} runId=${ctx.runId}`);
        try {
          const thesis = await prisma.thesis.create({
            data: {
              researchRunId: ctx.runId,
              userId: ctx.userId,
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
              sourcesUsed: [],
              source: "AGENT",
              modelUsed: "gpt-4o",
            },
          });

          // Persist RunEvent so thesis is visible on page reload
          if (ctx.runId) {
            const evType = args.direction === "PASS" ? "skip" : "thesis_complete";
            await prisma.runEvent.create({
              data: {
                runId: ctx.runId,
                type: evType,
                title:
                  evType === "skip"
                    ? `Passing on ${args.ticker}`
                    : `Thesis complete for ${args.ticker}`,
                message: args.reasoning_summary,
                payload: {
                  ticker: args.ticker,
                  thesis: {
                    ticker: args.ticker,
                    direction: args.direction,
                    confidence_score: args.confidence_score,
                    reasoning_summary: args.reasoning_summary,
                    thesis_bullets: args.thesis_bullets,
                    risk_flags: args.risk_flags,
                    entry_price: args.entry_price,
                    target_price: args.target_price,
                    stop_loss: args.stop_loss,
                    hold_duration: args.hold_duration,
                    signal_types: args.signal_types,
                  },
                  ...(evType === "skip"
                    ? { reason: args.reasoning_summary, confidence: args.confidence_score }
                    : {}),
                } as object,
              },
            });
          }

          return { ...args, thesis_id: thesis.id };
        } catch {
          return args;
        }
      },
    }),

    place_trade: tool({
      description:
        "Place a paper trade on Alpaca. Only call this after presenting a thesis and explaining your reasoning. The trade will be executed immediately.",
      inputSchema: tradeParams,
      execute: async (args: TradeInput) => {
        console.log(`[tool] place_trade ticker=${args.ticker} direction=${args.direction} shares=${args.shares} runId=${ctx.runId}`);

        try {
          // 1. Place Alpaca paper order
          const alpacaOrder = await placeMarketOrder({
            symbol: args.ticker,
            qty: args.shares,
            side: args.direction === "LONG" ? "buy" : "sell",
          });
          console.log(`[tool] place_trade Alpaca order placed: ${alpacaOrder.id}`);

          // 2. Wait for fill (max 10s), fall back to entry price
          let fillPrice = args.entry_price;
          const deadline = Date.now() + 10_000;
          while (Date.now() < deadline) {
            const order = await getOrder(alpacaOrder.id);
            if (order.status === "filled" && order.filled_avg_price) {
              fillPrice = parseFloat(order.filled_avg_price);
              break;
            }
            if (["cancelled", "expired", "rejected"].includes(order.status)) {
              throw new Error(`Alpaca order ${order.status}`);
            }
            await new Promise((r) => setTimeout(r, 1_000));
          }
          // If still not filled, try latest price
          if (fillPrice === args.entry_price) {
            try { fillPrice = await getLatestPrice(args.ticker); } catch { /* keep entry_price */ }
          }

          // 3. Create Trade in DB
          const trade = await prisma.trade.create({
            data: {
              thesisId: args.thesis_id ?? null,
              userId: ctx.userId,
              ticker: args.ticker,
              direction: args.direction,
              status: "OPEN",
              entryPrice: fillPrice,
              shares: args.shares,
              targetPrice: args.target_price,
              stopLoss: args.stop_loss,
              exitStrategy: "PRICE_TARGET",
              alpacaOrderId: alpacaOrder.id,
            },
          });

          // 4. Write PLACED TradeEvent
          await prisma.tradeEvent.create({
            data: {
              tradeId: trade.id,
              eventType: "PLACED",
              description: `${args.direction} ${args.shares} shares of ${args.ticker} at $${fillPrice.toFixed(2)}`,
              priceAt: fillPrice,
            },
          });

          // 5. Write RunEvent so trade is visible on run page
          if (ctx.runId) {
            await prisma.runEvent.create({
              data: {
                runId: ctx.runId,
                type: "trade_placed",
                title: `Trade placed: ${args.direction} ${args.ticker}`,
                message: `${args.direction} ${args.shares} shares of ${args.ticker} at $${fillPrice.toFixed(2)}`,
                payload: {
                  ticker: args.ticker,
                  direction: args.direction,
                  entry: fillPrice,
                  target_price: args.target_price,
                  stop_loss: args.stop_loss,
                  shares: args.shares,
                  trade_id: trade.id,
                } as object,
              },
            });
          }

          console.log(`[tool] place_trade SUCCESS trade=${trade.id} fill=$${fillPrice.toFixed(2)}`);
          return {
            ...args,
            status: "filled" as const,
            fill_price: fillPrice,
            trade_id: trade.id,
            alpaca_order_id: alpacaOrder.id,
            note: `Trade executed: ${args.direction} ${args.shares} shares of ${args.ticker} at $${fillPrice.toFixed(2)}`,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Trade placement failed";
          console.error(`[tool] place_trade FAILED for ${args.ticker}: ${msg}`);
          return {
            ...args,
            status: "failed" as const,
            error: msg,
            note: `Trade failed: ${msg}. The thesis has been saved but no position was opened.`,
          };
        }
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
        console.log(`[tool] summarize_run picks=${args.ranked_picks.length} runId=${ctx.runId}`);
        // Mark the run as complete + persist summary as RunEvent
        try {
          const traded = args.ranked_picks.filter((p) => p.action === "TRADE").length;
          await prisma.researchRun.update({
            where: { id: ctx.runId },
            data: {
              status: "COMPLETE",
              completedAt: new Date(),
            },
          });

          // Write run_summary + run_complete events for reload persistence
          if (ctx.runId) {
            await prisma.runEvent.create({
              data: {
                runId: ctx.runId,
                type: "run_summary",
                title: "Run Summary",
                message: args.overall_assessment,
                payload: {
                  summary: args.market_summary,
                  ranked_picks: args.ranked_picks,
                  risk_notes: args.risk_notes,
                  overall_assessment: args.overall_assessment,
                } as object,
              },
            });
            await prisma.runEvent.create({
              data: {
                runId: ctx.runId,
                type: "run_complete",
                title: `Run complete — ${args.ranked_picks.length} analyzed, ${traded} traded`,
                message: null,
                payload: {
                  analyzed: args.ranked_picks.length,
                  recommended: args.ranked_picks.filter((p) => p.action !== "PASS").length,
                  placed: traded,
                } as object,
              },
            });
          }
        } catch {
          // Non-fatal
        }
        return args;
      },
    }),
    // ── DAV-167: Extended data tools ──────────────────────────────────────

    get_sec_filings: tool({
      description:
        "Fetch recent SEC filings (10-K, 10-Q, 8-K, Form 4) for a stock from EDGAR. " +
        "Use this to check for recent regulatory filings, insider transactions, or material events.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
      }),
      execute: async (args) => {
        try {
          const res = await fetch(
            `https://data.sec.gov/submissions/CIK${await getCIK(args.symbol)}.json`,
            {
              headers: {
                "User-Agent": "Hindsight Research Bot research@hindsight.app",
                Accept: "application/json",
              },
            }
          );
          if (!res.ok) return { filings: [], error: `SEC returned ${res.status}` };
          const data = (await res.json()) as {
            filings?: {
              recent?: {
                form?: string[];
                filingDate?: string[];
                primaryDocDescription?: string[];
                accessionNumber?: string[];
                primaryDocument?: string[];
              };
            };
          };
          const recent = data.filings?.recent;
          if (!recent) return { filings: [] };

          const relevantTypes = new Set(["10-K", "10-Q", "8-K", "S-1", "DEF 14A", "4"]);
          const filings: { type: string; date: string; description: string }[] = [];
          const forms = recent.form ?? [];
          const dates = recent.filingDate ?? [];
          const descs = recent.primaryDocDescription ?? [];

          for (let i = 0; i < Math.min(forms.length, 50); i++) {
            if (!relevantTypes.has(forms[i])) continue;
            filings.push({
              type: forms[i],
              date: dates[i] ?? "",
              description: descs[i] ?? forms[i],
            });
            if (filings.length >= 8) break;
          }
          return { filings, count: filings.length };
        } catch (err) {
          return { filings: [], error: err instanceof Error ? err.message : "Failed" };
        }
      },
    }),

    get_analyst_targets: tool({
      description:
        "Fetch analyst price target consensus for a stock — consensus target, high, low, " +
        "and number of analysts. Use to validate entry/target price levels.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol, e.g. NVDA"),
      }),
      execute: async (args) => {
        const { data, error } = await fmp(
          `/v4/price-target-consensus?symbol=${args.symbol}`
        );
        if (error || !data) return { targets: null, error };
        const arr = data as { targetConsensus?: number; targetHigh?: number; targetLow?: number; targetMedian?: number; numberOfAnalysts?: number }[];
        if (!Array.isArray(arr) || arr.length === 0) return { targets: null };
        const c = arr[0];
        return {
          targets: {
            consensus: c.targetConsensus,
            high: c.targetHigh,
            low: c.targetLow,
            median: c.targetMedian,
            num_analysts: c.numberOfAnalysts,
          },
        };
      },
    }),

    get_company_peers: tool({
      description:
        "Fetch peer/competitor companies for a stock with basic comparison metrics. " +
        "Use for sector alternative analysis and relative valuation.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol, e.g. MSFT"),
      }),
      execute: async (args) => {
        // Get peers from Finnhub
        const { data: peersData, error: peersErr } = await finnhub(
          `/stock/peers?symbol=${args.symbol}`
        );
        if (peersErr || !peersData) return { peers: [], error: peersErr };

        const peers = (peersData as string[])
          .filter((p) => p.toUpperCase() !== args.symbol.toUpperCase())
          .slice(0, 6);

        if (peers.length === 0) return { peers: [] };

        // Get quotes for peers from Finnhub (FMP /quote/ is deprecated)
        const peerQuotes = await Promise.all(
          peers.map(async (sym) => {
            const [qRes, fRes] = await Promise.all([
              finnhub(`/quote?symbol=${sym}`),
              finnhub(`/stock/metric?symbol=${sym}&metric=all`),
            ]);
            const q = qRes.data as Record<string, number> | null;
            const f = (fRes.data as Record<string, unknown>)?.metric as Record<string, number> | undefined;
            return {
              ticker: sym,
              name: sym,
              price: q?.c ?? null,
              change_pct: q?.dp ?? null,
              pe_ratio: f?.peNormalizedAnnual ?? null,
              market_cap: f?.marketCapitalization ?? null,
            };
          })
        );

        return { peers: peerQuotes };
      },
    }),

    get_news_deep_dive: tool({
      description:
        "Fetch comprehensive news for a stock from multiple sources: stock-specific news, " +
        "press releases, and general market articles. More thorough than basic news.",
      inputSchema: z.object({
        symbol: z.string().describe("Ticker symbol, e.g. TSLA"),
      }),
      execute: async (args) => {
        const [stockNews, pressReleases] = await Promise.all([
          fmp(`/stock_news?tickers=${args.symbol}&limit=10`),
          fmp(`/press-releases/${args.symbol}?limit=5`),
        ]);

        const news = (
          (stockNews.data as { title?: string; text?: string; site?: string; url?: string; publishedDate?: string }[]) ?? []
        ).map((item) => ({
          headline: item.title ?? "",
          summary: (item.text ?? "").slice(0, 200),
          source: item.site ?? "",
          url: item.url ?? "",
          date: item.publishedDate ?? "",
        }));

        const prs = (
          (pressReleases.data as { title?: string; text?: string; date?: string }[]) ?? []
        ).map((item) => ({
          headline: item.title ?? "",
          summary: (item.text ?? "").slice(0, 200),
          date: item.date ?? "",
        }));

        return {
          stock_news: news,
          press_releases: prs,
          total: news.length + prs.length,
        };
      },
    }),
  };
}

// Helper: look up CIK from ticker for SEC EDGAR
async function getCIK(ticker: string): Promise<string> {
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: {
      "User-Agent": "Hindsight Research Bot research@hindsight.app",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`SEC tickers lookup failed: ${res.status}`);
  const data = (await res.json()) as Record<
    string,
    { cik_str: number; ticker: string }
  >;
  for (const entry of Object.values(data)) {
    if (entry.ticker.toUpperCase() === ticker.toUpperCase()) {
      return String(entry.cik_str).padStart(10, "0");
    }
  }
  throw new Error(`No CIK found for ${ticker}`);
}

// Backwards-compatible export for existing code that doesn't pass context
export const researchAgentTools = createResearchTools({
  runId: "",
  userId: "",
});
