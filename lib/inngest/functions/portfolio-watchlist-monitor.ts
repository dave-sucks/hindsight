// ── Portfolio & Watchlist Monitor ────────────────────────────────────────────
// Runs daily at 7:00 AM ET after the market sweep.
// Searches for news/developments on every open position and watchlist item
// across all analysts (deduplicated). Writes ticker-tagged signals.

import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { searchTicker } from "@/lib/intelligence/sonar"
import {
  createSignalBatch,
  createSignalsFromSonar,
  completeSignalBatch,
  deduplicateSignals,
} from "@/lib/intelligence/signals"

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
    // ── Step 1: Collect all unique tickers from positions + watchlist ──────

    const tickers = await step.run("collect-tickers", async () => {
      const [positions, watchlistItems] = await Promise.all([
        prisma.position.findMany({
          where: { status: "OPEN" },
          select: { symbol: true },
        }),
        prisma.analystWatchlistItem.findMany({
          where: { status: "ACTIVE" },
          select: { symbol: true },
        }),
      ])

      // Deduplicate across all analysts
      const tickerSet = new Set<string>()
      for (const p of positions) tickerSet.add(p.symbol)
      for (const w of watchlistItems) tickerSet.add(w.symbol)

      return Array.from(tickerSet).sort()
    })

    if (tickers.length === 0) {
      return { ran: 0, reason: "no-tickers-to-monitor" }
    }

    // ── Step 2: Create signal batch ────────────────────────────────────────

    const batchId = await step.run("create-batch", async () => {
      return createSignalBatch("PORTFOLIO_MONITOR")
    })

    // ── Step 3: Search for each ticker (sequential to respect rate limits) ─

    let totalSignals = 0
    let tickersSearched = 0
    let tickersFailed = 0

    for (const ticker of tickers) {
      const result = await step.run(`search-${ticker}`, async () => {
        try {
          const sonarResponse = await searchTicker(ticker)

          const signalIds = await createSignalsFromSonar(
            batchId,
            sonarResponse,
            "NEWS",
            3,
            {
              searchTool: "PERPLEXITY_SONAR",
              searchQuery: `${ticker} stock news developments catalysts today`,
              searchContext: `ticker:${ticker}`,
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

    // ── Step 4: Deduplicate ────────────────────────────────────────────────

    const dupsRemoved = await step.run("deduplicate", async () => {
      return deduplicateSignals(batchId)
    })

    // ── Step 5: Complete batch ─────────────────────────────────────────────

    await step.run("complete-batch", async () => {
      await completeSignalBatch(batchId)
    })

    return {
      batchId,
      tickersTotal: tickers.length,
      tickersSearched,
      tickersFailed,
      signalsCreated: totalSignals,
      duplicatesRemoved: dupsRemoved,
    }
  }
)
