// ── Firm Market Intelligence Sweep ──────────────────────────────────────────
// Runs daily at 6:30 AM ET before analyst runs.
// Executes all firm-level IntelligenceQuery rows via Perplexity Sonar.
// Writes signals to the Signal table for downstream routing.

import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { searchSignals } from "@/lib/intelligence/sonar"
import {
  createSignalBatch,
  createSignal,
  createSignalsFromSonar,
  completeSignalBatch,
  deduplicateSignals,
} from "@/lib/intelligence/signals"
import type { SignalType, SignalSentiment, SignalUrgency } from "@/lib/intelligence/types"

const FMP_KEY = process.env.FMP_API_KEY!
const FINNHUB_KEY = process.env.FINNHUB_API_KEY!

// Map query categories to signal types
const CATEGORY_TO_SIGNAL_TYPE: Record<string, SignalType> = {
  MARKET: "MACRO",
  SECTOR: "SECTOR",
  TICKER: "NEWS",
  THEMATIC: "NEWS",
  EVENT: "EARNINGS",
}

export const firmMarketSweep = inngest.createFunction(
  {
    id: "firm-market-sweep",
    name: "Firm Market Intelligence Sweep",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "TZ=America/New_York 30 6 * * 1-5" },
    { event: "intelligence/market-sweep" },
  ],
  async ({ step }) => {
    // ── Step 1: Load enabled firm-level queries ────────────────────────────

    const queries = await step.run("load-firm-queries", async () => {
      const now = new Date()
      return prisma.intelligenceQuery.findMany({
        where: {
          scope: "FIRM",
          enabled: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        orderBy: { createdAt: "asc" },
      })
    })

    if (queries.length === 0) {
      return { ran: 0, reason: "no-firm-queries" }
    }

    // ── Step 2: Create signal batch ────────────────────────────────────────

    const batchId = await step.run("create-batch", async () => {
      return createSignalBatch("MARKET_SWEEP")
    })

    // ── Step 3: Execute queries via Sonar (sequential to respect rate limits)

    let totalSignals = 0
    let queriesRun = 0
    let queriesFailed = 0

    for (const query of queries) {
      const result = await step.run(`search-${query.id}`, async () => {
        try {
          const sonarResponse = await searchSignals(query.query, {
            recency: "day",
            model: "sonar",
          })

          const signalType = CATEGORY_TO_SIGNAL_TYPE[query.category] ?? "NEWS"
          const signalIds = await createSignalsFromSonar(
            batchId,
            sonarResponse,
            signalType,
            3,
            {
              searchTool: "PERPLEXITY_SONAR",
              searchQuery: query.query,
              searchContext: `query:${query.category.toLowerCase()}:${query.id}`,
            }
          )

          return { success: true, signalCount: signalIds.length }
        } catch (error) {
          console.error(
            `[firm-sweep] Query "${query.query}" failed:`,
            error instanceof Error ? error.message : error
          )
          return { success: false, signalCount: 0 }
        }
      })

      if (result.success) {
        totalSignals += result.signalCount
        queriesRun++
      } else {
        queriesFailed++
      }
    }

    // ── Step 4: Market movers (FMP gainers/losers/actives) ─────────────────

    const moversResult = await step.run("market-movers", async () => {
      let created = 0
      let failed = 0

      const endpoints: Array<{
        path: string
        label: string
        sentiment: SignalSentiment
      }> = [
        { path: "/stock_market/gainers", label: "top gainer", sentiment: "BULLISH" },
        { path: "/stock_market/losers", label: "top loser", sentiment: "BEARISH" },
        { path: "/stock_market/actives", label: "most active", sentiment: "NEUTRAL" },
      ]

      for (const { path, label, sentiment } of endpoints) {
        try {
          const url = `https://financialmodelingprep.com/api/v3${path}?apikey=${FMP_KEY}`
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
          if (!res.ok) {
            console.warn(`[firm-sweep] FMP ${path} returned ${res.status}`)
            failed++
            continue
          }

          const data = (await res.json()) as Array<{
            symbol: string
            name: string
            change: number
            changesPercentage: number
          }>

          if (!Array.isArray(data)) continue

          const top10 = data.slice(0, 10)
          for (const item of top10) {
            const changePct = Math.abs(item.changesPercentage ?? 0)
            const sign = (item.changesPercentage ?? 0) >= 0 ? "+" : ""
            const urgency: SignalUrgency =
              changePct > 5 ? "HIGH" : changePct > 2 ? "MEDIUM" : "LOW"

            await createSignal({
              batchId,
              type: "MACRO",
              headline: `${item.symbol} ${sign}${item.changesPercentage?.toFixed(1)}% — ${label} today`,
              summary: item.name
                ? `${item.name} moved ${sign}${item.changesPercentage?.toFixed(1)}% ($${Math.abs(item.change ?? 0).toFixed(2)}).`
                : `${item.symbol} is a ${label} today with ${sign}${item.changesPercentage?.toFixed(1)}% change.`,
              tickers: [item.symbol],
              themes: ["MARKET_MOVERS"],
              sectors: [],
              sentiment,
              urgency,
              sourceQuality: 3,
              freshness: "TODAY",
              sourceUrls: [],
              sourceNames: ["FMP"],
              searchTool: "FMP",
              searchQuery: path,
              searchContext: `market_movers:${label}`,
            })
            created++
          }
        } catch (error) {
          console.error(`[firm-sweep] Market movers ${path} failed:`, error instanceof Error ? error.message : error)
          failed++
        }
      }

      return { created, failed }
    })

    totalSignals += moversResult.created

    // ── Step 5: Earnings calendar (Finnhub next 7 days) ──────────────────

    const earningsResult = await step.run("earnings-calendar", async () => {
      let created = 0
      try {
        const today = new Date()
        const weekOut = new Date(Date.now() + 7 * 86400_000)
        const from = today.toISOString().slice(0, 10)
        const to = weekOut.toISOString().slice(0, 10)

        const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FINNHUB_KEY}`
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) {
          console.warn(`[firm-sweep] Finnhub earnings calendar returned ${res.status}`)
          return { created: 0, failed: 1 }
        }

        const data = (await res.json()) as {
          earningsCalendar?: Array<{
            symbol: string
            date: string
            epsEstimate: number | null
            revenueEstimate: number | null
          }>
        }

        const calendar = data.earningsCalendar ?? []
        for (const item of calendar) {
          if (!item.symbol || !item.date) continue

          const reportDate = new Date(item.date + "T00:00:00")
          const daysUntil = Math.ceil((reportDate.getTime() - today.getTime()) / 86400_000)
          const urgency: SignalUrgency =
            daysUntil <= 2 ? "HIGH" : daysUntil <= 5 ? "MEDIUM" : "LOW"

          const dateFmt = reportDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })

          const summaryParts: string[] = []
          if (item.epsEstimate != null) summaryParts.push(`Expected EPS: $${item.epsEstimate.toFixed(2)}`)
          if (item.revenueEstimate != null) {
            const revB = item.revenueEstimate / 1e9
            summaryParts.push(revB >= 1
              ? `Expected Revenue: $${revB.toFixed(1)}B`
              : `Expected Revenue: $${(item.revenueEstimate / 1e6).toFixed(0)}M`)
          }

          await createSignal({
            batchId,
            type: "EARNINGS",
            headline: `${item.symbol} reports earnings ${dateFmt}`,
            summary: summaryParts.length > 0
              ? summaryParts.join(" | ")
              : `${item.symbol} is scheduled to report earnings on ${dateFmt}.`,
            tickers: [item.symbol],
            themes: ["EARNINGS_CALENDAR"],
            sectors: [],
            sentiment: "NEUTRAL",
            urgency,
            sourceQuality: 4,
            freshness: "TODAY",
            sourceUrls: [],
            sourceNames: ["Finnhub"],
            searchTool: "FINNHUB",
            searchQuery: `/calendar/earnings?from=${from}&to=${to}`,
            searchContext: "earnings_calendar",
          })
          created++
        }
      } catch (error) {
        console.error(`[firm-sweep] Earnings calendar failed:`, error instanceof Error ? error.message : error)
        return { created: 0, failed: 1 }
      }

      return { created, failed: 0 }
    })

    totalSignals += earningsResult.created

    // ── Step 6: Deduplicate signals ────────────────────────────────────────

    const dupsRemoved = await step.run("deduplicate", async () => {
      return deduplicateSignals(batchId)
    })

    // ── Step 7: Complete batch ─────────────────────────────────────────────

    await step.run("complete-batch", async () => {
      await completeSignalBatch(batchId)
    })

    // ── Step 8: Expire old temporary queries ──────────────────────────────

    await step.run("expire-temp-queries", async () => {
      const now = new Date()
      const expired = await prisma.intelligenceQuery.updateMany({
        where: {
          expiresAt: { lte: now },
          enabled: true,
        },
        data: { enabled: false },
      })
      return expired.count
    })

    return {
      batchId,
      queriesTotal: queries.length,
      queriesRun,
      queriesFailed,
      signalsCreated: totalSignals,
      moversCreated: moversResult.created,
      earningsCreated: earningsResult.created,
      duplicatesRemoved: dupsRemoved,
    }
  }
)
