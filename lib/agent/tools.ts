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
type TransactionClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;
import { placeMarketOrder, getOrder, getLatestPrice, getBars } from "@/lib/alpaca";
import type { MarketOverviewResult, MarketContextResult, MacroEvent, SectorQuote, EarningsDensity, ScanCandidatesResult, ScanCandidate, MarketTheme, ThemeDirection, DetectMarketThemesResult, ToolSource } from "@/lib/discovery/types";
import { THEME_DEFINITIONS } from "@/lib/discovery/types";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;
const FMP_KEY = process.env.FMP_API_KEY!;

// ── API call tracking (per-run visibility) ──────────────────────────────────

interface ApiCallStats {
  finnhub: number;
  fmp: number;
  other: number;
  errors: number;
  startTime: number;
  summary(): string;
}

function createApiCallStats(): ApiCallStats {
  return {
    finnhub: 0,
    fmp: 0,
    other: 0,
    errors: 0,
    startTime: Date.now(),
    summary() {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      return `finnhub=${this.finnhub} fmp=${this.fmp} other=${this.other} errors=${this.errors} elapsed=${elapsed}s`;
    },
  };
}

// Default stats for backwards-compat (module-level callers)
const defaultStats = createApiCallStats();

// Per-request timeout to prevent hung fetches from stalling the agent
const API_TIMEOUT_MS = 10_000; // 10 seconds per request

// ── API helpers (with logging + error detail + timeouts) ─────────────────────

// 5-minute in-memory response cache for Finnhub
const finnhubCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Soft concurrency limit to avoid bursting past Finnhub 60/min rate limit
let finnhubInFlight = 0;
const FINNHUB_MAX_CONCURRENT = 5;

async function finnhubThrottle(): Promise<void> {
  while (finnhubInFlight >= FINNHUB_MAX_CONCURRENT) {
    await new Promise(r => setTimeout(r, 100));
  }
  finnhubInFlight++;
}

function finnhubRelease(): void {
  finnhubInFlight--;
}

async function finnhub(path: string, retries = 2, stats: ApiCallStats = defaultStats): Promise<{ data: unknown; error?: string }> {
  // Check cache first
  const cached = finnhubCache.get(path);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return { data: cached.data };
  }

  const url = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${FINNHUB_KEY}`;
  const endpoint = path.split("?")[0];
  stats.finnhub++;

  await finnhubThrottle();
  try {
    let t0 = Date.now();
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        t0 = Date.now();
        const res = await fetch(url, {
          next: { revalidate: 300 },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        });
        const elapsed = Date.now() - t0;
        if (res.status === 429) {
          if (attempt < retries) {
            console.warn(`[finnhub] 429 on ${endpoint}, retry ${attempt + 1}/${retries} after 1s`);
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          stats.errors++;
          const msg = `Finnhub ${endpoint} rate limited (429) after ${retries} retries`;
          console.warn(`[finnhub] ${msg}`);
          return { data: null, error: msg };
        }
        if (!res.ok) {
          stats.errors++;
          const msg = `Finnhub ${endpoint} returned ${res.status} (${elapsed}ms)`;
          console.warn(`[finnhub] ${msg}`);
          return { data: null, error: msg };
        }
        if (elapsed > 3000) {
          console.warn(`[finnhub] SLOW ${endpoint} took ${elapsed}ms`);
        }
        const json = await res.json();
        finnhubCache.set(path, { data: json, ts: Date.now() });
        return { data: json };
      } catch (err) {
        if (attempt < retries) {
          console.warn(`[finnhub] ${endpoint} fetch error, retry ${attempt + 1}/${retries}`);
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        stats.errors++;
        const elapsed = Date.now() - t0;
        const isTimeout = err instanceof Error && err.name === "TimeoutError";
        const msg = isTimeout
          ? `Finnhub ${endpoint} TIMEOUT after ${elapsed}ms`
          : `Finnhub ${endpoint} fetch failed (${elapsed}ms): ${err instanceof Error ? err.message : "unknown"}`;
        console.error(`[finnhub] ${msg}`);
        return { data: null, error: msg };
      }
    }
    return { data: null, error: `Finnhub ${endpoint} exhausted retries` };
  } finally {
    finnhubRelease();
  }
}

async function fmp(path: string, stats: ApiCallStats = defaultStats): Promise<{ data: unknown; error?: string }> {
  // Support both v3 and v4 paths: if path starts with /v4/, use it directly
  const base = path.startsWith("/v4/")
    ? `https://financialmodelingprep.com/api${path}`
    : `https://financialmodelingprep.com/api/v3${path}`;
  const url = `${base}${path.includes("?") ? "&" : "?"}apikey=${FMP_KEY}`;
  const endpoint = path.split("?")[0];
  const t0 = Date.now();
  stats.fmp++;
  try {
    const res = await fetch(url, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const elapsed = Date.now() - t0;
    if (!res.ok) {
      stats.errors++;
      const body = await res.text().catch(() => "");
      const msg = `FMP ${endpoint} returned ${res.status} (${elapsed}ms): ${body.slice(0, 200)}`;
      console.warn(`[fmp] ${msg}`);
      return { data: null, error: msg };
    }
    if (elapsed > 3000) {
      console.warn(`[fmp] SLOW ${endpoint} took ${elapsed}ms`);
    }
    const data = await res.json();
    // FMP returns { "Error Message": "..." } on bad API key or invalid endpoint
    if (data && typeof data === "object" && !Array.isArray(data) && "Error Message" in data) {
      stats.errors++;
      const msg = `FMP ${endpoint}: ${(data as Record<string, string>)["Error Message"]}`;
      console.warn(`[fmp] ${msg}`);
      return { data: null, error: msg };
    }
    // FMP sometimes returns empty array for valid-but-unsupported symbols
    if (Array.isArray(data) && data.length === 0) {
      console.warn(`[fmp] ${endpoint} returned empty array`);
    }
    return { data };
  } catch (err) {
    stats.errors++;
    const elapsed = Date.now() - t0;
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    const msg = isTimeout
      ? `FMP ${endpoint} TIMEOUT after ${elapsed}ms`
      : `FMP ${endpoint} fetch failed (${elapsed}ms): ${err instanceof Error ? err.message : "unknown"}`;
    console.error(`[fmp] ${msg}`);
    return { data: null, error: msg };
  }
}

// ── Reddit (shared client in lib/reddit.ts) ──
import {
  getRedditSentiment,
  discoverTrendingTickers,
  type RedditSentimentResult,
} from "@/lib/reddit";

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

// ── Date formatting helper ───────────────────────────────────────────────────

