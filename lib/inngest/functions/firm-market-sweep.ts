// ── Firm Market Intelligence Sweep ──────────────────────────────────────────
// Runs daily at 6:30 AM ET before analyst runs.
// Loads enabled SEARCH monitors and executes them via Perplexity Sonar.
// Creates aggregate signals for FMP market movers and Finnhub earnings.
// Writes signals to the Signal table for downstream routing.

import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { searchSignals } from "@/lib/intelligence/sonar"
import { fetchMovers, type AlpacaMover } from "@/lib/intelligence/alpaca-movers"
import {
  createSignalBatch,
  createSignal,
  createSignalsFromSonar,
  completeSignalBatch,
  deduplicateSignals,
} from "@/lib/intelligence/signals"
import type { SignalType, SignalSentiment, SignalUrgency } from "@/lib/intelligence/types"

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!

// Map monitor categories to signal types
const CATEGORY_TO_SIGNAL_TYPE: Record<string, SignalType> = {
  MARKET: "MACRO",
  SECTOR: "SECTOR",
  TICKER: "NEWS",
  THEMATIC: "NEWS",
  EVENT: "EARNINGS",
}

// Aggregate buckets produced by the Alpaca screener. "Most actives" is
// intentionally dropped — Alpaca's /most-actives returns only volume +
// trade_count (no price/percent_change), which doesn't match the existing
// card renderer. Revisit if we want to fetch quotes separately.
const MOVER_BUCKETS: Array<{
  side: "gainers" | "losers"
  label: string
  sentiment: SignalSentiment
  aggregateType: string
  monitorId: string
}> = [
  { side: "gainers", label: "top gainers", sentiment: "BULLISH", aggregateType: "MARKET_MOVERS_GAINERS", monitorId: "monitor_alpaca_gainers" },
  { side: "losers",  label: "top losers",  sentiment: "BEARISH", aggregateType: "MARKET_MOVERS_LOSERS",  monitorId: "monitor_alpaca_losers"  },
]

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
    // ── Step 1: Load enabled SEARCH monitors ───────────────────────────────

    const monitors = await step.run("load-search-monitors", async () => {
      const now = new Date()
      return prisma.monitor.findMany({
        where: {
          type: "SEARCH",
          enabled: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: now } },
          ],
        },
        orderBy: { createdAt: "asc" },
      })
    })

    if (monitors.length === 0) {
      return { ran: 0, reason: "no-search-monitors" }
    }

    // ── Step 2: Create signal batch ────────────────────────────────────────

    const batchId = await step.run("create-batch", async () => {
      return createSignalBatch("MARKET_SWEEP")
    })

    // ── Step 3: Execute search monitors via Sonar (sequential to respect rate limits)

    let totalSignals = 0
    let monitorsRun = 0
    let monitorsFailed = 0

    for (const monitor of monitors) {
      const config = monitor.config as Record<string, unknown> | null
      const query = (config?.query as string) ?? ""
      if (!query) continue

      const result = await step.run(`search-${monitor.id}`, async () => {
        try {
          const sonarResponse = await searchSignals(query, {
            recency: "day",
            model: "sonar",
          })

          const signalType = CATEGORY_TO_SIGNAL_TYPE[monitor.category] ?? "NEWS"
          const signalIds = await createSignalsFromSonar(
            batchId,
            sonarResponse,
            signalType,
            3,
            {
              searchTool: "PERPLEXITY_SONAR",
              searchQuery: query,
              searchContext: `monitor:${monitor.category.toLowerCase()}:${monitor.id}`,
              monitorId: monitor.id,
            }
          )

          // Update lastRunAt on the monitor
          await prisma.monitor.update({
            where: { id: monitor.id },
            data: { lastRunAt: new Date() },
          })

          return { success: true, signalCount: signalIds.length }
        } catch (error) {
          console.error(
            `[firm-sweep] Monitor "${monitor.name}" (query: "${query}") failed:`,
            error instanceof Error ? error.message : error
          )
          return { success: false, signalCount: 0 }
        }
      })

      if (result.success) {
        totalSignals += result.signalCount
        monitorsRun++
      } else {
        monitorsFailed++
      }
    }

    // ── Step 4: Market movers via Alpaca screener — one fetch, two signals.
    // Replaces the old FMP /stock_market/{gainers,losers,actives} loop which
    // silently 0-called in production (FMP paywall or missing env key — same
    // outcome either way). Alpaca uses the same creds we already have for
    // paper trading, so no new env vars.

    const moversResult = await step.run("market-movers", async () => {
      let created = 0
      let failed = 0
      const errors: string[] = []

      let movers: Awaited<ReturnType<typeof fetchMovers>>
      try {
        movers = await fetchMovers(10)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(`[firm-sweep] Alpaca movers fetch failed: ${msg}`)
        return { created: 0, failed: MOVER_BUCKETS.length, errors: [msg] }
      }

      for (const { side, label, sentiment, aggregateType, monitorId } of MOVER_BUCKETS) {
        try {
          const items: AlpacaMover[] = movers[side] ?? []
          if (items.length === 0) continue

          const top10 = items.slice(0, 10)

          const dataPayload = top10.map((item) => ({
            ticker: item.symbol,
            change: item.percent_change ?? 0,
            price: item.price ?? 0,
          }))

          const top3Summary = top10
            .slice(0, 3)
            .map((item) => {
              const sign = (item.percent_change ?? 0) >= 0 ? "+" : ""
              return `${item.symbol} ${sign}${item.percent_change?.toFixed(1)}%`
            })
            .join(", ")

          const allTickers = top10.map((item) => item.symbol)
          const maxChangePct = Math.max(
            ...top10.map((item) => Math.abs(item.percent_change ?? 0)),
          )
          const urgency: SignalUrgency =
            maxChangePct > 5 ? "HIGH" : maxChangePct > 2 ? "MEDIUM" : "LOW"

          await createSignal({
            batchId,
            monitorId,
            type: "MACRO",
            headline: `Market ${label}: ${top3Summary} and ${Math.max(0, top10.length - 3)} more`,
            summary: `Today's ${label} include ${allTickers.join(", ")}. Largest move: ${maxChangePct.toFixed(1)}%.`,
            tickers: allTickers,
            themes: ["MARKET_MOVERS"],
            sectors: [],
            sentiment,
            urgency,
            sourceQuality: 3,
            freshness: "TODAY",
            sourceUrls: [],
            sourceNames: ["Alpaca"],
            searchTool: "ALPACA",
            searchQuery: `/v1beta1/screener/stocks/movers#${side}`,
            searchContext: `market_movers:${label}`,
            aggregateType,
            dataPayload,
            itemCount: top10.length,
          })
          created++

          await prisma.monitor.update({
            where: { id: monitorId },
            data: { lastRunAt: new Date() },
          }).catch(() => {
            console.warn(`[firm-sweep] Could not update lastRunAt for monitor ${monitorId}`)
          })
        } catch (error) {
          const msg = `Alpaca ${side} aggregate threw: ${error instanceof Error ? error.message : String(error)}`
          console.error(`[firm-sweep] ${msg}`)
          errors.push(msg)
          failed++
        }
      }

      return { created, failed, errors, lastUpdated: movers.last_updated }
    })

    totalSignals += moversResult.created

    // ── Step 5: Earnings calendar (Finnhub next 7 days) — 1 aggregate signal

    const earningsResult = await step.run("earnings-calendar", async () => {
      const monitorId = "monitor_finnhub_earnings"
      // Diagnostic: which stage failed last time? The catch below reports
      // `stage` so the Inngest dashboard shows exactly where we blew up
      // without us digging through Vercel logs again.
      let stage: string = "init"
      // Env-var presence check — empty key is the most common silent failure
      // mode. Never log the key itself.
      if (!FINNHUB_KEY) {
        return {
          created: 0,
          failed: 1,
          error: "FINNHUB_API_KEY missing in Vercel environment",
          stage: "env-check",
        }
      }

      try {
        stage = "build-url"
        const today = new Date()
        const weekOut = new Date(Date.now() + 7 * 86400_000)
        const from = today.toISOString().slice(0, 10)
        const to = weekOut.toISOString().slice(0, 10)

        stage = "fetch"
        const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FINNHUB_KEY}`
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) {
          const body = await res.text().catch(() => "")
          const msg = `Finnhub /calendar/earnings → HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`
          console.warn(`[firm-sweep] ${msg}`)
          return { created: 0, failed: 1, error: msg, stage }
        }

        stage = "parse-json"
        const data = (await res.json()) as {
          earningsCalendar?: Array<{
            symbol: string
            date: string
            epsEstimate: number | null
            revenueEstimate: number | null
          }>
        }

        stage = "filter-calendar"
        const calendar = (data.earningsCalendar ?? []).filter(
          (item) => item.symbol && item.date
        )

        if (calendar.length === 0) {
          return { created: 0, failed: 0, stage: "empty-calendar" }
        }

        stage = "build-payload"
        const dataPayload = calendar.map((item) => ({
          ticker: item.symbol,
          date: item.date,
          epsEstimate: item.epsEstimate,
          revenueEstimate: item.revenueEstimate,
        }))

        const allTickers = [...new Set(calendar.map((item) => item.symbol))]

        const nearestDaysOut = Math.min(
          ...calendar.map((item) => {
            const reportDate = new Date(item.date + "T00:00:00")
            return Math.ceil((reportDate.getTime() - today.getTime()) / 86400_000)
          })
        )
        const urgency: SignalUrgency =
          nearestDaysOut <= 2 ? "HIGH" : nearestDaysOut <= 5 ? "MEDIUM" : "LOW"

        const soonest = calendar
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 5)
          .map((item) => item.symbol)
        const headlineTickers = soonest.join(", ")
        const remaining = calendar.length - soonest.length

        stage = "create-signal"
        await createSignal({
          batchId,
          monitorId,
          type: "EARNINGS",
          headline: `Earnings calendar: ${headlineTickers}${remaining > 0 ? ` and ${remaining} more` : ""} reporting this week`,
          summary: `${calendar.length} companies reporting earnings ${from} to ${to}. Nearest reports in ${nearestDaysOut} day(s).`,
          tickers: allTickers,
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
          aggregateType: "EARNINGS_CALENDAR",
          dataPayload,
          itemCount: calendar.length,
        })

        stage = "update-monitor"
        await prisma.monitor.update({
          where: { id: monitorId },
          data: { lastRunAt: new Date() },
        }).catch(() => {
          console.warn(`[firm-sweep] Could not update lastRunAt for monitor ${monitorId}`)
        })

        return { created: 1, failed: 0, stage: "done", tickers: allTickers.length }
      } catch (error) {
        const msg = `Finnhub earnings threw at stage=${stage}: ${error instanceof Error ? error.message : String(error)}`
        console.error(`[firm-sweep] ${msg}`)
        return { created: 0, failed: 1, error: msg, stage }
      }
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

    // ── Step 8: Expire old temporary monitors ─────────────────────────────

    await step.run("expire-temp-monitors", async () => {
      const now = new Date()
      const expired = await prisma.monitor.updateMany({
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
      monitorsTotal: monitors.length,
      monitorsRun,
      monitorsFailed,
      signalsCreated: totalSignals,
      moversCreated: moversResult.created,
      earningsCreated: earningsResult.created,
      duplicatesRemoved: dupsRemoved,
    }
  }
)
