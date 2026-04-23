// ── Portfolio & Watchlist Monitor ────────────────────────────────────────────
// Runs daily at 7:00 AM ET after the market sweep.
// Searches for news/developments on every open position and watchlist item
// across all analysts (deduplicated). Writes ticker-tagged signals.
//
// Uses TWO permanent built-in SEARCH monitors:
//   - "Portfolio Searches" (monitor_portfolio_searches) — reads open positions at runtime
//   - "Watchlist Searches" (monitor_watchlist_searches) — reads watchlist items at runtime
// The monitor rows are permanent; tickers are determined dynamically each run.

import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { searchTicker } from "@/lib/intelligence/sonar"
import {
  createSignalBatch,
  createSignalsFromSonar,
  completeSignalBatch,
  deduplicateSignals,
} from "@/lib/intelligence/signals"

const PORTFOLIO_MONITOR_ID = "monitor_portfolio_searches"
const WATCHLIST_MONITOR_ID = "monitor_watchlist_searches"

// ── Per-ticker analyst context ──────────────────────────────────────────────
//
// The old generic "${ticker} stock news developments catalysts today" query
// returned retail pap — earnings recaps + analyst target tweaks + stock
// splits. Same for every ticker, every analyst, every day. The signals
// produced for your NVDA were the same as what Perplexity would return for
// any random investor asking about NVDA.
//
// Per-ticker contextual query: for every (portfolio or watchlist) ticker, we
// look up ALL analysts who hold/watch it, merge their themes + salient prompt
// keywords, and inject those into the Sonar query. NVDA held by a
// "Tech Momentum Trader" (themes: AI_INFRASTRUCTURE) now gets a query like
// "NVDA stock AI infrastructure earnings acceleration today" instead of the
// generic firehose.

const STOPWORDS = new Set([
  "the", "and", "for", "that", "with", "this", "from", "are", "was", "will",
  "can", "has", "have", "been", "not", "but", "all", "any", "more", "when",
  "than", "its", "also", "into", "just", "should", "would", "could", "about",
  "each", "which", "their", "other", "stock", "stocks", "trade", "trades",
  "trading", "market", "markets", "position", "positions", "analyst",
  "research", "look", "find", "your",
])

function extractTopKeywords(text: string | null | undefined, n: number): string[] {
  if (!text) return []
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  const counts = new Map<string, number>()
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w)
}

/** Convert canonical theme tokens ("AI_INFRASTRUCTURE") to Sonar-friendly
 *  lowercase phrases ("AI infrastructure"). */
function humanizeTheme(theme: string): string {
  return theme.replace(/_/g, " ").toLowerCase()
}

function buildTickerQuery(ticker: string, context: string | undefined): string {
  return context
    ? `${ticker} stock ${context} today`
    : `${ticker} stock news developments catalysts today`
}

/** Ensure the two permanent monitor rows exist (idempotent).
 *  Also cleans up old per-ticker monitor rows from the previous architecture. */
async function ensurePermanentMonitors() {
  // Clean up old per-ticker rows (ticker-search-aapl, etc.)
  await prisma.monitor.deleteMany({
    where: {
      id: { startsWith: "ticker-search-" },
      builtIn: true,
      category: "TICKER",
    },
  })

  await Promise.all([
    prisma.monitor.upsert({
      where: { id: PORTFOLIO_MONITOR_ID },
      create: {
        id: PORTFOLIO_MONITOR_ID,
        name: "Portfolio Searches",
        type: "SEARCH",
        method: "perplexity_sonar",
        config: { track: "positions" },
        scope: "FIRM",
        enabled: true,
        builtIn: true,
        origin: "SYSTEM",
        category: "TICKER",
      },
      update: {
        name: "Portfolio Searches",
        type: "SEARCH",
        enabled: true,
      },
    }),
    prisma.monitor.upsert({
      where: { id: WATCHLIST_MONITOR_ID },
      create: {
        id: WATCHLIST_MONITOR_ID,
        name: "Watchlist Searches",
        type: "SEARCH",
        method: "perplexity_sonar",
        config: { track: "watchlist" },
        scope: "FIRM",
        enabled: true,
        builtIn: true,
        origin: "SYSTEM",
        category: "TICKER",
      },
      update: {
        name: "Watchlist Searches",
        type: "SEARCH",
        enabled: true,
      },
    }),
  ])
}

