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
    // ── Step 1: Collect tickers and upsert Monitor rows ─────────────────

    const tickerMonitors = await step.run("collect-tickers-and-upsert-monitors", async () => {
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

      const portfolioTickers = new Set<string>()
      for (const p of positions) portfolioTickers.add(p.symbol)

      const watchlistTickers = new Set<string>()
      for (const w of watchlistItems) watchlistTickers.add(w.symbol)

      const allTickers = new Set([...portfolioTickers, ...watchlistTickers])
      const sorted = Array.from(allTickers).sort()

      // Upsert a Monitor row for each ticker
      const results: { symbol: string; monitorId: string }[] = []

      for (const symbol of sorted) {
        const deterministicId = `ticker-search-${symbol.toLowerCase()}`
        const query = `${symbol} stock news developments catalysts today`

        const monitor = await prisma.monitor.upsert({
          where: { id: deterministicId },
          create: {
            id: deterministicId,
            name: `${symbol} Ticker Search`,
            type: "SEARCH",
            method: "perplexity_sonar",
            config: { query },
            scope: "FIRM",
            enabled: true,
            builtIn: true,
            origin: "SYSTEM",
            category: "TICKER",
          },
          update: {
            name: `${symbol} Ticker Search`,
            config: { query },
            enabled: true,
          },
        })

        results.push({ symbol, monitorId: monitor.id })
      }

      return results
    })

    if (tickerMonitors.length === 0) {
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

    for (const { symbol: ticker, monitorId } of tickerMonitors) {
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
              monitorId,
            }
          )

          // Update lastRunAt on the monitor
          await prisma.monitor.update({
            where: { id: monitorId },
            data: { lastRunAt: new Date() },
          })

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
      tickersTotal: tickerMonitors.length,
      tickersSearched,
      tickersFailed,
      signalsCreated: totalSignals,
      duplicatesRemoved: dupsRemoved,
    }
  }
)
