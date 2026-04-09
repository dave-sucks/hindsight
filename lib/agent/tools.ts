/**
 * Research agent tools — real API calls to Finnhub, FMP, SEC EDGAR, and Alpaca.
 * Plus V3 intelligence layer tools (read_morning_brief, read_signals, read_artifact).
 *
 * createResearchTools() is a factory that takes context (runId, userId)
 * so tools can persist theses and mark runs complete.
 */
import { tool } from "ai";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
type TransactionClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;
import { placeMarketOrder, getOrder, getLatestPrice, getLatestPrices, getBars, getAccount, type AlpacaCredentials } from "@/lib/alpaca";
import { updateAnalystBriefing } from "@/lib/agent/update-analyst-briefing";
import { etTradingDayDate } from "@/lib/market-hours";
import { finnhub, calcRSI, calcSMA } from "@/lib/agent/research-helpers";
import type { MacroEvent } from "@/lib/discovery/types";
import type { IntelligencePolicy } from "@/lib/intelligence/types";
import { searchSignals } from "@/lib/intelligence/sonar";
import type {
  ToolSource, TickerFinding, ResearchToolResult, NewsItem, SignalItem,
  MarketContextData, StockDataData, EarningsDataData, OptionsFlowData,
  SecFilingsData, MorningBriefToolData, SignalsToolData, ArtifactToolData,
  WebSearchToolData,
} from "@/lib/agent/tool-types";
import { toSourceRefs, sourceRefsToToolSources } from "@/lib/agent/tool-types";
import { getEarningsData } from "@/lib/agent/tools/get-earnings-data";

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

// ── API helpers ─────────────────────────────────────────────────────────────
// finnhub(), calcRSI(), calcSMA() imported from @/lib/agent/research-helpers

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


// calcRSI and calcSMA imported from @/lib/agent/research-helpers

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
  entry_price: z.number().optional().describe("Current price for entry. REQUIRED for LONG/SHORT — use the price from get_stock_data. Also include for PASS to enable shadow tracking."),
  target_price: z.number().optional().describe("Price target. REQUIRED for LONG/SHORT."),
  stop_loss: z.number().optional().describe("Stop-loss price. REQUIRED for LONG/SHORT."),
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
  fundamentals: z.object({
    market_cap: z.number().optional(),
    pe_ratio: z.number().optional(),
    beta: z.number().optional(),
    avg_volume: z.number().optional(),
    high_52w: z.number().optional(),
    low_52w: z.number().optional(),
    sector: z.string().optional(),
    analyst_consensus: z.object({
      buy: z.number(),
      hold: z.number(),
      sell: z.number(),
    }).optional(),
  }).optional().describe("Key fundamentals from get_stock_data — populates the Data tab in the thesis card."),
  // V2 Phase 3: Thesis lifecycle
  parent_thesis_id: z.string().optional()
    .describe("ID of the prior thesis being updated or invalidated. Links thesis chain. Pass the activeThesisId from your portfolio context when updating a holding's thesis."),
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
    .describe("REQUIRED — the thesis_id returned by record_thesis. Every trade must link to a thesis."),
});