export const portfolioWatchlistMonitor = inngest.createFunction(
  {
    id: "portfolio-watchlist-monitor",
    name: "Portfolio & Watchlist Monitor",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "TZ=America/New_York 0 7 * * 1-5" },
    { event: "intelligence/portfolio-monitor" },
  ],
  async ({ step }) => {
    // ── Step 1: Ensure permanent monitors + collect tickers ────────────

    const { portfolioTickers, watchlistTickers, perTickerContext } = await step.run(
      "collect-tickers",
      async () => {
        await ensurePermanentMonitors()

        const [positions, watchlistItems, analysts] = await Promise.all([
          prisma.position.findMany({
            where: { status: "OPEN" },
            select: { symbol: true, analystId: true },
          }),
          prisma.analystWatchlistItem.findMany({
            where: { status: "ACTIVE" },
            select: { symbol: true, analystId: true },
          }),
          prisma.agentConfig.findMany({
            where: { enabled: true },
            select: {
              id: true,
              themes: true,
              analystPrompt: true,
              strategyInstructions: true,
            },
          }),
        ])

        type AnalystContext = {
          id: string
          themes: string[]
          analystPrompt: string | null
          strategyInstructions: string | null
        }
        const analystMap = new Map<string, AnalystContext>(
          analysts.map((a: AnalystContext) => [a.id, a] as const)
        )

        // ticker → analystIds that hold/watch it
        const tickerToAnalysts = new Map<string, Set<string>>()
        for (const p of positions) {
          if (!p.analystId) continue
          if (!tickerToAnalysts.has(p.symbol)) tickerToAnalysts.set(p.symbol, new Set())
          tickerToAnalysts.get(p.symbol)!.add(p.analystId)
        }
        for (const w of watchlistItems) {
          if (!w.analystId) continue
          if (!tickerToAnalysts.has(w.symbol)) tickerToAnalysts.set(w.symbol, new Set())
          tickerToAnalysts.get(w.symbol)!.add(w.analystId)
        }

        // Build per-ticker context: merge themes + top prompt keywords from
        // every analyst that holds/watches this ticker. Cap length so Sonar
        // queries stay focused.
        const perTickerContext: Record<string, string> = {}
        for (const [ticker, analystIds] of tickerToAnalysts.entries()) {
          const themeSet = new Set<string>()
          const keywordSet = new Set<string>()
          for (const aId of analystIds) {
            const a = analystMap.get(aId)
            if (!a) continue
            for (const t of a.themes) themeSet.add(humanizeTheme(t))
            for (const k of extractTopKeywords(a.analystPrompt, 2)) keywordSet.add(k)
            for (const k of extractTopKeywords(a.strategyInstructions, 2)) keywordSet.add(k)
          }
          const themes = [...themeSet].slice(0, 3)
          const keywords = [...keywordSet].slice(0, 3)
          const parts = [...themes, ...keywords].filter(Boolean)
          if (parts.length > 0) {
            perTickerContext[ticker] = parts.join(" ")
          }
        }

        return {
          portfolioTickers: [...new Set(positions.map((p) => p.symbol))].sort(),
          watchlistTickers: [...new Set(watchlistItems.map((w) => w.symbol))].sort(),
          perTickerContext,
        }
      }
    )

    const allTickers = [...new Set([...portfolioTickers, ...watchlistTickers])].sort()

    if (allTickers.length === 0) {
      return { ran: 0, reason: "no-tickers-to-monitor" }
    }

    // ── Step 2: Create signal batch ────────────────────────────────────────

    const batchId = await step.run("create-batch", async () => {
      return createSignalBatch("PORTFOLIO_MONITOR")
    })

    // ── Step 3: Search each ticker (sequential to respect rate limits) ────

    let totalSignals = 0
    let tickersSearched = 0
    let tickersFailed = 0

    for (const ticker of allTickers) {
      const isPortfolio = portfolioTickers.includes(ticker)
      const monitorId = isPortfolio ? PORTFOLIO_MONITOR_ID : WATCHLIST_MONITOR_ID

      const result = await step.run(`search-${ticker}`, async () => {
        try {
          // Contextual Sonar query: themes/keywords merged from every analyst
          // who holds/watches this ticker. Generic fallback ("NVDA stock news
          // developments catalysts today") only fires when no analyst claims
          // the ticker — shouldn't happen in practice since tickers come from
          // analyst-owned positions/watchlists.
          const context = perTickerContext[ticker]
          const sonarResponse = await searchTicker(ticker, context)
          const query = buildTickerQuery(ticker, context)

          const signalIds = await createSignalsFromSonar(
            batchId,
            sonarResponse,
            "NEWS",
            3,
            {
              searchTool: "PERPLEXITY_SONAR",
              searchQuery: query,
              searchContext: `ticker:${ticker}${context ? `:contextual` : `:generic_fallback`}`,
              monitorId,
              forceTicker: ticker,
            }
          )

          return { success: true, signalCount: signalIds.length }
        } catch (error) {
          console.error(
            `[portfolio-monitor] Ticker "${ticker}" search failed:`,
            error instanceof Error ? error.message : error
          )
          return { success: false, signalCount: 0 }
        }
      })

      if (result.success) {
        totalSignals += result.signalCount
        tickersSearched++
      } else {
        tickersFailed++
      }
    }

    // ── Step 4: Update lastRunAt on both monitors ──────────────────────────

    await step.run("update-monitors", async () => {
      const now = new Date()
      await Promise.all([
        portfolioTickers.length > 0
          ? prisma.monitor.update({
              where: { id: PORTFOLIO_MONITOR_ID },
              data: { lastRunAt: now },
            })
          : Promise.resolve(),
        watchlistTickers.length > 0
          ? prisma.monitor.update({
              where: { id: WATCHLIST_MONITOR_ID },
              data: { lastRunAt: now },
            })
          : Promise.resolve(),
      ])
    })

    // ── Step 5: Deduplicate ────────────────────────────────────────────────

    const dupsRemoved = await step.run("deduplicate", async () => {
      return deduplicateSignals(batchId)
    })

    // ── Step 6: Complete batch ─────────────────────────────────────────────

    await step.run("complete-batch", async () => {
      await completeSignalBatch(batchId)
    })

    return {
      batchId,
      portfolioTickers: portfolioTickers.length,
      watchlistTickers: watchlistTickers.length,
      tickersTotal: allTickers.length,
      tickersSearched,
      tickersFailed,
      signalsCreated: totalSignals,
      duplicatesRemoved: dupsRemoved,
    }
  }
)