function formatShortDate(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Sector filtering helper ──────────────────────────────────────────────────


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
  theme_filter: z
    .string()
    .optional()
    .describe("Theme name from get_market_context to boost matching tickers (e.g. 'AI Infrastructure')"),
  min_market_cap: z
    .number()
    .optional()
    .describe("Minimum market cap in dollars (default $1B). Filters out micro-caps."),
  min_avg_volume: z
    .number()
    .optional()
    .describe("Minimum 10-day average volume (default 500K). Filters out illiquid stocks."),
});
const thesisParams = z.object({
  ticker: z.string(),
  company_name: z.string().optional().describe("Company name from get_stock_data"),
  exchange: z.string().optional().describe("Exchange from get_stock_data, e.g. NASDAQ"),
  direction: z.enum(["LONG", "SHORT", "PASS"]),
  confidence_score: z.number().min(0).max(100),
  reasoning_summary: z
    .string()
    .describe("2-3 sentence summary of your thesis. For PASS: explain what you found AND why it doesn't fit your strategy right now."),
  thesis_bullets: z
    .array(z.string())
    .describe("3-5 key points supporting the thesis. For PASS: include what you learned, why it doesn't fit, and what would change your mind."),
  risk_flags: z.array(z.string()).describe("2-4 key risks. For PASS: note the risks that made you pass."),
  entry_price: z.number().optional(),
  target_price: z.number().optional(),
  stop_loss: z.number().optional(),
  hold_duration: z.enum(["DAY", "SWING", "POSITION"]),
  signal_types: z
    .array(z.string())
    .describe("Signal types: MOMENTUM, EARNINGS_BEAT, BREAKOUT, etc."),
  sources_used: z
    .array(
      z.object({
        provider: z.string(),
        title: z.string(),
        url: z.string().optional(),
        excerpt: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      "Data sources used in your research — collect the _sources arrays from all tool calls for this ticker",
    ),
});
const tradeParams = z.object({
  ticker: z.string(),
  company_name: z.string().optional().describe("Company name from get_stock_data"),
  exchange: z.string().optional().describe("Exchange from get_stock_data, e.g. NASDAQ"),
  direction: z.enum(["LONG", "SHORT"]),
  entry_price: z.number(),
  target_price: z.number(),
  stop_loss: z.number(),
  shares: z.number().describe("Number of shares to buy/sell"),
  thesis_id: z
    .string()
    .describe("REQUIRED — the thesis_id returned by show_thesis. Every trade must link to a thesis."),
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
  analystId?: string;       // FK to AgentConfig — needed for Position + TradeDecision
  watchlist?: string[];
  exclusionList?: string[];
  sectors?: string[];
  maxPositionSize?: number;
}

// ── Tool timing helpers ─────────────────────────────────────────────────────

function logToolStart(name: string, runId: string, extra?: string, stats: ApiCallStats = defaultStats) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[tool] ${ts} START ${name} runId=${runId}${extra ? ` ${extra}` : ""} | API calls so far: ${stats.summary()}`);
}

function logToolEnd(name: string, t0: number, runId: string, extra?: string, stats: ApiCallStats = defaultStats) {
  const elapsed = Date.now() - t0;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[tool] ${ts} END ${name} ${elapsed}ms runId=${runId}${extra ? ` ${extra}` : ""} | API totals: ${stats.summary()}`);
  if (elapsed > 15000) {
    console.warn(`[tool] SLOW TOOL: ${name} took ${(elapsed / 1000).toFixed(1)}s`);
  }
}

// ── Factory: creates tools with context ─────────────────────────────────────

export function createResearchTools(ctx: ToolContext) {
  // Per-run stats — each run gets its own counters (no shared mutable state)
  const stats = createApiCallStats();
  console.log(`[tools] Creating research tools for runId=${ctx.runId} analystId=${ctx.analystId ?? "none"}`);

  return {
    get_market_context: tool({
      description:
        "Get current market conditions: S&P 500, VIX, sector ETF performance, and dominant market themes/narratives. Call this first to understand the market environment and what stories are driving capital flows.",
      inputSchema: emptyParams,
      execute: async (): Promise<MarketContextResult> => {
        const _t0 = Date.now();
        logToolStart("get_market_context", ctx.runId, undefined, stats);
        const errors: string[] = [];

        const today = new Date().toISOString().slice(0, 10);
        const now = Math.floor(Date.now() / 1000);
        const thirtyDaysAgo = now - 30 * 86400;
        const fiveDaysForward = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);

        // Use Finnhub as primary for all quotes (FMP /quote/ is deprecated)
        const SECTOR_ETFS = ["XLK", "XLF", "XLV", "XLY", "XLP", "XLE", "XLI", "XLB", "XLRE", "XLU", "XLC"];

        // Fetch SPY + all sector ETFs from Finnhub in parallel,
        // plus SPY candles, macro calendar, and earnings density
        const allSymbols = ["SPY", ...SECTOR_ETFS];
        const [quoteResults, spyCandleResult, macroCalResult, earningsDensityResult, generalNewsResult] = await Promise.all([
          // All quotes in parallel
          Promise.all(
            allSymbols.map(async (sym) => {
              const res = await finnhub(`/quote?symbol=${sym}`, 2, stats);
              const d = res.data as Record<string, number> | null;
              if (d && typeof d.c === "number" && d.c > 0) {
                return { symbol: sym, price: d.c, changesPercentage: d.dp ?? 0, dayHigh: d.h ?? d.c, dayLow: d.l ?? d.c };
              }
              if (res.error) errors.push(res.error);
              return null;
            })
          ),
          // SPY 30-day candles for SMA-20 + regime
          finnhub(`/stock/candle?symbol=SPY&resolution=D&from=${thirtyDaysAgo}&to=${now}`, 2, stats),
          // FMP economic calendar for macro events today
          fmp(`/economic_calendar?from=${today}&to=${today}`, stats),
          // Finnhub earnings calendar for next 5 days
          finnhub(`/calendar/earnings?from=${today}&to=${fiveDaysForward}`, 2, stats),
          // Finnhub general news for inline theme detection
          finnhub(`/news?category=general&minId=0`, 2, stats),
        ]);

        const spyData = quoteResults[0];
        const sectorsRaw = quoteResults.slice(1).filter(Boolean);

        console.log(`[tool] get_market_context SPY=${spyData ? `$${spyData.price}` : "null"} sectors=${sectorsRaw.length}`);

        // VIX: Finnhub first, then VIXY fallback
        let vixLevel: number | null = null;
        let vixChangePct: number | null = null;

        const vixFinnhubResult = await finnhub(`/quote?symbol=${encodeURIComponent("^VIX")}`, 2, stats);
        const vixFinnhub = vixFinnhubResult.data as Record<string, number> | null;
        if (vixFinnhub && typeof vixFinnhub.c === "number" && vixFinnhub.c > 0) {
          vixLevel = vixFinnhub.c;
          vixChangePct = vixFinnhub.dp ?? null;
          console.log(`[tool] VIX from Finnhub: ${vixLevel}`);
        } else {
          // Fallback: VIXY ETF via Finnhub
          const vixyResult = await finnhub("/quote?symbol=VIXY", 2, stats);
          const vixy = vixyResult.data as Record<string, number> | null;
          if (vixy && typeof vixy.c === "number" && vixy.c > 0) {
            vixLevel = vixy.c;
            vixChangePct = vixy.dp ?? null;
            console.log(`[tool] VIX from VIXY proxy: ${vixLevel}`);
          } else {
            console.warn(`[tool] All VIX sources failed`);
          }
        }

        // ── SPY trend + regime classification ──────────────────────────────
        let spyTrend: MarketOverviewResult["spy_trend"] = null;
        let regime: MarketOverviewResult["regime"] = "NEUTRAL";
        let fiveDayReturn = 0;

        const spyCandle = spyCandleResult.data as { c?: number[]; s?: string } | null;
        if (spyCandle && spyCandle.s === "ok" && Array.isArray(spyCandle.c) && spyCandle.c.length >= 5) {
          const closes = spyCandle.c;
          const sma20 = calcSMA(closes, 20);
          const currentPrice = closes[closes.length - 1];
          fiveDayReturn = closes.length >= 6
            ? ((currentPrice - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
            : 0;

          if (sma20 !== null) {
            const position: "above" | "below" = currentPrice >= sma20 ? "above" : "below";
            const pctFromSma = Math.round(((currentPrice - sma20) / sma20) * 10000) / 100;
            spyTrend = { sma_20: sma20, position, pct_from_sma: pctFromSma };
          }
        } else if (spyCandleResult.error) {
          errors.push(spyCandleResult.error);
        }

        // Regime rules
        const spyAboveSma = spyTrend?.position === "above";
        if (vixLevel !== null && vixLevel < 16 && spyAboveSma) {
          regime = "RISK_ON";
        } else if (
          (vixLevel !== null && vixLevel > 25) ||
          (!spyAboveSma && fiveDayReturn < -1)
        ) {
          regime = "RISK_OFF";
        }

        console.log(`[tool] regime=${regime} vix=${vixLevel} spyAboveSma=${spyAboveSma} 5dReturn=${fiveDayReturn.toFixed(2)}%`);

        // ── Macro events today ─────────────────────────────────────────────
        let macroEventsToday: MacroEvent[] = [];
        try {
          const macroRaw = macroCalResult.data as { event?: string; country?: string; actual?: number | null; estimate?: number | null; impact?: string }[] | null;
          if (Array.isArray(macroRaw)) {
            macroEventsToday = macroRaw
              .filter((e) => e.country === "US")
              .map((e) => ({
                event: e.event ?? "Unknown",
                actual: e.actual ?? null,
                estimate: e.estimate ?? null,
                impact: e.impact === "High" ? "HIGH" as const : e.impact === "Medium" ? "MEDIUM" as const : "LOW" as const,
              }));
          }
        } catch {
          // non-fatal: return empty array
        }

        // ── Earnings density (next 5 days) ─────────────────────────────────
        let earningsDensity: EarningsDensity = { count: 0, period: `${today}–${fiveDaysForward}` };
        try {
          const earningsRaw = earningsDensityResult.data as { earningsCalendar?: { symbol: string }[] } | null;
          if (earningsRaw?.earningsCalendar) {
            earningsDensity = {
              count: earningsRaw.earningsCalendar.length,
              period: `${formatShortDate(today)}–${formatShortDate(fiveDaysForward)}`,
            };
          }
        } catch {
          // non-fatal
        }

        // Sector quotes — sorted by daily change. Sector candle fetches removed
        // to save 11 Finnhub API calls per run (~18% of rate limit budget).
        // The daily change_pct is sufficient for regime classification.
        const sectors: SectorQuote[] = sectorsRaw
          .filter((s): s is NonNullable<typeof s> => s != null)
          .map((s) => ({
            symbol: s.symbol,
            price: s.price,
            change_pct: s.changesPercentage,
          }))
          .sort((a, b) => b.change_pct - a.change_pct);

        // ── Inline theme detection (keyword-based, no extra API calls) ───
        const BEARISH_WORDS = ["crash", "decline", "selloff", "warning", "downgrade", "risk", "fear", "plunge"];
        const BULLISH_WORDS = ["surge", "rally", "beat", "upgrade", "growth", "record", "breakout", "soar"];

        const newsArticlesRaw = generalNewsResult.data as { headline: string; summary: string; source: string; url: string; datetime: number }[] | null;
        const newsArticles = Array.isArray(newsArticlesRaw) ? newsArticlesRaw.slice(0, 50) : [];
        const headlineTexts = newsArticles.map((a) => a.headline);
        const allTexts = newsArticles.map((a) => `${a.headline} ${a.summary ?? ""}`);
        const topSectors = new Set(sectors.filter((s) => s.change_pct > 0.5).map((s) => s.symbol));

        const scoredThemes: (MarketTheme & { rawScore: number })[] = [];
        for (const [id, def] of Object.entries(THEME_DEFINITIONS)) {
          let headlineMatches = 0;
          const matchedHeadlines: string[] = [];
          let bullishCount = 0;
          let bearishCount = 0;

          for (let i = 0; i < allTexts.length; i++) {
            const text = allTexts[i].toLowerCase();
            if (def.keywords.some((kw) => text.includes(kw.toLowerCase()))) {
              headlineMatches++;
              if (matchedHeadlines.length < 3) matchedHeadlines.push(headlineTexts[i]);
              const hl = headlineTexts[i].toLowerCase();
              for (const w of BULLISH_WORDS) { if (hl.includes(w)) bullishCount++; }
              for (const w of BEARISH_WORDS) { if (hl.includes(w)) bearishCount++; }
            }
          }

          const sectorBonus = def.sectors.filter((s) => topSectors.has(s)).length;
          const rawScore = headlineMatches * 2 + sectorBonus * 2;
          if (rawScore === 0) continue;

          let direction: ThemeDirection = "NEUTRAL";
          if (bullishCount > bearishCount) direction = "BULLISH";
          else if (bearishCount > bullishCount) direction = "BEARISH";

          scoredThemes.push({
            id,
            label: def.label,
            strength: 0,
            direction,
            tickers: def.tickers.slice(0, 4),
            headline_matches: headlineMatches,
            reddit_overlap: 0,
            representative_headlines: matchedHeadlines,
            rawScore,
          });
        }

        const maxThemeScore = Math.max(...scoredThemes.map((t) => t.rawScore), 1);
        for (const theme of scoredThemes) {
          theme.strength = Math.round((theme.rawScore / maxThemeScore) * 100) / 100;
        }
        const themes: MarketTheme[] = scoredThemes
          .filter((t) => t.strength >= 0.1)
          .sort((a, b) => b.strength - a.strength)
          .slice(0, 8)
          .map(({ rawScore: _, ...theme }) => theme);

        logToolEnd("get_market_context", _t0, ctx.runId, `SPY=${spyData ? `$${spyData.price}` : "null"} regime=${regime} themes=${themes.length}`, stats);
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
          regime,
          spy_trend: spyTrend,
          macro_events_today: macroEventsToday,
          earnings_density: earningsDensity,
          themes,
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
            {
              provider: "Finnhub",
              title: "SPY 30-Day Candles (SMA-20 + Regime)",
              url: "https://finnhub.io/docs/api/stock-candles",
              excerpt: spyTrend ? `SPY ${spyTrend.position} SMA-20 ($${spyTrend.sma_20}) by ${spyTrend.pct_from_sma > 0 ? "+" : ""}${spyTrend.pct_from_sma}%` : "SPY candle data unavailable",
            },
            {
              provider: "FMP",
              title: "US Economic Calendar",
              url: "https://site.financialmodelingprep.com/developer/docs#economic-calendar",
              excerpt: macroEventsToday.length > 0 ? `${macroEventsToday.length} US macro event(s) today` : "No US macro events today",
            },
            {
              provider: "Finnhub",
              title: "Earnings Calendar (5-Day Density)",
              url: "https://finnhub.io/docs/api/earnings-calendar",
              excerpt: `${earningsDensity.count} earnings reports ${earningsDensity.period}`,
            },
          ],
        };
      },
    }),

    scan_candidates: tool({
      description:
        "Scan the market for trading candidates. Returns scored tickers from multiple sources: earnings calendar (30 days), market movers, gainers/losers, social trends. Supports theme filtering, market cap/volume quality floors, and volume spike detection.",
      inputSchema: scanParams,
      execute: async ({ sectors, theme_filter, min_market_cap, min_avg_volume }: ScanInput): Promise<ScanCandidatesResult> => {
        const _t0 = Date.now();
        logToolStart("scan_candidates", ctx.runId, `sectors=${sectors?.join(",") ?? "all"} theme=${theme_filter ?? "none"}`, stats);
        const today = new Date().toISOString().slice(0, 10);
        const nextMonth = new Date(Date.now() + 30 * 86400_000)
          .toISOString()
          .slice(0, 10);

        const [earningsResult, gainersResult, losersResult, stTrending, redditTrending] = await Promise.all([
          finnhub(`/calendar/earnings?from=${today}&to=${nextMonth}`, 2, stats),
          fmp("/stock_market/gainers", stats),
          fmp("/stock_market/losers", stats),
          stocktwitsTrending(),
          discoverTrendingTickers(),
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

        // Earnings calendar (30 days forward)
        const earningsTickers =
          (earnings as { earningsCalendar?: { symbol: string; date: string; epsEstimate: number | null }[] })
            ?.earningsCalendar
            ?.slice(0, 30)
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

        // Reddit trending (WSB + r/stocks + r/options + r/investing)
        const redditTickers = redditTrending.map((t) => ({
          ticker: t.ticker,
          source: "reddit_trending" as const,
          score: 2, // Reddit retail momentum signal
          mentions: t.mentions,
        }));

        // ── Theme filter boost (BEFORE dedup/ranking) ─────────────────────
        let themeBoostTickers = new Set<string>();
        if (theme_filter) {
          // Match by label (display name) or id (snake_case key)
          const matchedTheme = Object.entries(THEME_DEFINITIONS).find(
            ([id, def]) =>
              def.label.toLowerCase() === theme_filter.toLowerCase() ||
              id === theme_filter.toLowerCase().replace(/[\s/&]+/g, "_"),
          );
          if (matchedTheme) {
            themeBoostTickers = new Set(matchedTheme[1].tickers.map((t) => t.toUpperCase()));
          }
        }

        // Score & deduplicate
        const allCandidates = [
          ...watchlistTickers,
          ...earningsTickers,
          ...gainerTickers,
          ...loserTickers,
          ...socialTickers,
          ...redditTickers,
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

        // Apply theme boost after dedup so it counts once per ticker
        if (themeBoostTickers.size > 0) {
          for (const [sym, entry] of scoreMap) {
            if (themeBoostTickers.has(sym)) {
              entry.score += 3;
              if (!entry.sources.includes("theme_match")) {
                entry.sources.push("theme_match");
              }
            }
          }
        }

        const ranked = [...scoreMap.entries()]
          .sort((a, b) => b[1].score - a[1].score)
          .slice(0, 15);

        // ── Build output (no per-ticker API calls — quality filtering deferred to get_stock_data) ──
        const candidatesRaw = ranked.map(([ticker, v]) => ({
          ticker,
          score: v.score,
          sources: v.sources,
          change_pct: (v.data as { change_pct?: number }).change_pct,
          date: (v.data as { date?: string }).date,
          catalysts: undefined as { type: string; date: string; details: string }[] | undefined,
        }));

        // ── Inline catalyst fetch (merged from scan_catalysts) ─────────────
        let catalystSources: ToolSource[] = [];
        try {
          const { scanCatalysts } = await import("@/lib/discovery/catalysts");
          const catalystResult = await scanCatalysts({ forwardDays: 14 });
          const catalystsByTicker = new Map<string, { type: string; date: string; details: string }[]>();
          for (const c of catalystResult.catalysts) {
            if (!c.ticker) continue;
            const sym = c.ticker.toUpperCase();
            if (!catalystsByTicker.has(sym)) catalystsByTicker.set(sym, []);
            catalystsByTicker.get(sym)!.push({
              type: c.catalyst_type,
              date: c.date,
              details: c.details,
            });
          }
          for (const candidate of candidatesRaw) {
            const matched = catalystsByTicker.get(candidate.ticker.toUpperCase());
            if (matched) candidate.catalysts = matched;
          }
          catalystSources = catalystResult._sources ?? [];
        } catch (err) {
          console.warn(`[tool] scan_candidates catalyst fetch failed:`, err instanceof Error ? err.message : err);
        }

        const candidates: ScanCandidate[] = candidatesRaw.map((c) => ({
          ...c,
          catalysts: c.catalysts,
        }));

        const notes: string[] = [];
        const configSectors = ctx.sectors ?? [];
        if (configSectors.length > 0) notes.push(`Analyst sectors: ${configSectors.join(", ")} (sector filtering deferred to get_stock_data).`);
        if (theme_filter) notes.push(`Theme boost applied: ${theme_filter}.`);
        if (min_market_cap || min_avg_volume) notes.push(`Quality filtering (market cap, volume) deferred to get_stock_data.`);
        notes.push(`${candidates.length} candidates ranked by multi-source score.`);

        logToolEnd("scan_candidates", _t0, ctx.runId, `found=${candidates.length}`, stats);
        return {
          candidates,
          total_found: candidates.length,
          sources_queried: [
            "earnings_calendar",
            "top_gainers",
            "top_losers",
            "stocktwits_trending",
            "reddit_trending",
            ...(ctx.watchlist?.length ? ["watchlist"] : []),
            ...(theme_filter ? ["theme_match"] : []),
          ],
          note: notes.join(" "),
          _sources: [
            {
              provider: "Finnhub",
              title: "Earnings Calendar (30 Days)",
              url: "https://finnhub.io/docs/api/earnings-calendar",
              excerpt: candidates.filter(c => c.sources.includes("earnings_calendar")).length > 0
                ? `${candidates.filter(c => c.sources.includes("earnings_calendar")).length} upcoming earnings`
                : "No upcoming earnings",
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
            {
              provider: "Reddit",
              title: "Trending Tickers (WSB, r/stocks, r/options, r/investing)",
              url: "https://reddit.com/r/wallstreetbets",
              excerpt: redditTrending.length > 0 ? `${redditTrending.length} trending tickers` : "No Reddit data",
            },
            ...(ctx.watchlist?.length
              ? [{
                  provider: "Watchlist",
                  title: "Custom Watchlist",
                  url: "",
                  excerpt: `Watching: ${ctx.watchlist.join(", ")}`,
                }]
              : []),
            ...catalystSources,
          ],
        };
      },
    }),

    get_stock_data: tool({
      description:
        "Get comprehensive data for a stock: price quote, company profile, key financials, analyst ratings, recent news, technical indicators (RSI, SMA, volume), and analyst price targets. This is your primary research tool — includes everything you need for a single ticker.",
      inputSchema: z.object({
        ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
        include_technicals: z.boolean().optional().describe("Include technical analysis (RSI, SMA, volume). Default true."),
      }),
      execute: async ({ ticker, include_technicals }: { ticker: string; include_technicals?: boolean }) => {
        const _t0 = Date.now();
        const doTechnicals = include_technicals !== false; // default true
        logToolStart("get_stock_data", ctx.runId, `ticker=${ticker} technicals=${doTechnicals}`, stats);

        const now = Math.floor(Date.now() / 1000);
        const ninetyDaysAgo = now - 90 * 86400;

        // Parallel fetch: quote, profile, financials, news, recommendations,
        // + conditionally candles (for technicals) and price targets
        const [quoteResult, profileResult, financialsResult, newsResult, recsResult, candleResult, priceTargetResult] =
          await Promise.all([
            finnhub(`/quote?symbol=${ticker}`, 2, stats),
            finnhub(`/stock/profile2?symbol=${ticker}`, 2, stats),
            finnhub(`/stock/metric?symbol=${ticker}&metric=all`, 2, stats),
            finnhub(
              `/company-news?symbol=${ticker}&from=${new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`,
              2, stats,
            ),
            finnhub(`/stock/recommendation?symbol=${ticker}`, 2, stats),
            // Candles for technical analysis
            doTechnicals
              ? finnhub(`/stock/candle?symbol=${ticker}&resolution=D&from=${ninetyDaysAgo}&to=${now}`, 2, stats)
              : Promise.resolve({ data: null } as { data: unknown; error?: string }),
            // FMP price target consensus
            fmp(`/v4/price-target-consensus?symbol=${ticker}`, stats),
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

        // ── Technical analysis (inline, merged from get_technical_analysis) ──
        let technicals: {
          current_price: number;
          rsi_14: number | null;
          sma_20: number | null;
          sma_50: number | null;
          price_vs_sma20: string | null;
          price_vs_sma50: string | null;
          position_in_52w_range: string;
          volume_ratio: string | null;
          trend: string;
        } | null = null;
        let techProvider = "Finnhub";

        if (doTechnicals) {
          let candles = candleResult.data as { s?: string; c?: number[]; v?: number[] } | null;

          // Fallback: FMP historical prices
          if (!candles || candles.s !== "ok" || !candles.c?.length) {
            techProvider = "FMP";
            const fmpResult = await fmp(`/historical-price-full/${ticker}?timeseries=90`, stats);
            const fmpHistory = fmpResult.data as { historical?: { close: number; volume: number }[] } | null;
            if (fmpHistory?.historical?.length) {
              const sorted = fmpHistory.historical.reverse();
              candles = { s: "ok", c: sorted.map((d) => d.close), v: sorted.map((d) => d.volume) };
            }
          }

          // Fallback: Alpaca bars
          if (!candles || candles.s !== "ok" || !candles.c?.length) {
            try {
              techProvider = "Alpaca";
              const threeMonthsAgo = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
              const today = new Date().toISOString().slice(0, 10);
              const alpacaBars = await getBars(ticker, { start: threeMonthsAgo, end: today });
              if (alpacaBars.length >= 14) {
                candles = { s: "ok", c: alpacaBars.map((b) => b.close), v: alpacaBars.map((b) => b.volume) };
              }
            } catch (err) {
              console.warn(`[tool] get_stock_data: Alpaca bars fallback failed for ${ticker}:`, err instanceof Error ? err.message : err);
            }
          }

          if (candles && candles.s === "ok" && candles.c?.length) {
            const closes = candles.c;
            const currentPrice = closes[closes.length - 1];
            const rsi = calcRSI(closes);
            const sma20 = calcSMA(closes, 20);
            const sma50 = calcSMA(closes, 50);
            const high52 = Math.max(...closes);
            const low52 = Math.min(...closes);
            const position52w = high52 !== low52 ? Math.round(((currentPrice - low52) / (high52 - low52)) * 100) : 50;
            const volumes: number[] = candles.v || [];
            const avgVol20 = volumes.length >= 20 ? volumes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20 : null;
            const latestVol = volumes[volumes.length - 1];
            const volumeRatio = avgVol20 && avgVol20 > 0 ? Math.round((latestVol / avgVol20) * 100) / 100 : null;

            technicals = {
              current_price: currentPrice,
              rsi_14: rsi,
              sma_20: sma20,
              sma_50: sma50,
              price_vs_sma20: sma20 ? `${currentPrice > sma20 ? "above" : "below"} (${Math.round(((currentPrice - sma20) / sma20) * 10000) / 100}%)` : null,
              price_vs_sma50: sma50 ? `${currentPrice > sma50 ? "above" : "below"} (${Math.round(((currentPrice - sma50) / sma50) * 10000) / 100}%)` : null,
              position_in_52w_range: `${position52w}%`,
              volume_ratio: volumeRatio ? `${volumeRatio}x average (${volumeRatio > 1.5 ? "elevated" : volumeRatio < 0.7 ? "low" : "normal"})` : null,
              trend: sma20 && sma50 ? (sma20 > sma50 ? "bullish (SMA20 > SMA50)" : "bearish (SMA20 < SMA50)") : "unknown",
            };
          }
        }

        // ── Price targets (merged from get_analyst_targets) ─────────────────
        let priceTargets: {
          consensus: number | undefined;
          high: number | undefined;
          low: number | undefined;
          median: number | undefined;
          num_analysts: number | undefined;
        } | null = null;

        const ptData = priceTargetResult.data;
        const ptArr = ptData as { targetConsensus?: number; targetHigh?: number; targetLow?: number; targetMedian?: number; numberOfAnalysts?: number }[];
        if (Array.isArray(ptArr) && ptArr.length > 0) {
          const c = ptArr[0];
          priceTargets = {
            consensus: c.targetConsensus,
            high: c.targetHigh,
            low: c.targetLow,
            median: c.targetMedian,
            num_analysts: c.numberOfAnalysts,
          };
        }

        logToolEnd("get_stock_data", _t0, ctx.runId, `ticker=${ticker}`, stats);
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
          technicals,
          price_targets: priceTargets,
          ...(errors.length > 0 ? { api_errors: errors } : {}),
          _sources: [
            {
              provider: "Finnhub",
              title: `${ticker} Real-Time Quote`,
              excerpt: quote && quote.c ? `$${quote.c} ${quote.dp > 0 ? "+" : ""}${quote.dp?.toFixed(2)}% | High $${quote.h} Low $${quote.l}` : "Quote unavailable",
            },
            {
              provider: "Finnhub",
              title: `${ticker} Company Profile`,
              excerpt: profile && profile.name ? `${profile.name} | ${profile.finnhubIndustry} | ${profile.exchange}` : "Profile unavailable",
            },
            {
              provider: "Finnhub",
              title: `${ticker} Key Financials`,
              excerpt: financials?.metric
                ? `P/E ${(financials.metric.peNormalizedAnnual as number | null)?.toFixed(1) ?? "—"} | Beta ${(financials.metric.beta as number | null)?.toFixed(2) ?? "—"} | 52W $${(financials.metric["52WeekLow"] as number | null)?.toFixed(0) ?? "?"}-$${(financials.metric["52WeekHigh"] as number | null)?.toFixed(0) ?? "?"}`
                : "Financials unavailable",
            },
            ...(latestRec
              ? [{
                  provider: "Finnhub",
                  title: `${ticker} Analyst Consensus`,
                  excerpt: `Buy ${latestRec.buy + latestRec.strongBuy} | Hold ${latestRec.hold} | Sell ${latestRec.sell + latestRec.strongSell}`,
                }]
              : []),
            ...recentNews.map((n: { source: string; headline: string; url: string; summary: string }) => ({
              provider: n.source,
              title: n.headline,
              url: n.url,
              excerpt: n.summary,
            })),
            ...(technicals
              ? [{
                  provider: techProvider,
                  title: `${ticker} 90-Day Price History`,
                  url: techProvider === "Finnhub" ? "https://finnhub.io/docs/api/stock-candles" : `https://financialmodelingprep.com/financial-statements/${ticker}`,
                  excerpt: `RSI ${technicals.rsi_14?.toFixed(1) ?? "—"} | SMA20 $${technicals.sma_20?.toFixed(2) ?? "—"} | SMA50 $${technicals.sma_50?.toFixed(2) ?? "—"} | 52W position ${technicals.position_in_52w_range}`,
                }]
              : []),
            ...(priceTargets
              ? [{
                  provider: "FMP",
                  title: `${ticker} Analyst Price Targets`,
                  url: `https://financialmodelingprep.com/api/v4/price-target-consensus?symbol=${ticker}`,
                  excerpt: `Consensus $${priceTargets.consensus ?? "—"} | High $${priceTargets.high ?? "—"} | Low $${priceTargets.low ?? "—"} | ${priceTargets.num_analysts ?? 0} analysts`,
                }]
              : []),
          ],
        };
      },
    }),

    get_social_sentiment: tool({
      description:
        "Get combined social sentiment for a stock from Reddit (r/wallstreetbets, r/stocks, r/options, r/investing) and StockTwits/Twitter. Shows mention counts, sentiment direction, top posts, and a combined signal.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        const _t0 = Date.now();
        logToolStart("get_social_sentiment", ctx.runId, `ticker=${ticker}`, stats);

        // Fetch Reddit + StockTwits/Twitter sentiment in parallel
        const [redditData, stocktwitsData] = await Promise.all([
          getRedditSentiment(ticker),
          twitterSentiment(ticker),
        ]);

        // Compute combined signal from both sources
        let combinedScore = 0;
        let signalSources = 0;
        if (redditData.available && redditData.mention_count > 0) {
          combinedScore += redditData.sentiment_score;
          signalSources++;
        }
        if (stocktwitsData.available) {
          combinedScore += stocktwitsData.sentiment_score;
          signalSources++;
        }
        const avgScore = signalSources > 0 ? combinedScore / signalSources : 0;
        const combinedSignal = avgScore > 2 ? "bullish" : avgScore < -2 ? "bearish" : "neutral";

        const _sources: ToolSource[] = [];

        // Reddit sources
        if (redditData.available && redditData.top_posts?.length > 0) {
          for (const p of redditData.top_posts) {
            _sources.push({
              provider: `Reddit r/${p.subreddit}`,
              title: p.title,
              url: p.url,
              excerpt: `Score: ${p.score}, ${p.num_comments} comments`,
            });
          }
        } else {
          _sources.push({
            provider: "Reddit",
            title: `${ticker} Reddit Search`,
            url: `https://www.reddit.com/search/?q=${ticker}&sort=new`,
            excerpt: "No mentions found",
          });
        }

        // StockTwits sources
        _sources.push({
          provider: "StockTwits",
          title: `${ticker} Social Feed`,
          url: `https://stocktwits.com/symbol/${ticker.toUpperCase()}`,
          excerpt: stocktwitsData.available
            ? `${stocktwitsData.mention_count} posts, sentiment: ${stocktwitsData.sentiment}`
            : "No social data found",
        });
        if (stocktwitsData.fmp_sentiment) {
          _sources.push({
            provider: "FMP Social",
            title: `${ticker} Twitter/Social Sentiment`,
            url: `https://financialmodelingprep.com/api/v4/historical/social-sentiment?symbol=${ticker}`,
            excerpt: `Sentiment score: ${stocktwitsData.fmp_sentiment.sentiment.toFixed(2)}, ${stocktwitsData.fmp_sentiment.mentions} mentions`,
          });
        }

        logToolEnd("get_social_sentiment", _t0, ctx.runId, `ticker=${ticker} combined=${combinedSignal}`, stats);
        return {
          reddit: {
            available: redditData.available && redditData.mention_count > 0,
            mention_count: redditData.mention_count,
            sentiment: redditData.sentiment,
            sentiment_score: redditData.sentiment_score,
            trending: redditData.trending,
            top_posts: redditData.available ? redditData.top_posts.map((p) => ({
              subreddit: p.subreddit,
              title: p.title,
              url: p.url,
              score: p.score,
              comments: p.num_comments,
            })) : [],
          },
          stocktwits: {
            available: stocktwitsData.available,
            mention_count: stocktwitsData.mention_count,
            sentiment: stocktwitsData.sentiment,
            sentiment_score: stocktwitsData.sentiment_score,
            trending: stocktwitsData.trending,
            watchlist_count: stocktwitsData.watchlist_count,
            posts: stocktwitsData.posts.map((p) => ({
              body: p.body,
              username: p.username,
              created_at: p.created_at,
              likes: p.likes,
            })),
            fmp_sentiment: stocktwitsData.fmp_sentiment,
          },
          combined_signal: combinedSignal,
          _sources,
        };
      },
    }),

    get_options_flow: tool({
      description:
        "Get unusual options activity for a stock: put/call ratio, unusual volume contracts, and implied volatility signals.",
      inputSchema: tickerParams,
      execute: async ({ ticker }: TickerInput) => {
        const _t0 = Date.now();
        logToolStart("get_options_flow", ctx.runId, `ticker=${ticker}`, stats);
        // Primary: FMP options chain
        const fmpResult = await fmp(`/options/chain/${ticker.toUpperCase()}`, stats);
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

          logToolEnd("get_options_flow", _t0, ctx.runId, `ticker=${ticker} src=fmp`, stats);
          return {
            available: true,
            put_call_ratio:
              totalCallVol > 0
                ? Math.round((totalPutVol / totalCallVol) * 100) / 100
                : null,
            total_call_volume: totalCallVol,
            total_put_volume: totalPutVol,
            contracts_available: fmpData.length,
            unusual_contracts: unusualContracts.slice(0, 3),
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
          2, stats,
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

          logToolEnd("get_options_flow", _t0, ctx.runId, `ticker=${ticker} src=finnhub`, stats);
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

        logToolEnd("get_options_flow", _t0, ctx.runId, `ticker=${ticker} no_data`, stats);
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
        const _t0 = Date.now();
        logToolStart("get_earnings_data", ctx.runId, `ticker=${ticker}`, stats);
        const [earningsResult, surprisesResult] = await Promise.all([
          finnhub(`/calendar/earnings?symbol=${ticker}`, 2, stats),
          finnhub(`/stock/earnings?symbol=${ticker}&limit=8`, 2, stats),
        ]);

        const earnings = earningsResult.data as { earningsCalendar?: { date: string; epsEstimate: number | null }[] } | null;
        const surprises = surprisesResult.data;

        const upcoming = earnings?.earningsCalendar?.[0];
        const history = Array.isArray(surprises) ? surprises : [];
        const beats = history.filter(
          (e: { actual: number; estimate: number }) =>
            e.actual != null && e.estimate != null && e.actual > e.estimate,
        );

        logToolEnd("get_earnings_data", _t0, ctx.runId, `ticker=${ticker}`, stats);
        return {
          next_earnings: upcoming
            ? {
                date: upcoming.date as string,
                eps_estimate: upcoming.epsEstimate as number | null,
              }
            : null,
          beat_rate:
            history.length > 0
              ? (() => {
                  const periods = history
                    .map((e: { period?: string }) => e.period)
                    .filter(Boolean) as string[];
                  const range =
                    periods.length >= 2
                      ? `${periods[periods.length - 1]}–${periods[0]}`
                      : periods[0] || "recent";
                  return `${Math.round((beats.length / history.length) * 100)}% (${beats.length}/${history.length} quarters, ${range})`;
                })()
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
        "MANDATORY for every ticker you researched. Display your thesis as a formatted card and save it to the database. Call this for EVERY ticker — LONG, SHORT, and PASS. PASS theses are just as important: they document why a stock doesn't fit and build institutional memory. Never skip this tool or write a verdict as text instead.",
      inputSchema: thesisParams,
      execute: async (args: ThesisInput) => {
        const _t0 = Date.now();
        logToolStart("show_thesis", ctx.runId, `ticker=${args.ticker} direction=${args.direction} confidence=${args.confidence_score}`, stats);
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
              sourcesUsed: args.sources_used ?? [],
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

          // Record PASS decision in TradeDecision (replaces old shadow trade)
          if (args.direction === "PASS" && ctx.runId) {
            const analystId = ctx.analystId || "unknown";
            try {
              await prisma.tradeDecision.create({
                data: {
                  runId: ctx.runId,
                  analystId,
                  userId: ctx.userId,
                  symbol: args.ticker,
                  decision: "PASS",
                  reasoning: args.reasoning_summary,
                  thesisId: thesis.id,
                },
              });
              console.log(`[tool] show_thesis recorded PASS decision for ${args.ticker} analystId=${analystId}`);
            } catch (passErr) {
              console.error("[tool] show_thesis PASS decision creation FAILED:", passErr);
            }
          } else if (args.direction === "PASS") {
            console.warn(`[tool] show_thesis SKIPPED PASS decision — missing runId=${ctx.runId}`);
          }

          logToolEnd("show_thesis", _t0, ctx.runId, `ticker=${args.ticker} id=${thesis.id}`, stats);
          return { thesis_id: thesis.id, ticker: args.ticker, direction: args.direction, confidence_score: args.confidence_score };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Thesis save failed";
          console.error(`[tool] show_thesis FAILED for ${args.ticker}: ${msg}`);
          return { thesis_id: null, ticker: args.ticker, direction: args.direction, error: msg, note: "Thesis could not be saved to DB. place_trade requires a thesis_id — do NOT attempt to trade this ticker." };
        }
      },
    }),

    place_trade: tool({
      description:
        "Place a paper trade on Alpaca. Only call this after presenting a thesis and explaining your reasoning. The trade will be executed immediately. Will fail if any analyst already holds an open position in this ticker.",
      inputSchema: tradeParams,
      execute: async (args: TradeInput) => {
        const _t0 = Date.now();
        logToolStart("place_trade", ctx.runId, `ticker=${args.ticker} direction=${args.direction} shares=${args.shares}`, stats);

        try {
          // 0. Check for existing open position in this ticker across ALL analysts
          const existingPosition = await prisma.position.findFirst({
            where: {
              userId: ctx.userId,
              symbol: args.ticker,
              status: "OPEN",
            },
            select: { id: true, symbol: true },
          });

          if (existingPosition) {
            console.warn(`[tool] place_trade BLOCKED: open position already exists for ${args.ticker}`);
            return {
              status: "failed" as const,
              ticker: args.ticker,
              error: `Already holding an open position in ${args.ticker}. Cannot open duplicate positions across analysts.`,
            };
          }

          // 1. Place Alpaca paper order
          const alpacaOrder = await placeMarketOrder({
            symbol: args.ticker,
            qty: args.shares,
            side: args.direction === "LONG" ? "buy" : "sell",
          });
          console.log(`[tool] place_trade Alpaca order placed: ${alpacaOrder.id}`);

          // 2. Wait for fill (max 5s), fall back to entry price
          // TODO: This should become async/non-blocking in future — fire-and-forget
          // the order and use a webhook or polling job to update fill status.
          let fillPrice = args.entry_price;
          const deadline = Date.now() + 5_000;
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

          // 3. Create Position + Order + PositionEvent + TradeDecision + RunEvent in a single transaction
          const analystId = ctx.analystId;
          if (!analystId) {
            throw new Error("Cannot place trade without an analyst ID. Ensure the run is linked to an analyst.");
          }

          const { position, order } = await prisma.$transaction(async (tx: TransactionClient) => {
            // Create the position (what the analyst holds)
            const pos = await tx.position.create({
              data: {
                analystId,
                userId: ctx.userId,
                symbol: args.ticker,
                direction: args.direction,
                status: "OPEN",
                quantity: args.shares,
                avgCost: fillPrice,
                targetPrice: args.target_price,
                stopLoss: args.stop_loss,
                exitStrategy: "PRICE_TARGET",
              },
            });

            // Create the order (what we told Alpaca)
            const ord = await tx.order.create({
              data: {
                positionId: pos.id,
                userId: ctx.userId,
                symbol: args.ticker,
                side: args.direction === "LONG" ? "BUY" : "SELL",
                orderType: "MARKET",
                quantity: args.shares,
                status: "FILLED",
                filledPrice: fillPrice,
                filledQty: args.shares,
                filledAt: new Date(),
                alpacaOrderId: alpacaOrder.id,
              },
            });

            // Create position lifecycle event
            await tx.positionEvent.create({
              data: {
                positionId: pos.id,
                eventType: "OPENED",
                description: `${args.direction} ${args.shares} shares of ${args.ticker} at $${fillPrice.toFixed(2)}`,
                priceAt: fillPrice,
              },
            });

            // Create trade decision (links thesis → position → order)
            await tx.tradeDecision.create({
              data: {
                runId: ctx.runId,
                analystId,
                userId: ctx.userId,
                symbol: args.ticker,
                decision: args.direction === "LONG" ? "BUY" : "SELL",
                reasoning: `${args.direction} ${args.shares} shares at $${fillPrice.toFixed(2)} (target: $${args.target_price.toFixed(2)}, stop: $${args.stop_loss.toFixed(2)})`,
                thesisId: args.thesis_id,
                positionId: pos.id,
                orderId: ord.id,
              },
            });

            // Write RunEvent so trade is visible on run page
            if (ctx.runId) {
              await tx.runEvent.create({
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
                    position_id: pos.id,
                    order_id: ord.id,
                  } as object,
                },
              });
            }

            return { position: pos, order: ord };
          });

          console.log(`[tool] place_trade SUCCESS position=${position.id} order=${order.id} fill=$${fillPrice.toFixed(2)}`);

          // Graduate watchlist item if this ticker was on the watchlist
          try {
            const watchlistItem = await prisma.analystWatchlistItem.findFirst({
              where: { analystId, symbol: args.ticker.toUpperCase(), status: "ACTIVE" },
            });
            if (watchlistItem) {
              await prisma.analystWatchlistItem.update({
                where: { id: watchlistItem.id },
                data: { status: "GRADUATED", removeReason: "Promoted to active position", removedAt: new Date() },
              });
              // Sync legacy watchlist
              const activeItems = await prisma.analystWatchlistItem.findMany({
                where: { analystId, status: "ACTIVE" },
                select: { symbol: true },
              });
              await prisma.agentConfig.update({
                where: { id: analystId },
                data: { watchlist: activeItems.map((i) => i.symbol) },
              });
              console.log(`[tool] place_trade graduated watchlist item ${args.ticker}`);
            }
          } catch (err) {
            console.warn(`[tool] place_trade watchlist graduation failed (non-fatal):`, err instanceof Error ? err.message : err);
          }

          logToolEnd("place_trade", _t0, ctx.runId, `ticker=${args.ticker} fill=$${fillPrice.toFixed(2)}`, stats);
          return {
            status: "filled" as const,
            ticker: args.ticker,
            direction: args.direction,
            fill_price: fillPrice,
            shares: args.shares,
            trade_id: position.id,
            position_id: position.id,
            order_id: order.id,
            alpaca_order_id: alpacaOrder.id,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Trade placement failed";
          console.error(`[tool] place_trade FAILED for ${args.ticker}: ${msg}`);
          logToolEnd("place_trade", _t0, ctx.runId, `ticker=${args.ticker} FAILED`, stats);
          return {
            status: "failed" as const,
            ticker: args.ticker,
            error: msg,
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
              direction: z.enum(["LONG", "SHORT", "PASS"]),
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
        portfolio_review: z
          .string()
          .optional()
          .describe(
            "Portfolio review assessment from Phase 5.5 — total exposure analysis, sector concentration, correlation risk, and whether combined risk is acceptable",
          ),
      }),
      execute: async (args) => {
        const _t0 = Date.now();
        try {
          console.log(`[tool] summarize_run picks=${args.ranked_picks.length} runId=${ctx.runId}`);
          const traded = args.ranked_picks.filter((p) => p.action === "TRADE").length;

          // Idempotency check — if run is already COMPLETE, skip the update
          const existingRun = await prisma.researchRun.findUnique({
            where: { id: ctx.runId },
            select: { status: true },
          });

          if (existingRun?.status !== "COMPLETE") {
            // Mark run COMPLETE
            await prisma.researchRun.update({
              where: { id: ctx.runId },
              data: {
                status: "COMPLETE",
                completedAt: new Date(),
              },
            });
          } else {
            console.log(`[tool] summarize_run: run ${ctx.runId} already COMPLETE, skipping status update`);
          }

          // Write run_summary + run_complete events (non-fatal — run is already marked COMPLETE)
          try {
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
                    portfolio_review: args.portfolio_review,
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
          } catch (err) {
            console.error(`[tool] summarize_run RunEvent write failed (run already marked COMPLETE):`, err instanceof Error ? err.message : err);
          }
          logToolEnd("summarize_run", _t0, ctx.runId, `picks=${args.ranked_picks.length}`, stats);
          return { status: "complete", analyzed: args.ranked_picks.length, traded };
        } catch (err) {
          console.error(`[tool] summarize_run FAILED:`, err instanceof Error ? err.message : err);
          // Best-effort: try to mark run COMPLETE even if everything else failed
          try {
            await prisma.researchRun.update({
              where: { id: ctx.runId },
              data: { status: "COMPLETE", completedAt: new Date() },
            });
          } catch { /* already tried */ }
          logToolEnd("summarize_run", _t0, ctx.runId, "FAILED", stats);
          return { status: "complete", analyzed: args.ranked_picks.length, traded: 0, error: err instanceof Error ? err.message : "summarize_run failed" };
        }
      },
    }),
    // ── Watchlist management ──────────────────────────────────────────────

    manage_watchlist: tool({
      description:
        "Add, remove, or update stocks on your watchlist. Use this to track interesting stocks that aren't ready to trade yet, or to remove stocks that are no longer relevant. " +
        "When you PASS on a stock but find it interesting, add it to the watchlist with a reason. " +
        "When a watchlist stock no longer fits your thesis, remove it. " +
        "When new information changes the priority, update it.",
      inputSchema: z.object({
        action: z.enum(["ADD", "REMOVE", "UPDATE"]).describe("What to do with the watchlist item"),
        symbol: z.string().describe("Stock ticker symbol, e.g. AAPL"),
        reason: z.string().optional().describe("Why this stock is being added/removed/updated. Required for ADD."),
        priority: z.enum(["HIGH", "NORMAL", "LOW"]).optional().describe("Priority level. HIGH = review every run. NORMAL = review when relevant. LOW = background monitoring."),
        notes: z.string().optional().describe("Additional notes or conditions (e.g. 'Review if price drops below $150')"),
      }),
      execute: async (args: { action: string; symbol: string; reason?: string; priority?: string; notes?: string }) => {
        const _t0 = Date.now();
        logToolStart("manage_watchlist", ctx.runId, `action=${args.action} symbol=${args.symbol}`, stats);

        if (!ctx.analystId) {
          logToolEnd("manage_watchlist", _t0, ctx.runId, "FAILED: no analystId", stats);
          return { status: "failed" as const, error: "Cannot manage watchlist without an analyst ID." };
        }

        const upper = args.symbol.toUpperCase();

        try {
          if (args.action === "ADD") {
            if (!args.reason) {
              return { status: "failed" as const, error: "Reason is required when adding to watchlist." };
            }

            // Check for existing active item
            const existing = await prisma.analystWatchlistItem.findFirst({
              where: { analystId: ctx.analystId, symbol: upper, status: "ACTIVE" },
            });
            if (existing) {
              // Update instead of duplicate
              await prisma.analystWatchlistItem.update({
                where: { id: existing.id },
                data: {
                  ...(args.reason ? { reason: args.reason } : {}),
                  ...(args.priority ? { priority: args.priority } : {}),
                  ...(args.notes !== undefined ? { notes: args.notes } : {}),
                  lastReviewedAt: new Date(),
                },
              });
              logToolEnd("manage_watchlist", _t0, ctx.runId, `UPDATED existing ${upper}`, stats);
              return {
                status: "updated" as const,
                symbol: upper,
                message: `Updated existing watchlist item for $${upper}.`,
              };
            }

            await prisma.analystWatchlistItem.create({
              data: {
                analystId: ctx.analystId,
                userId: ctx.userId,
                symbol: upper,
                reason: args.reason,
                notes: args.notes ?? null,
                addedBy: "AGENT",
                priority: args.priority ?? "NORMAL",
                status: "ACTIVE",
                lastReviewedAt: new Date(),
              },
            });

            // Sync legacy watchlist
            const activeItems = await prisma.analystWatchlistItem.findMany({
              where: { analystId: ctx.analystId, status: "ACTIVE" },
              select: { symbol: true },
            });
            await prisma.agentConfig.update({
              where: { id: ctx.analystId },
              data: { watchlist: activeItems.map((i) => i.symbol) },
            });

            // Write RunEvent for visibility
            if (ctx.runId) {
              await prisma.runEvent.create({
                data: {
                  runId: ctx.runId,
                  type: "watchlist_add",
                  title: `Added $${upper} to watchlist`,
                  message: args.reason,
                  payload: { symbol: upper, priority: args.priority ?? "NORMAL", reason: args.reason } as object,
                },
              });
            }

            logToolEnd("manage_watchlist", _t0, ctx.runId, `ADDED ${upper}`, stats);
            return {
              status: "added" as const,
              symbol: upper,
              priority: args.priority ?? "NORMAL",
              message: `Added $${upper} to watchlist. Will be reviewed in future runs.`,
            };
          }

          if (args.action === "REMOVE") {
            const item = await prisma.analystWatchlistItem.findFirst({
              where: { analystId: ctx.analystId, symbol: upper, status: "ACTIVE" },
            });
            if (!item) {
              logToolEnd("manage_watchlist", _t0, ctx.runId, `${upper} not on watchlist`, stats);
              return { status: "not_found" as const, symbol: upper, message: `$${upper} is not on the watchlist.` };
            }

            await prisma.analystWatchlistItem.update({
              where: { id: item.id },
              data: {
                status: "REMOVED",
                removedAt: new Date(),
                removeReason: args.reason ?? "Removed by agent",
              },
            });

            // Sync legacy watchlist
            const activeItems = await prisma.analystWatchlistItem.findMany({
              where: { analystId: ctx.analystId, status: "ACTIVE" },
              select: { symbol: true },
            });
            await prisma.agentConfig.update({
              where: { id: ctx.analystId },
              data: { watchlist: activeItems.map((i) => i.symbol) },
            });

            if (ctx.runId) {
              await prisma.runEvent.create({
                data: {
                  runId: ctx.runId,
                  type: "watchlist_remove",
                  title: `Removed $${upper} from watchlist`,
                  message: args.reason ?? "No longer relevant",
                  payload: { symbol: upper, reason: args.reason } as object,
                },
              });
            }

            logToolEnd("manage_watchlist", _t0, ctx.runId, `REMOVED ${upper}`, stats);
            return {
              status: "removed" as const,
              symbol: upper,
              message: `Removed $${upper} from watchlist.`,
            };
          }

          if (args.action === "UPDATE") {
            const item = await prisma.analystWatchlistItem.findFirst({
              where: { analystId: ctx.analystId, symbol: upper, status: "ACTIVE" },
            });
            if (!item) {
              logToolEnd("manage_watchlist", _t0, ctx.runId, `${upper} not on watchlist`, stats);
              return { status: "not_found" as const, symbol: upper, message: `$${upper} is not on the watchlist.` };
            }

            await prisma.analystWatchlistItem.update({
              where: { id: item.id },
              data: {
                ...(args.reason ? { reason: args.reason } : {}),
                ...(args.priority ? { priority: args.priority } : {}),
                ...(args.notes !== undefined ? { notes: args.notes } : {}),
                lastReviewedAt: new Date(),
              },
            });

            logToolEnd("manage_watchlist", _t0, ctx.runId, `UPDATED ${upper}`, stats);
            return {
              status: "updated" as const,
              symbol: upper,
              priority: args.priority ?? item.priority,
              message: `Updated $${upper} watchlist entry.`,
            };
          }

          return { status: "failed" as const, error: `Unknown action: ${args.action}` };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Watchlist operation failed";
          console.error(`[tool] manage_watchlist FAILED: ${msg}`);
          logToolEnd("manage_watchlist", _t0, ctx.runId, `FAILED: ${msg}`, stats);
          return { status: "failed" as const, error: msg };
        }
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
        const _t0 = Date.now();
        logToolStart("get_sec_filings", ctx.runId, `symbol=${args.symbol}`, stats);
        try {
          const cik = await getCIK(args.symbol);
          const res = await fetch(
            `https://data.sec.gov/submissions/CIK${cik}.json`,
            {
              headers: {
                "User-Agent": "Hindsight Research Bot research@hindsight.app",
                Accept: "application/json",
              },
              signal: AbortSignal.timeout(API_TIMEOUT_MS),
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
          const maxIdx = Math.min(forms.length, dates.length, descs.length, 50);

          for (let i = 0; i < maxIdx; i++) {
            if (!relevantTypes.has(forms[i])) continue;
            filings.push({
              type: forms[i],
              date: dates[i],
              description: descs[i] ?? forms[i],
            });
            if (filings.length >= 8) break;
          }
          logToolEnd("get_sec_filings", _t0, ctx.runId, `symbol=${args.symbol} count=${filings.length}`, stats);
          return { filings, count: filings.length };
        } catch (err) {
          logToolEnd("get_sec_filings", _t0, ctx.runId, `symbol=${args.symbol} FAILED`, stats);
          return { filings: [], error: err instanceof Error ? err.message : "Failed" };
        }
      },
    }),

    // ── Reddit topic search (broader than ticker-specific sentiment) ────
    search_reddit: tool({
      description:
        "Search Reddit trading communities by topic or keyword. Searches r/wallstreetbets, r/stocks, r/options, r/investing. Use for broad topics like 'biotech FDA', 'momentum plays', 'semiconductor earnings'. For ticker-specific sentiment, use get_social_sentiment instead.",
      inputSchema: z.object({
        query: z.string().describe("Search query — topic or ticker. E.g. 'biotech FDA', 'NVDA earnings', 'momentum plays'"),
      }),
      execute: async ({ query }) => {
        const { searchReddit } = await import("@/lib/reddit");
        const results = await searchReddit(query);
        return {
          query,
          results,
          _sources: results.map((r) => ({
            title: r.title,
            url: r.url,
            provider: `r/${r.subreddit}`,
            excerpt: `Score: ${r.score}`,
          })),
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
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
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