// Inferred types
type TickerInput = z.infer<typeof tickerParams>;
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
  maxOpenPositions?: number;
  alpacaCreds?: AlpacaCredentials; // per-user Alpaca credentials (falls back to env vars)
  intelligencePolicy?: IntelligencePolicy; // V3: controls signal budgets, quality floors, search limits
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
  let liveSearchCount = 0; // tracks web_search calls against policy budget
  console.log(`[tools] Creating research tools for runId=${ctx.runId} analystId=${ctx.analystId ?? "none"}`);

  // Context adapter for defineTool factories (adds groupId, compatible with new ToolContext)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newCtx: any = { ...ctx, groupId: (phase: string) => phase };

  const toolsBase = {
    get_market_context: tool({
      description:
        "Get current market conditions: S&P 500, VIX, sector ETF performance, macro events, and regime classification. A quick price snapshot for market orientation.",
      inputSchema: emptyParams,
      execute: async (): Promise<ResearchToolResult<MarketContextData>> => {
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
        const [quoteResults, spyCandleResult, macroCalResult, earningsDensityResult] = await Promise.all([
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
        let spyTrend: { sma_20: number; position: "above" | "below"; pct_from_sma: number } | null = null;
        let regime: "RISK_ON" | "RISK_OFF" | "NEUTRAL" = "NEUTRAL";
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
        let earningsDensity: { count: number; period: string } = { count: 0, period: `${today}–${fiveDaysForward}` };
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
        const sectors = sectorsRaw
          .filter((s): s is NonNullable<typeof s> => s != null)
          .map((s) => ({
            symbol: s.symbol,
            changePct: s.changesPercentage,
          }))
          .sort((a, b) => b.changePct - a.changePct);

        logToolEnd("get_market_context", _t0, ctx.runId, `SPY=${spyData ? `$${spyData.price}` : "null"} regime=${regime}`, stats);

        // ── Build envelope ────────────────────────────────────────────
        const fPct = (n: number | null | undefined) => n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "";

        const summaryParts: string[] = [];
        if (spyData) summaryParts.push(`SPY $${spyData.price} (${fPct(spyData.changesPercentage)})`);
        if (vixLevel !== null) summaryParts.push(`VIX ${vixLevel.toFixed(1)}`);
        summaryParts.push(`Regime: ${regime}`);
        if (macroEventsToday.length > 0) summaryParts.push(`${macroEventsToday.length} macro event${macroEventsToday.length !== 1 ? "s" : ""} today`);
        if (earningsDensity.count > 0) summaryParts.push(`${earningsDensity.count} earnings ${earningsDensity.period}`);

        const envelopeTickers: TickerFinding[] = [];
        if (spyData) {
          envelopeTickers.push({
            ticker: "SPY",
            summary: `$${spyData.price} (${fPct(spyData.changesPercentage)})${spyTrend ? `, ${spyTrend.position} SMA-20 by ${fPct(spyTrend.pct_from_sma)}` : ""}`,
          });
        }

        return {
          summary: summaryParts.join(". ") + ".",
          tickers: envelopeTickers,
          _sources: [
            {
              provider: "Finnhub",
              title: "SPY Real-Time Quote",
              url: "https://finnhub.io/docs/api/quote",
              excerpt: spyData ? `SPY $${spyData.price} (${fPct(spyData.changesPercentage)})` : "SPY quote unavailable",
            },
            {
              provider: "Finnhub",
              title: "CBOE VIX Index",
              url: "https://finnhub.io/docs/api/quote",
              excerpt: vixLevel !== null ? `VIX at ${vixLevel.toFixed(1)}${vixChangePct != null ? ` (${fPct(vixChangePct)})` : ""}` : "VIX data unavailable",
            },
            {
              provider: "Finnhub",
              title: "S&P 500 Sector ETF Performance",
              url: "https://finnhub.io/docs/api/quote",
              excerpt: sectors.length > 0
                ? `Top: ${sectors[0].symbol} ${fPct(sectors[0].changePct)} | Bottom: ${sectors[sectors.length - 1].symbol} ${fPct(sectors[sectors.length - 1].changePct)}`
                : "Sector data unavailable",
            },
            {
              provider: "Finnhub",
              title: "SPY 30-Day Candles (SMA-20 + Regime)",
              url: "https://finnhub.io/docs/api/stock-candles",
              excerpt: spyTrend ? `SPY ${spyTrend.position} SMA-20 ($${spyTrend.sma_20.toFixed(2)}) by ${fPct(spyTrend.pct_from_sma)}` : "SPY candle data unavailable",
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
          data: {
            spy: spyData
              ? { price: spyData.price, changePct: spyData.changesPercentage, dayHigh: spyData.dayHigh, dayLow: spyData.dayLow }
              : null,
            vix: vixLevel !== null
              ? { level: vixLevel, changePct: vixChangePct }
              : null,
            regime,
            spyTrend: spyTrend
              ? { sma20: spyTrend.sma_20, position: spyTrend.position, pctFromSma: spyTrend.pct_from_sma }
              : null,
            sectors,
            macroEvents: macroEventsToday,
            earningsDensity,
            ...(errors.length > 0 ? { apiErrors: errors } : {}),
          },
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
              const alpacaBars = await getBars(ticker, { start: threeMonthsAgo, end: today }, ctx.alpacaCreds);
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

        // ── Normalize to camelCase data ───────────────────────────────
        const fPct = (n: number | null | undefined) => n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "";
        const fCompact = (n: number | null | undefined) => {
          if (n == null) return "";
          if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
          if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
          if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
          return `$${n.toLocaleString()}`;
        };

        const quoteData = quote && quote.c
          ? { price: quote.c as number, change: (quote.d as number) ?? 0, changePct: (quote.dp as number) ?? 0, high: quote.h as number, low: quote.l as number, open: quote.o as number, prevClose: quote.pc as number }
          : null;
        const companyData = profile && profile.name
          ? { name: profile.name as string, sector: (profile.finnhubIndustry as string) ?? "", marketCap: profile.marketCapitalization ? (profile.marketCapitalization as number) * 1_000_000 : null, exchange: (profile.exchange as string) ?? "", country: (profile.country as string) ?? "" }
          : null;
        const financialsData = financials?.metric
          ? { peRatio: financials.metric.peNormalizedAnnual as number | null, pbRatio: financials.metric.pbAnnual as number | null, high52w: financials.metric["52WeekHigh"] as number | null, low52w: financials.metric["52WeekLow"] as number | null, avgVolume10d: financials.metric["10DayAverageTradingVolume"] as number | null, beta: financials.metric.beta as number | null }
          : null;
        const consensusData = latestRec
          ? { buy: latestRec.buy as number, hold: latestRec.hold as number, sell: latestRec.sell as number, strongBuy: latestRec.strongBuy as number, strongSell: latestRec.strongSell as number }
          : null;
        const techData = technicals
          ? { currentPrice: technicals.current_price, rsi14: technicals.rsi_14, sma20: technicals.sma_20, sma50: technicals.sma_50, priceVsSma20: technicals.price_vs_sma20, priceVsSma50: technicals.price_vs_sma50, positionIn52wRange: technicals.position_in_52w_range, volumeRatio: technicals.volume_ratio, trend: technicals.trend }
          : null;
        const targetsData = priceTargets
          ? { consensus: priceTargets.consensus, high: priceTargets.high, low: priceTargets.low, median: priceTargets.median, numAnalysts: priceTargets.num_analysts }
          : null;
        const newsData: NewsItem[] = recentNews;

        // ── Build summary ─────────────────────────────────────────────
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
          if (techData.rsi14 != null) techParts.push(`RSI ${techData.rsi14.toFixed(1)}`);
          if (techData.trend && techData.trend !== "unknown") techParts.push(techData.trend.split(" ")[0]);
          if (techParts.length > 0) sParts.push(techParts.join(", "));
        }
        if (newsData.length > 0) sParts.push(`${newsData.length} news`);

        const tickerSummaryParts: string[] = [];
        if (companyData?.name) tickerSummaryParts.push(companyData.name);
        if (metaParts.length > 0) tickerSummaryParts.push(metaParts.join(" · "));
        if (techData?.rsi14 != null) tickerSummaryParts.push(`RSI ${techData.rsi14.toFixed(1)} ${techData.trend?.split(" ")[0] ?? ""}`);

        return {
          summary: sParts.join(". ") + ".",
          tickers: [{ ticker, tag: "Research", summary: tickerSummaryParts.join(". ") }],
          _sources: [
            {
              provider: "Finnhub",
              title: `${ticker} Real-Time Quote`,
              excerpt: quoteData ? `$${quoteData.price} ${fPct(quoteData.changePct)} | High $${quoteData.high} Low $${quoteData.low}` : "Quote unavailable",
            },
            {
              provider: "Finnhub",
              title: `${ticker} Company Profile`,
              excerpt: companyData ? `${companyData.name} | ${companyData.sector} | ${companyData.exchange}` : "Profile unavailable",
            },
            {
              provider: "Finnhub",
              title: `${ticker} Key Financials`,
              excerpt: financialsData
                ? `P/E ${financialsData.peRatio?.toFixed(1) ?? "—"} | Beta ${financialsData.beta?.toFixed(2) ?? "—"} | 52W $${financialsData.low52w?.toFixed(0) ?? "?"}-$${financialsData.high52w?.toFixed(0) ?? "?"}`
                : "Financials unavailable",
            },
            ...(consensusData
              ? [{ provider: "Finnhub", title: `${ticker} Analyst Consensus`, excerpt: `Buy ${consensusData.buy + consensusData.strongBuy} | Hold ${consensusData.hold} | Sell ${consensusData.sell + consensusData.strongSell}` }]
              : []),
            ...newsData.map((n) => ({ provider: n.source, title: n.headline, url: n.url, excerpt: n.summary })),
            ...(techData
              ? [{ provider: techProvider, title: `${ticker} 90-Day Price History`, url: techProvider === "Finnhub" ? "https://finnhub.io/docs/api/stock-candles" : `https://financialmodelingprep.com/financial-statements/${ticker}`, excerpt: `RSI ${techData.rsi14?.toFixed(1) ?? "—"} | SMA20 $${techData.sma20?.toFixed(2) ?? "—"} | SMA50 $${techData.sma50?.toFixed(2) ?? "—"} | 52W position ${techData.positionIn52wRange}` }]
              : []),
            ...(targetsData
              ? [{ provider: "FMP", title: `${ticker} Analyst Price Targets`, url: `https://financialmodelingprep.com/api/v4/price-target-consensus?symbol=${ticker}`, excerpt: `Consensus $${targetsData.consensus ?? "—"} | High $${targetsData.high ?? "—"} | Low $${targetsData.low ?? "—"} | ${targetsData.numAnalysts ?? 0} analysts` }]
              : []),
          ],
          data: {
            quote: quoteData,
            company: companyData,
            financials: financialsData,
            technicals: techData,
            analystConsensus: consensusData,
            priceTargets: targetsData,
            news: newsData,
            ...(errors.length > 0 ? { apiErrors: errors } : {}),
          },
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
          const pcr = totalCallVol > 0 ? Math.round((totalPutVol / totalCallVol) * 100) / 100 : null;
          const sig = totalCallVol > 0 && totalPutVol / totalCallVol < 0.7
            ? "bullish (low put/call ratio)"
            : totalCallVol > 0 && totalPutVol / totalCallVol > 1.3
              ? "bearish (high put/call ratio)"
              : "neutral";
          const topContracts = unusualContracts.slice(0, 3);
          return {
            summary: `${ticker} options — P/C ratio ${pcr ?? "N/A"}, ${sig.split(" ")[0]}. ${topContracts.length} unusual contract${topContracts.length !== 1 ? "s" : ""}.`,
            tickers: [{ ticker, tag: "Research", summary: `P/C ${pcr ?? "N/A"} ${sig.split(" ")[0]}, ${topContracts.length} unusual contracts` }],
            _sources: [{ provider: "FMP", title: `${ticker} Options Chain`, url: `https://financialmodelingprep.com/api/v3/options/chain/${ticker}`, excerpt: `P/C ratio ${pcr ?? "—"} | ${totalCallVol.toLocaleString()} calls / ${totalPutVol.toLocaleString()} puts | ${topContracts.length} unusual contracts` }],
            data: {
              available: true,
              putCallRatio: pcr,
              totalCallVolume: totalCallVol,
              totalPutVolume: totalPutVol,
              contractsAvailable: fmpData.length,
              unusualContracts: topContracts,
              signal: sig,
              dataSource: "fmp",
            },
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
          const pcr2 = totalCallVol > 0 ? Math.round((totalPutVol / totalCallVol) * 100) / 100 : null;
          const sig2 = totalCallVol > 0 && totalPutVol / totalCallVol < 0.7
            ? "bullish (low put/call ratio)"
            : totalCallVol > 0 && totalPutVol / totalCallVol > 1.3
              ? "bearish (high put/call ratio)"
              : "neutral";
          return {
            summary: `${ticker} options — P/C ratio ${pcr2 ?? "N/A"}, ${sig2.split(" ")[0]}.`,
            tickers: [{ ticker, tag: "Research", summary: `P/C ${pcr2 ?? "N/A"} ${sig2.split(" ")[0]}` }],
            _sources: [{ provider: "Finnhub", title: `${ticker} Options Chain`, url: "https://finnhub.io/docs/api/stock-option-chain", excerpt: `P/C ratio ${pcr2 ?? "—"} | ${calls.length} calls / ${puts.length} puts` }],
            data: {
              available: true,
              putCallRatio: pcr2,
              totalCallVolume: totalCallVol,
              totalPutVolume: totalPutVol,
              contractsAvailable: calls.length + puts.length,
              unusualContracts: [],
              signal: sig2,
              dataSource: "finnhub",
            },
          };
        }

        logToolEnd("get_options_flow", _t0, ctx.runId, `ticker=${ticker} no_data`, stats);
        return {
          summary: `No options data available for ${ticker}.`,
          tickers: [{ ticker, tag: "Research", summary: "No options data — may be small-cap or illiquid" }],
          _sources: [{ provider: "Finnhub", title: `${ticker} Options Chain (No Data)`, url: "https://finnhub.io/docs/api/stock-option-chain", excerpt: "No options contracts found" }],
          data: {
            available: false,
            putCallRatio: null,
            totalCallVolume: 0,
            totalPutVolume: 0,
            contractsAvailable: 0,
            unusualContracts: [],
            signal: "unavailable",
            dataSource: "none",
          },
        };
      },
    }),

    // ── Migrated to defineTool — see lib/agent/tools/get-earnings-data.ts ──────
    get_earnings_data: getEarningsData(newCtx),

    record_thesis: tool({
      description:
        "STAGE 3 ONLY. Write a thesis for every ticker you researched in Stage 2, back to back, in one batch. Direction must be LONG, SHORT, or PASS — PASS theses are mandatory for tickers you researched but won't trade, they document the decision. Never call this in Stage 2 (research) or Stage 4 (execution). Never write a verdict as narration text instead of calling this tool.",
      inputSchema: thesisParams,
      execute: async (args: ThesisInput) => {
        const _t0 = Date.now();
        logToolStart("record_thesis", ctx.runId, `ticker=${args.ticker} direction=${args.direction} confidence=${args.confidence_score}`, stats);
        try {
          // Core thesis data (columns that exist in all environments)
          const coreData = {
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
          };

          // Try with V2 fields first, fall back to core-only if columns don't exist
          let thesis;
          try {
            thesis = await prisma.thesis.create({
              data: {
                ...coreData,
                status: "ACTIVE",
                parentThesisId: args.parent_thesis_id ?? null,
              },
            });
          } catch (v2Err: unknown) {
            const errMsg = v2Err instanceof Error ? v2Err.message : String(v2Err);
            if (errMsg.includes("status") || errMsg.includes("parentThesisId") || errMsg.includes("Unknown arg")) {
              console.warn("[tool] record_thesis: V2 columns not available, falling back to core schema");
              thesis = await prisma.thesis.create({ data: coreData });
            } else {
              throw v2Err;
            }
          }

          // V2 Phase 3: Handle parent thesis lifecycle transition (non-fatal)
          if (args.parent_thesis_id) {
            try {
              if (args.direction === "PASS") {
                await prisma.thesis.update({
                  where: { id: args.parent_thesis_id },
                  data: {
                    status: "INVALIDATED",
                    invalidatedAt: new Date(),
                    invalidReason: args.reasoning_summary?.slice(0, 500) || "Thesis invalidated by follow-up research",
                  },
                });
              } else {
                await prisma.thesis.update({
                  where: { id: args.parent_thesis_id },
                  data: { status: "SUPERSEDED" },
                });
              }
            } catch (parentErr) {
              console.warn(`[tool] record_thesis: parent thesis update skipped (V2 columns may not exist):`, parentErr);
            }
          }

          // V2 Phase 3: Update watchlist item's lastThesisId if applicable
          const analystIdForWatchlist = ctx.analystId;
          if (analystIdForWatchlist) {
            try {
              await prisma.analystWatchlistItem.updateMany({
                where: { analystId: analystIdForWatchlist, symbol: args.ticker, status: "ACTIVE" },
                data: { lastThesisId: thesis.id },
              });
            } catch {
              // Non-fatal
            }
          }

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
              console.log(`[tool] record_thesis recorded PASS decision for ${args.ticker} analystId=${analystId}`);
            } catch (passErr) {
              console.error("[tool] record_thesis PASS decision creation FAILED:", passErr);
            }
          } else if (args.direction === "PASS") {
            console.warn(`[tool] record_thesis SKIPPED PASS decision — missing runId=${ctx.runId}`);
          }

          logToolEnd("record_thesis", _t0, ctx.runId, `ticker=${args.ticker} id=${thesis.id}`, stats);
          // Return ALL args so the UI can render the full thesis card
          return {
            thesis_id: thesis.id,
            ticker: args.ticker,
            company_name: args.company_name ?? null,
            exchange: args.exchange ?? null,
            direction: args.direction,
            confidence_score: args.confidence_score,
            reasoning_summary: args.reasoning_summary,
            thesis_bullets: args.thesis_bullets,
            risk_flags: args.risk_flags,
            entry_price: args.entry_price ?? null,
            target_price: args.target_price ?? null,
            stop_loss: args.stop_loss ?? null,
            hold_duration: args.hold_duration,
            signal_types: args.signal_types,
            _sources: args.sources_used ?? [],
            fundamentals: args.fundamentals ?? null,
            status: "ACTIVE",
            parent_thesis_id: args.parent_thesis_id ?? null,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Thesis save failed";
          console.error(`[tool] record_thesis FAILED for ${args.ticker}: ${msg}`);
          return {
            thesis_id: null,
            ticker: args.ticker,
            company_name: args.company_name ?? null,
            exchange: args.exchange ?? null,
            direction: args.direction,
            confidence_score: args.confidence_score,
            reasoning_summary: args.reasoning_summary,
            thesis_bullets: args.thesis_bullets,
            risk_flags: args.risk_flags,
            entry_price: args.entry_price ?? null,
            target_price: args.target_price ?? null,
            stop_loss: args.stop_loss ?? null,
            hold_duration: args.hold_duration,
            signal_types: args.signal_types,
            fundamentals: args.fundamentals ?? null,
            _sources: args.sources_used ?? [],
            status: "ACTIVE",
            parent_thesis_id: args.parent_thesis_id ?? null,
            error: msg,
            note: "Thesis could not be saved to DB. place_trade requires a thesis_id — do NOT attempt to trade this ticker.",
          };
        }
      },
    }),

    // ── Trade Execution ───────────────────────────────────────────────────
    place_trade: tool({
      description:
        "Place a paper trade on Alpaca. The trade will be executed immediately. Requires thesis_id from record_thesis. Will fail if any analyst already holds an open position in this ticker.",
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
            const blockedMsg = `Already holding an open position in ${args.ticker}. Cannot open duplicate positions across analysts.`;
            return {
              summary: `Trade blocked: $${args.ticker} — duplicate position`,
              tickers: [{ ticker: args.ticker, tag: "Failed", summary: blockedMsg }] as TickerFinding[],
              _sources: [] as ToolSource[],
              data: {
                success: false,
                ticker: args.ticker,
                status: "FAILED" as const,
                direction: args.direction,
                message: blockedMsg,
              },
            };
          }

          // 1. Place Alpaca paper order
          const alpacaOrder = await placeMarketOrder({
            symbol: args.ticker,
            qty: args.shares,
            side: args.direction === "LONG" ? "buy" : "sell",
          }, ctx.alpacaCreds);
          console.log(`[tool] place_trade Alpaca order placed: ${alpacaOrder.id}`);

          // 2. Wait for fill (max 5s), fall back to entry price
          // TODO: This should become async/non-blocking in future — fire-and-forget
          // the order and use a webhook or polling job to update fill status.
          let fillPrice = args.entry_price;
          let didFill = false;
          let filledAt: Date | null = null;
          const placedAt = new Date();
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline) {
            const order = await getOrder(alpacaOrder.id, ctx.alpacaCreds);
            if (order.status === "filled" && order.filled_avg_price) {
              fillPrice = parseFloat(order.filled_avg_price);
              didFill = true;
              filledAt = order.filled_at ? new Date(order.filled_at) : new Date();
              break;
            }
            if (["cancelled", "expired", "rejected"].includes(order.status)) {
              throw new Error(`Alpaca order ${order.status}`);
            }
            await new Promise((r) => setTimeout(r, 1_000));
          }
          // If still not filled (e.g. submitted after-hours), grab a reference
          // price for the displayed avgCost but flag the Order as PENDING so
          // the UI can show "Pending fill" instead of pretending it filled.
          if (!didFill) {
            try { fillPrice = await getLatestPrice(args.ticker, ctx.alpacaCreds); } catch { /* keep entry_price */ }
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

            // Create the order (what we told Alpaca). If Alpaca didn't confirm
            // the fill within our 5s window, mark it PENDING so the UI shows
            // "Pending fill" rather than pretending it filled.
            const ord = await tx.order.create({
              data: {
                positionId: pos.id,
                userId: ctx.userId,
                symbol: args.ticker,
                side: args.direction === "LONG" ? "BUY" : "SELL",
                orderType: "MARKET",
                quantity: args.shares,
                status: didFill ? "FILLED" : "PENDING",
                filledPrice: didFill ? fillPrice : null,
                filledQty: didFill ? args.shares : null,
                filledAt: didFill ? (filledAt ?? new Date()) : null,
                alpacaOrderId: alpacaOrder.id,
                createdAt: placedAt,
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
            // V2: Use INITIATE (new position) instead of BUY/SELL
            await tx.tradeDecision.create({
              data: {
                runId: ctx.runId,
                analystId,
                userId: ctx.userId,
                symbol: args.ticker,
                decision: "INITIATE",
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
                data: { status: "GRADUATED", removeReason: "Promoted to active position", removedAt: new Date(), promotedToPositionId: position.id },
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

          // Fetch post-trade portfolio context
          let portfolioUpdate: { remainingSlots: number; remainingBuyingPower: number; openPositionCount: number } | null = null;
          try {
            const currentOpenCount = await prisma.position.count({
              where: { analystId: analystId, status: "OPEN" },
            });
            const postAccount = await getAccount(ctx.alpacaCreds);
            portfolioUpdate = {
              remainingSlots: (ctx.maxOpenPositions ?? 5) - currentOpenCount,
              remainingBuyingPower: parseFloat(postAccount.buying_power),
              openPositionCount: currentOpenCount,
            };
          } catch (portfolioErr) {
            console.warn("[tool] place_trade portfolio update fetch failed:", portfolioErr);
          }

          logToolEnd("place_trade", _t0, ctx.runId, `ticker=${args.ticker} fill=$${fillPrice.toFixed(2)} ${didFill ? "FILLED" : "PENDING"}`, stats);
          const tag = args.direction === "LONG" ? "Buy" : "Sell";
          const itemSummary = didFill
            ? `${args.shares} shares @ $${fillPrice.toFixed(2)} · target $${args.target_price.toFixed(2)} · stop $${args.stop_loss.toFixed(2)}`
            : `${args.shares} shares submitted (pending fill) · ref $${fillPrice.toFixed(2)} · target $${args.target_price.toFixed(2)} · stop $${args.stop_loss.toFixed(2)}`;
          const message = didFill
            ? `${args.direction} ${args.shares} shares of ${args.ticker} filled at $${fillPrice.toFixed(2)}`
            : `${args.direction} ${args.shares} shares of ${args.ticker} submitted to Alpaca — awaiting fill (current price $${fillPrice.toFixed(2)})`;
          return {
            summary: didFill
              ? `Placed order: ${args.direction} ${args.shares} $${args.ticker} @ $${fillPrice.toFixed(2)}`
              : `Order submitted (pending): ${args.direction} ${args.shares} $${args.ticker}`,
            tickers: [{ ticker: args.ticker, tag, summary: itemSummary }] as TickerFinding[],
            _sources: [{ provider: "Alpaca", title: `Trade ${args.ticker}` }] as ToolSource[],
            data: {
              success: true,
              ticker: args.ticker,
              status: didFill ? ("FILLED" as const) : ("PENDING" as const),
              fillStatus: didFill ? ("FILLED" as const) : ("PENDING" as const),
              direction: args.direction,
              shares: args.shares,
              entryPrice: fillPrice,
              targetPrice: args.target_price,
              stopLoss: args.stop_loss,
              positionId: position.id,
              orderId: order.id,
              alpacaOrderId: alpacaOrder.id,
              placedAt: placedAt.toISOString(),
              filledAt: filledAt ? filledAt.toISOString() : null,
              message,
              ...(portfolioUpdate ? { portfolioUpdate } : {}),
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Trade placement failed";
          console.error(`[tool] place_trade FAILED for ${args.ticker}: ${msg}`);
          logToolEnd("place_trade", _t0, ctx.runId, `ticker=${args.ticker} FAILED`, stats);
          return {
            summary: `Trade failed: $${args.ticker}`,
            tickers: [{ ticker: args.ticker, tag: "Failed", summary: msg }] as TickerFinding[],
            _sources: [] as ToolSource[],
            data: {
              success: false,
              ticker: args.ticker,
              status: "FAILED" as const,
              direction: args.direction,
              message: msg,
            },
          };
        }
      },
    }),

    // ── Close Position ──────────────────────────────────────────────────
    close_position: tool({
      description:
        "Explicitly close an existing open position by symbol. " +
        "This tool performs one action only: closing the position. " +
        "Call this during the execution phase when your analysis indicates a position should be exited.",
      inputSchema: z.object({
        ticker: z.string().describe("Ticker symbol of the position to close"),
        reason: z.enum(["TARGET", "STOP", "MANUAL"]).default("MANUAL")
          .describe("TARGET if hit price target, STOP if risk management, MANUAL for portfolio rebalancing"),
        notes: z.string().optional().describe("Optional notes explaining the close decision"),
      }),
      execute: async (args) => {
        const _t0 = Date.now();
        const ticker = args.ticker.toUpperCase().trim();
        logToolStart("close_position", ctx.runId, `ticker=${ticker} reason=${args.reason}`, stats);
        try {
          // Find open position
          const position = await prisma.position.findFirst({
            where: { userId: ctx.userId, symbol: ticker, status: "OPEN" },
            include: { analyst: { select: { name: true } } },
          });

          if (!position) {
            logToolEnd("close_position", _t0, ctx.runId, `${ticker} NO_POSITION`, stats);
            const noPosMsg = `No open position in ${ticker}. No action taken.`;
            return {
              summary: `No position to close: $${ticker}`,
              tickers: [{ ticker, tag: "NoOp", summary: noPosMsg }] as TickerFinding[],
              _sources: [] as ToolSource[],
              data: {
                success: true,
                ticker,
                reason: args.reason,
                status: "NO_POSITION" as const,
                message: noPosMsg,
              },
            };
          }

          // Lazy import to avoid circular deps (same pattern as trade-exit.ts)
          const { closeOpenPosition } = await import("@/lib/actions/closeTrade.actions");
          const result = await closeOpenPosition(position.id, args.reason);

          // Record EXIT decision (V2: was "SELL", now "EXIT") — link to the closing order
          const analystId = ctx.analystId || position.analystId;
          const fillNote = result.fillStatus === "PENDING" ? " (close order pending fill)" : "";
          const reasoningNote = args.notes
            ? `Closed ${position.direction} position: ${args.reason}. ${args.notes}. P&L: $${result.realizedPnl.toFixed(2)} (${result.outcome})${fillNote}`
            : `Closed ${position.direction} position: ${args.reason}. P&L: $${result.realizedPnl.toFixed(2)} (${result.outcome})${fillNote}`;
          try {
            await prisma.tradeDecision.create({
              data: {
                runId: ctx.runId,
                analystId,
                userId: ctx.userId,
                symbol: ticker,
                decision: "EXIT",
                reasoning: reasoningNote,
                positionId: position.id,
                orderId: result.orderId,
              },
            });
          } catch (decisionErr) {
            console.warn("[tool] close_position TradeDecision write failed:", decisionErr);
          }

          // Write RunEvent
          if (ctx.runId) {
            try {
              await prisma.runEvent.create({
                data: {
                  runId: ctx.runId,
                  type: "position_closed",
                  title: `Closed ${position.direction} ${ticker}`,
                  message: `Closed ${position.quantity} shares at $${result.closePrice.toFixed(2)} — ${result.outcome} ($${result.realizedPnl.toFixed(2)})`,
                  payload: {
                    ticker,
                    direction: position.direction,
                    shares: position.quantity,
                    entry_price: position.avgCost,
                    close_price: result.closePrice,
                    realized_pnl: result.realizedPnl,
                    outcome: result.outcome,
                    reason: args.reason,
                    notes: args.notes ?? null,
                  } as object,
                },
              });
            } catch (evtErr) {
              console.warn("[tool] close_position RunEvent write failed:", evtErr);
            }
          }

          // V2 Phase 3: Mark linked thesis as CLOSED
          try {
            const activeThesis = await prisma.thesis.findFirst({
              where: {
                ticker,
                status: "ACTIVE",
                direction: { not: "PASS" },
                researchRun: { agentConfigId: analystId },
              },
              orderBy: { createdAt: "desc" },
            });

            if (activeThesis) {
              await prisma.thesis.update({
                where: { id: activeThesis.id },
                data: { status: "CLOSED" },
              });
            }
          } catch (thesisErr) {
            console.warn(`[tool] close_position failed to mark thesis CLOSED for ${ticker}:`, thesisErr);
            // Non-fatal
          }

          const pnlPct = position.avgCost > 0
            ? (result.realizedPnl / (position.avgCost * position.quantity)) * 100
            : 0;

          // Fetch post-close portfolio context
          let portfolioUpdate: { remainingSlots: number; remainingBuyingPower: number; openPositionCount: number } | null = null;
          try {
            const currentOpenCount = await prisma.position.count({
              where: { analystId: analystId, status: "OPEN" },
            });
            const postAccount = await getAccount(ctx.alpacaCreds);
            portfolioUpdate = {
              remainingSlots: (ctx.maxOpenPositions ?? 5) - currentOpenCount,
              remainingBuyingPower: parseFloat(postAccount.buying_power),
              openPositionCount: currentOpenCount,
            };
          } catch (portfolioErr) {
            console.warn("[tool] close_position portfolio update fetch failed:", portfolioErr);
          }

          logToolEnd("close_position", _t0, ctx.runId, `${ticker} pnl=$${result.realizedPnl.toFixed(2)} ${result.fillStatus}`, stats);
          const pnlSign = result.realizedPnl >= 0 ? "+" : "";
          const isPending = result.fillStatus === "PENDING";
          const itemSummary = isPending
            ? `${position.quantity} shares close submitted (pending) · est $${result.closePrice.toFixed(2)}`
            : `${position.quantity} shares closed @ $${result.closePrice.toFixed(2)} · ${result.outcome} ${pnlSign}$${result.realizedPnl.toFixed(2)}`;
          const closeMessage = isPending
            ? `Close order submitted for ${position.direction} ${position.quantity} shares of ${ticker} — awaiting Alpaca fill (estimated price $${result.closePrice.toFixed(2)})`
            : `Closed ${position.direction} ${position.quantity} shares of ${ticker} at $${result.closePrice.toFixed(2)}. ${result.outcome}: $${pnlSign}${result.realizedPnl.toFixed(2)}`;
          return {
            summary: isPending
              ? `Close submitted (pending): $${ticker}`
              : `Closed $${ticker}: ${result.outcome} ${pnlSign}$${result.realizedPnl.toFixed(2)}`,
            tickers: [{ ticker, tag: isPending ? "Closing" : "Closed", summary: itemSummary }] as TickerFinding[],
            _sources: [{ provider: "Alpaca", title: `Close ${ticker}` }] as ToolSource[],
            data: {
              success: true,
              ticker,
              reason: args.reason,
              shares: position.quantity,
              status: isPending ? ("PENDING" as const) : ("CLOSED" as const),
              fillStatus: result.fillStatus,
              direction: position.direction,
              entryPrice: position.avgCost,
              closePrice: result.closePrice,
              realizedPnl: result.realizedPnl,
              pnlPct: Math.round(pnlPct * 100) / 100,
              outcome: result.outcome,
              orderId: result.orderId,
              alpacaOrderId: result.alpacaOrderId,
              placedAt: result.placedAt.toISOString(),
              filledAt: result.filledAt?.toISOString() ?? null,
              message: closeMessage,
              ...(portfolioUpdate ? { portfolioUpdate } : {}),
            },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Position close failed";
          console.error(`[tool] close_position FAILED for ${ticker}: ${msg}`);
          logToolEnd("close_position", _t0, ctx.runId, `${ticker} FAILED`, stats);
          return {
            summary: `Close failed: $${ticker}`,
            tickers: [{ ticker, tag: "Failed", summary: msg }] as TickerFinding[],
            _sources: [] as ToolSource[],
            data: {
              success: false,
              ticker,
              reason: args.reason,
              status: "FAILED" as const,
              message: msg,
            },
          };
        }
      },
    }),

    // ── Stage 4: Decision Plan ──────────────────────────────────────────────
    // Fires once after all theses are written. The agent passes a single
    // synthesis paragraph (the "review everything and decide" moment) plus
    // its list of planned actions for every researched ticker. The plan is
    // persisted to run.parameters.decisionPlan so record_run_summary can
    // read it back when it builds the run_summary RunEvent that the briefing
    // agent depends on. The briefing payload shape is preserved byte-for-byte.
    record_decision_plan: tool({
      description:
        "STAGE 4 ONLY. Fires ONCE after all theses are written, before any execution tool. Pass a single synthesis paragraph explaining your overall decision (the 'I reviewed everything and decided X' moment — required even if you decide not to trade) plus your planned actions for every researched ticker. Your IMMEDIATE next step after this is Stage 5 — execute the planned actions in order. Do not stop.",
      inputSchema: z.object({
        synthesis: z
          .string()
          .min(1)
          .describe(
            "ONE paragraph (3-6 sentences) reviewing all your theses against the portfolio. Always required, even if you're not trading. Examples: 'Thesis refresh confirms strong NIO momentum and durable BYD swing posture, but no new trades are warranted. Staying disciplined with concentrated EV positioning while risk-managing any sector-wide selloffs.' Or: 'FIVN and AKAM are the strongest setups today; opening both. AMZN and GSAT both lack near-term catalysts so passing on them.'",
          ),
        planned_actions: z
          .array(
            z.object({
              ticker: z.string(),
              action: z.enum([
                "INITIATE", "ADD", "HOLD", "REDUCE", "EXIT",
                "WATCH", "REMOVE_WATCH", "PASS",
              ]),
              reasoning: z
                .string()
                .describe("One-line rationale for this specific action"),
            }),
          )
          .describe(
            "Every ticker you researched in Stage 2, with the action you intend to take. INITIATE/ADD/REDUCE/EXIT lead to place_trade or close_position calls in Stage 5. WATCH/REMOVE_WATCH lead to manage_watchlist. HOLD/PASS take no action.",
          ),
        risk_notes: z
          .array(z.string())
          .optional()
          .describe(
            "Optional portfolio-level risk observations (correlation, concentration, macro headwinds). Used by the briefing agent — not rendered to the user separately from your synthesis.",
          ),
      }),
      execute: async (args) => {
        const _t0 = Date.now();
        logToolStart("record_decision_plan", ctx.runId, `actions=${args.planned_actions.length}`, stats);
        try {
          // Persist plan to run.parameters JSON so record_run_summary can read
          // it back. Merge with existing parameters to preserve other fields.
          if (ctx.runId) {
            const existing = await prisma.researchRun.findFirst({
              where: { id: ctx.runId },
              select: { parameters: true },
            });
            const params = (existing?.parameters && typeof existing.parameters === "object")
              ? (existing.parameters as Record<string, unknown>)
              : {};
            await prisma.researchRun.update({
              where: { id: ctx.runId },
              data: {
                parameters: {
                  ...params,
                  decisionPlan: {
                    synthesis: args.synthesis,
                    planned_actions: args.planned_actions,
                    risk_notes: args.risk_notes ?? [],
                    recorded_at: new Date().toISOString(),
                  },
                } as object,
              },
            });
          }
          logToolEnd("record_decision_plan", _t0, ctx.runId, `actions=${args.planned_actions.length}`, stats);
          return {
            success: true,
            synthesis: args.synthesis,
            planned_actions: args.planned_actions,
            risk_notes: args.risk_notes ?? [],
            action_count: args.planned_actions.filter(
              (p) => p.action !== "HOLD" && p.action !== "PASS",
            ).length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Decision plan persistence failed";
          console.error(`[tool] record_decision_plan FAILED: ${msg}`);
          logToolEnd("record_decision_plan", _t0, ctx.runId, "FAILED", stats);
          return {
            success: false,
            synthesis: args.synthesis,
            planned_actions: args.planned_actions,
            risk_notes: args.risk_notes ?? [],
            action_count: 0,
            error: msg,
          };
        }
      },
    }),

    // ── Stage 6: Run Summary ────────────────────────────────────────────────
    // Fires after all action tools, before complete_run. Pure data-only
    // recap: rankedPicks table + exposure breakdown. The synthesis text the
    // user sees lives in the Decision CoT (record_decision_plan), not here.
    //
    // CRITICAL: this tool writes the `run_summary` RunEvent that the briefing
    // agent reads from `lib/agent/update-analyst-briefing.ts`. Payload shape
    // is preserved byte-for-byte: { summary, ranked_picks, risk_notes,
    // overall_assessment }. We pull synthesis + risk_notes from the stored
    // decision plan so the briefing keeps reading the same fields it always
    // has. Briefing code is NOT touched.
    record_run_summary: tool({
      description:
        "STAGE 6. Fires after all execution tools (Stage 5), before complete_run. Pass the ranked picks and exposure breakdown — pure data. The synthesis paragraph from your record_decision_plan call is automatically attached for the briefing agent. Your IMMEDIATE next step after this is Stage 7 — call complete_run.",
      inputSchema: z.object({
        ranked_picks: z
          .array(
            z.object({
              rank: z.number(),
              ticker: z.string(),
              direction: z.enum(["LONG", "SHORT", "PASS"]),
              confidence: z.number(),
              reasoning: z
                .string()
                .describe("One-line rationale (<= 80 chars)"),
              action: z.enum([
                "INITIATE", "ADD", "HOLD", "REDUCE", "EXIT",
                "WATCH", "REMOVE_WATCH", "PASS", "FAILED",
              ]),
            }),
          )
          .describe(
            "Every ticker you researched in Stage 2, ranked by conviction, with the action that ACTUALLY happened in Stage 5. Use FAILED for tickers where place_trade returned success: false (e.g. duplicate position).",
          ),
        exposure_breakdown: z
          .object({
            long_exposure: z.number().describe("Total $ in long positions"),
            short_exposure: z.number().describe("Total $ in short positions"),
            net_exposure: z.number().describe("Net $ exposure (long - short)"),
          })
          .optional(),
      }),
      execute: async (args) => {
        const _t0 = Date.now();
        logToolStart("record_run_summary", ctx.runId, `picks=${args.ranked_picks.length}`, stats);
        try {
          // Read the decision plan we stored in Stage 4 so we can attach
          // synthesis + risk_notes to the run_summary RunEvent payload.
          // The briefing agent depends on these fields existing in the
          // payload — see lib/agent/update-analyst-briefing.ts:300-309.
          let synthesis = "";
          let riskNotes: string[] = [];
          if (ctx.runId) {
            const run = await prisma.researchRun.findFirst({
              where: { id: ctx.runId },
              select: { parameters: true },
            });
            const params = (run?.parameters && typeof run.parameters === "object")
              ? (run.parameters as Record<string, unknown>)
              : {};
            const plan = params.decisionPlan as
              | { synthesis?: string; risk_notes?: string[] }
              | undefined;
            if (plan?.synthesis) synthesis = plan.synthesis;
            if (Array.isArray(plan?.risk_notes)) riskNotes = plan.risk_notes;
          }

          const traded = args.ranked_picks.filter((p) => {
            const a = p.action.toUpperCase();
            return a === "INITIATE" || a === "ADD";
          }).length;

          // Write the run_summary RunEvent in the EXACT shape the briefing
          // agent reads. Do not change these field names.
          if (ctx.runId) {
            try {
              await prisma.runEvent.create({
                data: {
                  runId: ctx.runId,
                  type: "run_summary",
                  title: "Run Summary",
                  message: synthesis,
                  payload: {
                    summary: synthesis,
                    ranked_picks: args.ranked_picks,
                    risk_notes: riskNotes,
                    overall_assessment: synthesis,
                    portfolio_review: synthesis,
                  } as object,
                },
              });
            } catch (evtErr) {
              console.error(
                `[tool] record_run_summary RunEvent write failed:`,
                evtErr instanceof Error ? evtErr.message : evtErr,
              );
            }
          }

          // Record HOLD decisions for positions not acted on. (Moved here
          // from old complete_run — same logic, same reason: build the
          // institutional record of what the agent decided.)
          const holdPicks = args.ranked_picks.filter(
            (p) => p.action.toUpperCase() === "HOLD",
          );
          if (holdPicks.length > 0 && ctx.analystId && ctx.runId) {
            for (const pick of holdPicks) {
              try {
                const position = await prisma.position.findFirst({
                  where: {
                    analystId: ctx.analystId,
                    symbol: pick.ticker.toUpperCase(),
                    status: "OPEN",
                  },
                  select: { id: true },
                });
                await prisma.tradeDecision.create({
                  data: {
                    runId: ctx.runId,
                    analystId: ctx.analystId,
                    userId: ctx.userId,
                    symbol: pick.ticker.toUpperCase(),
                    decision: "HOLD",
                    reasoning: pick.reasoning?.slice(0, 500) ?? null,
                    positionId: position?.id ?? null,
                  },
                });
              } catch (holdErr) {
                console.warn(
                  `[tool] record_run_summary HOLD decision failed for ${pick.ticker}:`,
                  holdErr instanceof Error ? holdErr.message : holdErr,
                );
              }
            }
          }

          logToolEnd("record_run_summary", _t0, ctx.runId, `picks=${args.ranked_picks.length} traded=${traded}`, stats);
          const eb = args.exposure_breakdown;
          return {
            success: true,
            rankedPicks: args.ranked_picks,
            exposureBreakdown: eb
              ? {
                  longExposure: eb.long_exposure,
                  shortExposure: eb.short_exposure,
                  netExposure: eb.net_exposure,
                }
              : undefined,
            traded,
            analyzed: args.ranked_picks.length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Run summary persistence failed";
          console.error(`[tool] record_run_summary FAILED: ${msg}`);
          logToolEnd("record_run_summary", _t0, ctx.runId, "FAILED", stats);
          return {
            success: false,
            rankedPicks: args.ranked_picks,
            exposureBreakdown: undefined,
            traded: 0,
            analyzed: args.ranked_picks.length,
            error: msg,
          };
        }
      },
    }),

    // ── Stage 7: Complete Run ───────────────────────────────────────────────
    // The final tool call. Marks the run COMPLETE in the DB, runs the
    // existing briefing block (UNTOUCHED — see PR #132 for the long story
    // on why this lives here inline), writes the briefing_generated
    // RunEvent. No args. No recap data. No table. Just "we're done."
    //
    // The briefing block is preserved byte-for-byte from the previous
    // implementation. Do not modify it without coordinating with the
    // briefing path which has been broken multiple times.
    complete_run: tool({
      description:
        "STAGE 7. Mark the run complete. This is your absolute final tool call. No arguments — every recap field already lives in record_decision_plan and record_run_summary. Calling this triggers the post-run briefing agent automatically.",
      inputSchema: z.object({}),
      execute: async () => {
        const _t0 = Date.now();
        logToolStart("complete_run", ctx.runId, undefined, stats);
        try {
          // Atomic: only transition non-COMPLETE → COMPLETE.
          const completeResult = await prisma.researchRun.updateMany({
            where: { id: ctx.runId, status: { not: "COMPLETE" } },
            data: { status: "COMPLETE", completedAt: new Date() },
          });
          if (completeResult.count === 0) {
            console.log(`[tool] complete_run: run ${ctx.runId} already COMPLETE, skipping status update`);
          }

          // Write run_complete event for the runs list / activity feed.
          if (ctx.runId) {
            try {
              await prisma.runEvent.create({
                data: {
                  runId: ctx.runId,
                  type: "run_complete",
                  title: "Run complete",
                  message: null,
                  payload: {} as object,
                },
              });
            } catch (evtErr) {
              console.error(
                `[tool] complete_run run_complete event failed:`,
                evtErr instanceof Error ? evtErr.message : evtErr,
              );
            }
          }

          // ── Briefing block (UNTOUCHED from PR #132) ─────────────────────
          // Generate post-run briefing directly. updateAnalystBriefing
          // throws on failure. We verify the row was actually written.
          console.log(`[tool] complete_run: ENTERING briefing block for run=${ctx.runId} analystId=${ctx.analystId ?? "MISSING"}`);
          let briefingStatus: "success" | "failed" | "skipped" = "skipped";
          let briefingError: string | null = null;
          if (ctx.analystId) {
            try {
              console.log(`[tool] complete_run: calling updateAnalystBriefing for analyst=${ctx.analystId} run=${ctx.runId}`);
              const briefStart = Date.now();
              await updateAnalystBriefing({ analystId: ctx.analystId, runId: ctx.runId, userId: ctx.userId });
              console.log(`[tool] complete_run: updateAnalystBriefing returned for run=${ctx.runId} in ${Date.now() - briefStart}ms`);
              const writtenBrief = await prisma.analystBriefing.findFirst({
                where: { runId: ctx.runId },
                select: { id: true },
              });
              if (writtenBrief) {
                briefingStatus = "success";
                console.log(`[tool] complete_run: ✅ briefing written and verified for run=${ctx.runId} (id=${writtenBrief.id})`);
              } else {
                briefingStatus = "failed";
                briefingError = "updateAnalystBriefing returned without throwing but no AnalystBriefing row was persisted. Check [briefing] logs.";
                console.error(`[tool] complete_run: ❌ ${briefingError}`);
              }
            } catch (briefErr) {
              briefingStatus = "failed";
              briefingError = briefErr instanceof Error ? briefErr.message : String(briefErr);
              console.error(`[tool] complete_run: briefing generation THREW for run=${ctx.runId}:`, briefingError);
            }
          } else {
            briefingError = "No analyst linked to this run — briefing requires an analyst context.";
            console.warn(`[tool] complete_run: no analystId in context (runId=${ctx.runId}) — briefing skipped`);
          }
          console.log(`[tool] complete_run: EXITING briefing block for run=${ctx.runId} status=${briefingStatus}`);

          // Record briefing event so it's visible in the run UI.
          try {
            await prisma.runEvent.create({
              data: {
                runId: ctx.runId,
                type: "briefing_generated",
                title: briefingStatus === "success"
                  ? "Portfolio briefing written"
                  : briefingStatus === "failed"
                    ? "Portfolio briefing FAILED"
                    : "Portfolio briefing skipped",
                message: briefingStatus === "success"
                  ? "GPT-4o reviewed the full session and wrote the standup brief for the next run."
                  : briefingError ?? "Briefing generation did not run.",
                payload: {
                  briefingStatus,
                  ...(briefingError ? { error: briefingError } : {}),
                } as object,
              },
            });
          } catch (evtErr) {
            console.error(`[tool] complete_run: failed to write briefing_generated event:`, evtErr);
          }

          logToolEnd("complete_run", _t0, ctx.runId, `briefing=${briefingStatus}`, stats);
          return {
            ok: true,
            briefing: briefingStatus,
            briefingError,
          };
        } catch (err) {
          console.error(`[tool] complete_run FAILED:`, err instanceof Error ? err.message : err);
          // Best-effort: try to mark run COMPLETE even if everything else failed
          try {
            await prisma.researchRun.updateMany({
              where: { id: ctx.runId, status: { not: "COMPLETE" } },
              data: { status: "COMPLETE", completedAt: new Date() },
            });
          } catch { /* already tried */ }
          logToolEnd("complete_run", _t0, ctx.runId, "FAILED", stats);
          return {
            ok: false,
            briefing: "skipped" as const,
            briefingError: err instanceof Error ? err.message : "complete_run failed",
            error: err instanceof Error ? err.message : "complete_run failed",
          };
        }
      },
    }),
    // ── Watchlist management ──────────────────────────────────────────────

    manage_watchlist: tool({
      description:
        "Explicitly add, remove, or update a watchlist item during a run. " +
        "This tool mutates watchlist state only. It does not research the stock, generate a thesis, or place trades. " +
        "Use when you want to save an idea for later, remove a dead idea, change watch priority, or attach notes/catalysts/targets after research.",
      inputSchema: z.object({
        action: z.enum(["ADD", "REMOVE", "UPDATE"]).describe("What to do with the watchlist item"),
        ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
        reason: z.string().describe("Why this stock is being added/removed/updated"),
        priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().describe("LOW = background monitoring, MEDIUM = review when relevant, HIGH = review every run"),
        notes: z.string().optional().describe("Additional notes or conditions (e.g. 'Review if price drops below $150')"),
        thesis_direction: z.enum(["LONG", "SHORT", "PASS"]).optional().describe("Your directional view on this stock"),
        target_price: z.number().optional().describe("Price target you're watching for"),
        stop_price: z.number().optional().describe("Price level that would invalidate the thesis"),
        conviction: z.number().min(0).max(100).optional().describe("Conviction score 0-100"),
        catalyst: z.string().optional().describe("Key catalyst being monitored (e.g. 'Q2 earnings Aug 1')"),
        trigger_condition: z.string().optional()
          .describe("Machine-readable trigger: 'price < 145', 'RSI < 30', 'earnings this week'"),
        review_frequency: z.enum(["DAILY", "WEEKLY", "ON_CATALYST"]).optional()
          .describe("How often to review this item"),
      }),
      execute: async (args) => {
        const _t0 = Date.now();
        const ticker = args.ticker.toUpperCase().trim();
        logToolStart("manage_watchlist", ctx.runId, `action=${args.action} ticker=${ticker}`, stats);

        const wlFail = (msg: string) => ({
          summary: `Watchlist ${args.action.toLowerCase()} failed: $${ticker}`,
          tickers: [{ ticker, tag: "Failed", summary: msg }] as TickerFinding[],
          _sources: [] as ToolSource[],
          data: { success: false, action: args.action, ticker, changed: false, message: msg },
        });

        if (!ctx.analystId) {
          logToolEnd("manage_watchlist", _t0, ctx.runId, "FAILED: no analystId", stats);
          return wlFail("Cannot manage watchlist without an analyst ID.");
        }

        // Validate numeric fields
        if (args.target_price !== undefined && args.target_price <= 0) {
          return wlFail("target_price must be positive.");
        }
        if (args.stop_price !== undefined && args.stop_price <= 0) {
          return wlFail("stop_price must be positive.");
        }

        // Map MEDIUM → NORMAL for DB compat (schema stores NORMAL, tool exposes MEDIUM for clarity)
        const dbPriority = args.priority === "MEDIUM" ? "NORMAL" : args.priority;

        try {
          if (args.action === "ADD") {
            // Check for existing active item
            const existing = await prisma.analystWatchlistItem.findFirst({
              where: { analystId: ctx.analystId, symbol: ticker, status: "ACTIVE" },
            });
            if (existing) {
              // Idempotent: merge only provided metadata into existing item
              const updated = await prisma.analystWatchlistItem.update({
                where: { id: existing.id },
                data: {
                  reason: args.reason,
                  ...(dbPriority ? { priority: dbPriority } : {}),
                  ...(args.notes !== undefined ? { notes: args.notes } : {}),
                  ...(args.thesis_direction ? { thesisDirection: args.thesis_direction } : {}),
                  ...(args.target_price !== undefined ? { targetPrice: args.target_price } : {}),
                  ...(args.stop_price !== undefined ? { stopPrice: args.stop_price } : {}),
                  ...(args.conviction !== undefined ? { conviction: args.conviction } : {}),
                  ...(args.catalyst !== undefined ? { catalyst: args.catalyst } : {}),
                  ...(args.trigger_condition !== undefined ? { triggerCondition: args.trigger_condition } : {}),
                  ...(args.review_frequency !== undefined ? { reviewFrequency: args.review_frequency } : {}),
                  lastReviewedAt: new Date(),
                },
              });
              logToolEnd("manage_watchlist", _t0, ctx.runId, `MERGED existing ${ticker}`, stats);
              const mergedSummary = args.reason || (updated.catalyst ? `Catalyst: ${updated.catalyst}` : "Updated metadata");
              return {
                summary: `Updated $${ticker} on watchlist`,
                tickers: [{ ticker, tag: "Watch", summary: mergedSummary }] as TickerFinding[],
                _sources: [] as ToolSource[],
                data: {
                  success: true,
                  action: "ADD" as const,
                  ticker,
                  changed: true,
                  watchlist_item: {
                    ticker,
                    priority: updated.priority as "LOW" | "NORMAL" | "HIGH",
                    notes: updated.notes,
                    thesis_direction: updated.thesisDirection as "LONG" | "SHORT" | "PASS" | null,
                    target_price: updated.targetPrice,
                    stop_price: updated.stopPrice,
                    conviction: updated.conviction,
                    catalyst: updated.catalyst,
                    updated_at: updated.updatedAt.toISOString(),
                  },
                  message: `$${ticker} already on watchlist — merged updated metadata.`,
                },
              };
            }

            const created = await prisma.analystWatchlistItem.create({
              data: {
                analystId: ctx.analystId,
                userId: ctx.userId,
                symbol: ticker,
                reason: args.reason,
                notes: args.notes ?? null,
                addedBy: "AGENT",
                priority: dbPriority ?? "NORMAL",
                status: "ACTIVE",
                thesisDirection: args.thesis_direction ?? null,
                targetPrice: args.target_price ?? null,
                stopPrice: args.stop_price ?? null,
                conviction: args.conviction ?? null,
                catalyst: args.catalyst ?? null,
                triggerCondition: args.trigger_condition ?? null,
                reviewFrequency: args.review_frequency ?? null,
                addedRunId: ctx.runId ?? null,
                lastReviewedAt: new Date(),
              },
            });

            // Sync legacy watchlist array
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
                  title: `Added $${ticker} to watchlist`,
                  message: args.reason,
                  payload: { symbol: ticker, priority: dbPriority ?? "NORMAL", reason: args.reason } as object,
                },
              });
            }

            // V2: Record WATCH decision
            if (ctx.runId && ctx.analystId) {
              try {
                await prisma.tradeDecision.create({
                  data: {
                    runId: ctx.runId,
                    analystId: ctx.analystId,
                    userId: ctx.userId,
                    symbol: ticker,
                    decision: "WATCH",
                    reasoning: args.reason?.slice(0, 500) ?? null,
                  },
                });
              } catch (decisionErr) {
                console.warn("[tool] manage_watchlist WATCH decision write failed:", decisionErr);
              }
            }

            // Invalidate analyst page cache so sidebar shows the new item
            try { revalidatePath(`/analysts/${ctx.analystId}`); } catch { /* non-fatal */ }

            logToolEnd("manage_watchlist", _t0, ctx.runId, `ADDED ${ticker}`, stats);
            const addSummary = args.reason || (args.catalyst ? `Catalyst: ${args.catalyst}` : "Added to watchlist");
            return {
              summary: `Added $${ticker} to watchlist`,
              tickers: [{ ticker, tag: "Watch", summary: addSummary }] as TickerFinding[],
              _sources: [] as ToolSource[],
              data: {
                success: true,
                action: "ADD" as const,
                ticker,
                changed: true,
                watchlist_item: {
                  ticker,
                  priority: created.priority as "LOW" | "NORMAL" | "HIGH",
                  notes: created.notes,
                  thesis_direction: args.thesis_direction ?? null,
                  target_price: args.target_price ?? null,
                  stop_price: args.stop_price ?? null,
                  conviction: args.conviction ?? null,
                  catalyst: args.catalyst ?? null,
                  updated_at: created.updatedAt.toISOString(),
                },
                message: `Added $${ticker} to watchlist.`,
              },
            };
          }

          if (args.action === "REMOVE") {
            const item = await prisma.analystWatchlistItem.findFirst({
              where: { analystId: ctx.analystId, symbol: ticker, status: "ACTIVE" },
            });
            if (!item) {
              logToolEnd("manage_watchlist", _t0, ctx.runId, `${ticker} not on watchlist`, stats);
              const noopMsg = `$${ticker} is not on the watchlist. No action taken.`;
              return {
                summary: `Watchlist remove: $${ticker} (not present)`,
                tickers: [{ ticker, tag: "NoOp", summary: noopMsg }] as TickerFinding[],
                _sources: [] as ToolSource[],
                data: { success: true, action: "REMOVE" as const, ticker, changed: false, message: noopMsg },
              };
            }

            await prisma.analystWatchlistItem.update({
              where: { id: item.id },
              data: {
                status: "REMOVED",
                removedAt: new Date(),
                removeReason: args.reason,
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
                  title: `Removed $${ticker} from watchlist`,
                  message: args.reason,
                  payload: { symbol: ticker, reason: args.reason } as object,
                },
              });
            }

            // V2: Record REMOVE_WATCH decision
            if (ctx.runId && ctx.analystId) {
              try {
                await prisma.tradeDecision.create({
                  data: {
                    runId: ctx.runId,
                    analystId: ctx.analystId,
                    userId: ctx.userId,
                    symbol: ticker,
                    decision: "REMOVE_WATCH",
                    reasoning: args.reason?.slice(0, 500) ?? null,
                  },
                });
              } catch (decisionErr) {
                console.warn("[tool] manage_watchlist REMOVE_WATCH decision write failed:", decisionErr);
              }
            }

            try { revalidatePath(`/analysts/${ctx.analystId}`); } catch { /* non-fatal */ }

            logToolEnd("manage_watchlist", _t0, ctx.runId, `REMOVED ${ticker}`, stats);
            return {
              summary: `Removed $${ticker} from watchlist`,
              tickers: [{ ticker, tag: "Unwatch", summary: args.reason || "Removed from watchlist" }] as TickerFinding[],
              _sources: [] as ToolSource[],
              data: { success: true, action: "REMOVE" as const, ticker, changed: true, message: `Removed $${ticker} from watchlist.` },
            };
          }

          if (args.action === "UPDATE") {
            const item = await prisma.analystWatchlistItem.findFirst({
              where: { analystId: ctx.analystId, symbol: ticker, status: "ACTIVE" },
            });
            if (!item) {
              logToolEnd("manage_watchlist", _t0, ctx.runId, `${ticker} not on watchlist`, stats);
              const noopMsg = `$${ticker} is not on the watchlist. No action taken.`;
              return {
                summary: `Watchlist update: $${ticker} (not present)`,
                tickers: [{ ticker, tag: "NoOp", summary: noopMsg }] as TickerFinding[],
                _sources: [] as ToolSource[],
                data: { success: true, action: "UPDATE" as const, ticker, changed: false, message: noopMsg },
              };
            }

            const updated = await prisma.analystWatchlistItem.update({
              where: { id: item.id },
              data: {
                ...(args.reason ? { reason: args.reason } : {}),
                ...(dbPriority ? { priority: dbPriority } : {}),
                ...(args.notes !== undefined ? { notes: args.notes } : {}),
                ...(args.thesis_direction ? { thesisDirection: args.thesis_direction } : {}),
                ...(args.target_price !== undefined ? { targetPrice: args.target_price } : {}),
                ...(args.stop_price !== undefined ? { stopPrice: args.stop_price } : {}),
                ...(args.conviction !== undefined ? { conviction: args.conviction } : {}),
                ...(args.catalyst !== undefined ? { catalyst: args.catalyst } : {}),
                ...(args.trigger_condition !== undefined ? { triggerCondition: args.trigger_condition } : {}),
                ...(args.review_frequency !== undefined ? { reviewFrequency: args.review_frequency } : {}),
                lastReviewedAt: new Date(),
              },
            });

            try { revalidatePath(`/analysts/${ctx.analystId}`); } catch { /* non-fatal */ }

            logToolEnd("manage_watchlist", _t0, ctx.runId, `UPDATED ${ticker}`, stats);
            const updateSummary = args.reason || (updated.catalyst ? `Catalyst: ${updated.catalyst}` : "Updated watchlist entry");
            return {
              summary: `Updated $${ticker} on watchlist`,
              tickers: [{ ticker, tag: "Watch", summary: updateSummary }] as TickerFinding[],
              _sources: [] as ToolSource[],
              data: {
                success: true,
                action: "UPDATE" as const,
                ticker,
                changed: true,
                watchlist_item: {
                  ticker,
                  priority: updated.priority as "LOW" | "NORMAL" | "HIGH",
                  notes: updated.notes,
                  thesis_direction: updated.thesisDirection as "LONG" | "SHORT" | "PASS" | null,
                  target_price: updated.targetPrice,
                  stop_price: updated.stopPrice,
                  conviction: updated.conviction,
                  catalyst: updated.catalyst,
                  updated_at: updated.updatedAt.toISOString(),
                },
                message: `Updated $${ticker} watchlist entry.`,
              },
            };
          }

          return wlFail(`Unknown action: ${args.action}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Watchlist operation failed";
          console.error(`[tool] manage_watchlist FAILED: ${msg}`);
          logToolEnd("manage_watchlist", _t0, ctx.runId, `FAILED: ${msg}`, stats);
          return wlFail(msg);
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
          const types = filings.map((f) => f.type);
          return {
            summary: filings.length > 0
              ? `${args.symbol} — ${filings.length} SEC filing${filings.length !== 1 ? "s" : ""} (${[...new Set(types)].join(", ")}).`
              : `No recent SEC filings for ${args.symbol}.`,
            tickers: [{ ticker: args.symbol, tag: "Research", summary: filings.length > 0 ? `${filings.length} SEC filing${filings.length !== 1 ? "s" : ""}` : "No recent filings" }],
            _sources: [{ provider: "SEC EDGAR", title: `${args.symbol} EDGAR Filings`, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${args.symbol}&type=&dateb=&owner=include&count=40` }],
            data: { filings, count: filings.length },
          };
        } catch (err) {
          logToolEnd("get_sec_filings", _t0, ctx.runId, `symbol=${args.symbol} FAILED`, stats);
          return {
            summary: `SEC filings lookup failed for ${args.symbol}.`,
            tickers: [],
            _sources: [{ provider: "SEC EDGAR", title: `${args.symbol} EDGAR Filings` }],
            data: { filings: [], count: 0 },
          };
        }
      },
    }),

    // ── V3 Intelligence Layer Tools ───────────────────────────────────────

    read_morning_brief: tool({
      description:
        "Read today's pre-generated intelligence brief. Contains market context, portfolio alerts, watchlist updates, new opportunities, and risk flags — all gathered by background jobs before your session started. Call this in Phase 0 to understand what happened overnight.",
      inputSchema: emptyParams,
      execute: async () => {
        if (!ctx.analystId) return { summary: "No analyst context — cannot read brief.", _sources: [], data: { available: false } };
        logToolStart("read_morning_brief", ctx.runId, undefined, stats);

        // ET trading-day date — server-local midnight on Vercel is UTC,
        // which silently misses the brief on any run after 8 PM ET.
        const today = etTradingDayDate();

        const brief = await prisma.morningBrief.findUnique({
          where: {
            analystId_date: {
              analystId: ctx.analystId,
              date: today,
            },
          },
        });

        if (!brief) {
          return {
            summary: "No morning brief available for today. Intelligence jobs may not have run yet.",
            tickers: [],
            _sources: [],
            data: { available: false } as MorningBriefToolData,
          };
        }

        // ── Flatten the 3 DB arrays into unified tickers[] ────────────
        const alerts = Array.isArray(brief.portfolioAlerts) ? brief.portfolioAlerts as { ticker: string; alert: string; urgency: string; signalIds: string[] }[] : [];
        const watches = Array.isArray(brief.watchlistUpdates) ? brief.watchlistUpdates as { ticker: string; update: string; recommendation: string; signalIds: string[] }[] : [];
        const opps = Array.isArray(brief.newOpportunities) ? brief.newOpportunities as { headline: string; tickers: string[]; thesisSeed: string; signalIds: string[] }[] : [];

        const tickers: TickerFinding[] = [
          ...alerts.map((a) => ({ ticker: a.ticker, tag: "Holding", summary: a.alert })),
          ...watches.map((w) => ({ ticker: w.ticker, tag: "Watching", summary: w.update })),
          ...opps.map((o) => ({ ticker: o.tickers?.[0] ?? "?", tag: "Opportunity", summary: o.thesisSeed || o.headline })),
        ];

        // ── Resolve real signal sources from the underlying signal IDs ──
        // Avoid the previous fake "hindsightintelligence.com" placeholder.
        // If no signals can be resolved, return an empty source array so
        // the UI shows nothing rather than a fabricated chip.
        const allSignalIds = [
          ...alerts.flatMap((a) => a.signalIds ?? []),
          ...watches.flatMap((w) => w.signalIds ?? []),
          ...opps.flatMap((o) => o.signalIds ?? []),
        ];
        const briefSources: ToolSource[] = [];
        if (allSignalIds.length > 0) {
          const signals = await prisma.signal.findMany({
            where: { id: { in: allSignalIds } },
            select: { headline: true, sourceUrls: true, sourceNames: true },
          });
          const seen = new Set<string>();
          for (const s of signals) {
            for (let i = 0; i < s.sourceUrls.length; i++) {
              const url = s.sourceUrls[i];
              if (!url || seen.has(url)) continue;
              seen.add(url);
              briefSources.push({
                provider: s.sourceNames[i] ?? new URL(url).hostname,
                title: s.headline,
                url,
              });
              if (briefSources.length >= 12) break;
            }
            if (briefSources.length >= 12) break;
          }
        }

        return {
          summary: `Morning brief: ${alerts.length} portfolio alert${alerts.length !== 1 ? "s" : ""}, ${watches.length} watchlist update${watches.length !== 1 ? "s" : ""}, ${opps.length} opportunit${opps.length !== 1 ? "ies" : "y"}. ${brief.signalCount} signals.`,
          tickers,
          _sources: briefSources,
          data: {
            available: true,
            date: brief.date.toISOString().slice(0, 10),
            marketContext: brief.marketContext ?? undefined,
            attentionPriority: brief.attentionPriority,
            riskFlags: brief.riskFlags,
            signalCount: brief.signalCount,
            generatedAt: brief.generatedAt.toISOString(),
            portfolioAlerts: alerts,
            watchlistUpdates: watches,
            newOpportunities: opps,
          } satisfies MorningBriefToolData,
        };
      },
    }),

    read_signals: tool({
      description:
        "Read intelligence signals routed to you by background discovery jobs. Returns pre-gathered news, filings, earnings, social, and macro signals matched to your mandate. Filter by tickers, themes, or urgency. Signals are marked as READ after retrieval. Use this to understand what the intelligence pipeline found for you today.",
      inputSchema: z.object({
        tickers: z.array(z.string()).optional().describe("Filter to signals mentioning these tickers"),
        themes: z.array(z.string()).optional().describe("Filter to signals with these themes (e.g. AI_CAPEX, FED_RATE_CUT)"),
        type: z.enum(["NEWS", "EARNINGS", "FILING", "SOCIAL", "PRICE_ACTION", "ANALYST_NOTE", "OPTIONS", "MACRO", "SECTOR"]).optional().describe("Filter to a specific signal type (e.g. EARNINGS for earnings calendar, MACRO for market movers)"),
        urgency: z.enum(["LOW", "MEDIUM", "HIGH", "BREAKING"]).optional().describe("Minimum urgency level"),
        limit: z.number().optional().describe("Max signals to return (default 20, capped by intelligence policy)"),
      }),
      execute: async ({ tickers, themes, type, urgency, limit = 20 }) => {
        if (!ctx.analystId) return { summary: "No analyst context — cannot read signals.", tickers: [], _sources: [], data: { count: 0, signals: [] } };

        // ── Apply intelligence policy constraints ──────────────────────
        const policy = ctx.intelligencePolicy;
        const policyMaxSignals = policy?.maxSignalsPerRun ?? 30;
        const effectiveLimit = Math.min(limit, policyMaxSignals);

        // Policy-enforced urgency floor: use the higher of caller urgency or policy minimum
        const urgencyOrder = ["LOW", "MEDIUM", "HIGH", "BREAKING"];
        const callerMinIdx = urgency ? urgencyOrder.indexOf(urgency) : 0;
        const policyMinIdx = policy?.minUrgency ? urgencyOrder.indexOf(policy.minUrgency) : 0;
        const effectiveMinIdx = Math.max(callerMinIdx, policyMinIdx);
        const validUrgencies = urgencyOrder.slice(effectiveMinIdx);

        // Policy-enforced source quality floor
        const minSourceQuality = policy?.minSourceQuality ?? 2;

        // Policy-enforced excluded source categories
        const excludedCategories = policy?.excludedSourceCategories ?? [];

        logToolStart("read_signals", ctx.runId, `tickers=${tickers?.join(",") ?? "all"} limit=${effectiveLimit} minUrgency=${urgencyOrder[effectiveMinIdx]} minQuality=${minSourceQuality}`, stats);

        // NOTE: We intentionally do NOT filter by status: "PENDING" here.
        // The agent calls read_signals multiple times in a single run with
        // different filters; if we only returned PENDING, the second call
        // would see 0 because the first call already marked everything READ.
        // Cross-run dedup still works because each day's signal-router
        // creates new routes — and we only routedAt within the trading day.
        const routes = await prisma.analystSignalRoute.findMany({
          where: {
            analystId: ctx.analystId,
            status: { in: ["PENDING", "READ"] },
            signal: {
              ...(tickers && tickers.length > 0 ? { tickers: { hasSome: tickers } } : {}),
              ...(themes && themes.length > 0 ? { themes: { hasSome: themes } } : {}),
              ...(type ? { type } : {}),
              urgency: { in: validUrgencies },
              sourceQuality: { gte: minSourceQuality },
            },
          },
          include: {
            signal: {
              include: {
                artifact: true,
              },
            },
          },
          orderBy: { relevanceScore: "desc" },
          // Fetch extra to account for category filtering in JS
          take: effectiveLimit + excludedCategories.length * 5,
        });

        // Filter out excluded source categories in application code
        // Category filtering is now based on signal sectors since Source model was removed
        let filtered = routes;
        if (excludedCategories.length > 0) {
          filtered = routes.filter((r) => {
            // Filter by signal's sectors (source category no longer on Artifact)
            const signalSectors = r.signal.sectors ?? [];
            return !signalSectors.some((s: string) => (excludedCategories as string[]).includes(s));
          });
        }

        // Apply effective limit after category filtering
        const finalRoutes = filtered.slice(0, effectiveLimit);

        // Mark as READ
        if (finalRoutes.length > 0) {
          await prisma.analystSignalRoute.updateMany({
            where: { id: { in: finalRoutes.map((r) => r.id) } },
            data: { status: "READ" },
          });
        }

        // ── Fallback: if 0 routed signals, query by sectors/watchlist directly ──
        if (finalRoutes.length === 0) {
          const config = await prisma.agentConfig.findUnique({
            where: { id: ctx.analystId },
            select: { sectors: true, watchlist: true },
          });

          if (config && (config.sectors.length > 0 || config.watchlist.length > 0)) {
            const today = etTradingDayDate();

            const fallbackSignals = await prisma.signal.findMany({
              where: {
                createdAt: { gte: today },
                urgency: { in: validUrgencies },
                sourceQuality: { gte: minSourceQuality },
                OR: [
                  ...(config.watchlist.length > 0 ? [{ tickers: { hasSome: config.watchlist } }] : []),
                  ...(config.sectors.length > 0 ? [{ sectors: { hasSome: config.sectors } }] : []),
                ],
              },
              orderBy: { createdAt: "desc" },
              take: effectiveLimit,
            });

            if (fallbackSignals.length > 0) {
              const fbSignals: SignalItem[] = fallbackSignals.map((s) => ({
                signalId: s.id,
                type: s.type,
                headline: s.headline,
                summary: s.summary ?? "",
                tickers: s.tickers,
                themes: s.themes,
                sentiment: s.sentiment ?? "NEUTRAL",
                urgency: s.urgency ?? "MEDIUM",
                freshness: s.freshness ?? undefined,
                sources: toSourceRefs(s.sourceNames, s.sourceUrls),
                relevanceScore: 0,
                routeReason: "fallback_sector_watchlist_match",
                artifactId: s.artifactId,
              }));
              const urgent = fbSignals.filter((s) => s.urgency === "HIGH" || s.urgency === "BREAKING").length;
              const bullish = fbSignals.filter((s) => s.sentiment === "BULLISH").length;
              const bearish = fbSignals.filter((s) => s.sentiment === "BEARISH").length;
              return {
                summary: `${fbSignals.length} signal${fbSignals.length !== 1 ? "s" : ""} (${urgent} urgent, ${bullish} bullish, ${bearish} bearish). Fallback: sector/watchlist match.`,
                tickers: fbSignals.map((s) => ({ ticker: s.tickers[0] ?? "MACRO", tag: s.urgency, summary: s.headline })),
                _sources: sourceRefsToToolSources(fbSignals.flatMap((s) => s.sources)),
                data: {
                  count: fbSignals.length,
                  fallback: true,
                  fallbackReason: "No routed signals found — falling back to sector/watchlist match",
                  policyApplied: { maxSignals: policyMaxSignals, minUrgency: urgencyOrder[effectiveMinIdx], minSourceQuality, excludedCategories },
                  signals: fbSignals,
                } satisfies SignalsToolData,
              };
            }
          }
        }

        const mappedSignals: SignalItem[] = finalRoutes.map((r) => ({
          signalId: r.signal.id,
          type: r.signal.type,
          headline: r.signal.headline,
          summary: r.signal.summary ?? "",
          tickers: r.signal.tickers,
          themes: r.signal.themes,
          sentiment: r.signal.sentiment ?? "NEUTRAL",
          urgency: r.signal.urgency ?? "MEDIUM",
          freshness: r.signal.freshness ?? undefined,
          sources: toSourceRefs(r.signal.sourceNames, r.signal.sourceUrls),
          relevanceScore: r.relevanceScore,
          routeReason: r.routeReason ?? undefined,
          artifactId: r.signal.artifactId,
        }));
        const urgent = mappedSignals.filter((s) => s.urgency === "HIGH" || s.urgency === "BREAKING").length;
        const bullish = mappedSignals.filter((s) => s.sentiment === "BULLISH").length;
        const bearish = mappedSignals.filter((s) => s.sentiment === "BEARISH").length;

        return {
          summary: `${mappedSignals.length} signal${mappedSignals.length !== 1 ? "s" : ""} (${urgent} urgent, ${bullish} bullish, ${bearish} bearish).`,
          tickers: mappedSignals.map((s) => ({ ticker: s.tickers[0] ?? "MACRO", tag: s.urgency, summary: s.headline })),
          _sources: sourceRefsToToolSources(mappedSignals.flatMap((s) => s.sources)),
          data: {
            count: mappedSignals.length,
            policyApplied: { maxSignals: policyMaxSignals, minUrgency: urgencyOrder[effectiveMinIdx], minSourceQuality, excludedCategories },
            signals: mappedSignals,
          } satisfies SignalsToolData,
        };
      },
    }),

    read_artifact: tool({
      description:
        "Read the full extracted content of an article or document behind a signal. Use when a signal's headline is interesting and you want the full text. Takes an artifactId from a signal's artifactId field.",
      inputSchema: z.object({
        artifactId: z.string().describe("The artifact ID from a signal"),
      }),
      execute: async ({ artifactId }) => {
        logToolStart("read_artifact", ctx.runId, `artifact=${artifactId}`, stats);

        const artifact = await prisma.artifact.findUnique({
          where: { id: artifactId },
        });

        if (!artifact) {
          return { summary: `Artifact ${artifactId} not found.`, _sources: [], data: { title: "", url: "", publishedAt: null, contentSummary: null, contentMarkdown: null } };
        }

        const title = artifact.title ?? "Untitled";
        const url = artifact.url ?? "";
        const content = artifact.contentMarkdown?.slice(0, 4000) ?? null;
        const wordCount = content ? content.split(/\s+/).length : 0;
        let domain = "";
        try { domain = url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { /* */ }

        return {
          summary: `${domain ? `${domain}: ` : ""}${title}${wordCount > 0 ? ` (${wordCount.toLocaleString()} words)` : ""}.`,
          _sources: url
            ? [{ title, url, provider: domain || "Firecrawl", excerpt: artifact.contentSummary ?? "" }]
            : [],
          data: {
            title,
            url,
            publishedAt: artifact.publishedAt?.toISOString() ?? null,
            contentSummary: artifact.contentSummary,
            contentMarkdown: content,
          } satisfies ArtifactToolData,
        };
      },
    }),

    web_search: tool({
      description:
        "Search the web for real-time information via Perplexity Sonar. Use when pre-gathered intelligence is insufficient and you need live data — breaking news, recent developments, or niche topics not covered by the signal pipeline. Respects your intelligence policy's allowLiveSearch and liveSearchBudget.",
      inputSchema: z.object({
        query: z.string().describe("Search query — be specific and financial-context-aware"),
        recency: z.enum(["hour", "day", "week", "month"]).optional().describe("How recent results should be (default: day)"),
      }),
      execute: async ({ query, recency = "day" }) => {
        const policy = ctx.intelligencePolicy;

        // Check policy: is live search allowed?
        if (policy && !policy.allowLiveSearch) {
          return {
            error: "Live search is disabled by your intelligence policy. Use pre-gathered signals instead.",
            allowed: false,
          };
        }

        // Check budget
        const budget = policy?.liveSearchBudget ?? 5;
        if (liveSearchCount >= budget) {
          return {
            error: `Live search budget exhausted (${budget}/${budget} used). Use pre-gathered intelligence for remaining research.`,
            allowed: false,
            budgetUsed: liveSearchCount,
            budgetMax: budget,
          };
        }

        liveSearchCount++;
        logToolStart("web_search", ctx.runId, `q="${query}" recency=${recency} budget=${liveSearchCount}/${budget}`, stats);

        try {
          stats.other++;
          const sonarResult = await searchSignals(query, { recency, model: "sonar" });

          const results: SignalItem[] = sonarResult.signals.map((s) => ({
            headline: s.headline,
            summary: s.summary,
            tickers: s.tickers,
            themes: s.themes,
            sentiment: s.sentiment,
            urgency: s.urgency,
            sources: toSourceRefs(s.sourceNames, s.sourceUrls),
          }));

          const allSourceRefs = results.flatMap((r) => r.sources);

          return {
            summary: `Found ${results.length} result${results.length !== 1 ? "s" : ""} for "${query.slice(0, 60)}". Budget: ${liveSearchCount}/${budget}.`,
            tickers: results
              .filter((r) => r.tickers.length > 0)
              .map((r) => ({ ticker: r.tickers[0], tag: r.sentiment, summary: r.headline })),
            _sources: sourceRefsToToolSources(allSourceRefs),
            data: {
              query,
              resultCount: results.length,
              budgetUsed: liveSearchCount,
              budgetMax: budget,
              results,
            } satisfies WebSearchToolData,
          };
        } catch (e) {
          stats.errors++;
          const msg = e instanceof Error ? e.message : String(e);
          return {
            summary: `Search failed: ${msg}`,
            tickers: [],
            _sources: [],
            data: { query, resultCount: 0, budgetUsed: liveSearchCount, budgetMax: budget, results: [] } satisfies WebSearchToolData,
          };
        }
      },
    }),

  };

  // Backward-compat aliases for old persisted RunMessages that reference old tool names
  const tools = toolsBase as Record<string, unknown>;
  tools.show_thesis = toolsBase.record_thesis;
  tools.summarize_run = toolsBase.complete_run;

  return toolsBase as typeof toolsBase & {
    show_thesis: typeof toolsBase.record_thesis;
    summarize_run: typeof toolsBase.complete_run;
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
