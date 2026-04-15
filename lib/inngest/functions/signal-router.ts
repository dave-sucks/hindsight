// ── Signal Router ────────────────────────────────────────────────────────────
// Runs at 7:30 AM ET after all intelligence jobs, or triggered after any batch.
// Takes unrouted signals and matches them to analysts based on:
//   1. Ticker match (position, watchlist, universe)
//   2. Sector match
//   3. Theme match (from analyst strategy keywords)
// Creates AnalystSignalRoute rows with relevance scores.
//
// NOTE: Inngest step.run() serializes return values to JSON, so we use plain
// arrays instead of Sets. The profiles get JSON-roundtripped between steps.

import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { etTradingDayDate } from "@/lib/market-hours"

// ── Routing helpers ─────────────────────────────────────────────────────────

interface AnalystProfile {
  id: string
  tickers: string[]    // watchlist + open positions + tickerUniverse (uppercased)
  sectors: string[]    // uppercased
  keywords: string[]   // extracted from analystPrompt / strategyInstructions
  exclusions: string[] // uppercased
}

function extractKeywords(text: string | null): string[] {
  if (!text) return []
  const stopWords = new Set([
    "the", "and", "for", "that", "with", "this", "from", "are", "was",
    "will", "can", "has", "have", "been", "not", "but", "all", "any",
    "more", "when", "than", "its", "also", "into", "just", "should",
    "would", "could", "about", "each", "which", "their", "other",
    "stock", "stocks", "trade", "trades", "trading", "market", "markets",
    "position", "positions", "analyst", "research", "look", "find",
  ])

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))
}

function computeRelevance(
  signal: { tickers: string[]; sectors: string[]; themes: string[]; urgency: string },
  profile: AnalystProfile
): { score: number; reasons: string[]; isDiscovery: boolean } {
  let score = 0
  const reasons: string[] = []
  let hasTickerMatch = false

  // Ticker match (highest signal)
  for (const ticker of signal.tickers) {
    if (profile.tickers.includes(ticker.toUpperCase())) {
      score += 40
      reasons.push(`ticker_match:${ticker}`)
      hasTickerMatch = true
    }
  }

  // Sector match
  for (const sector of signal.sectors) {
    if (profile.sectors.includes(sector.toUpperCase())) {
      score += 20
      reasons.push(`sector_match:${sector}`)
    }
  }

  // Theme/keyword match
  const signalText = [...signal.themes, ...signal.tickers].join(" ").toLowerCase()
  for (const kw of profile.keywords) {
    if (signalText.includes(kw)) {
      score += 15
      reasons.push(`theme_match:${kw}`)
    }
  }

  // Urgency bonus
  if (signal.urgency === "BREAKING") score += 15
  else if (signal.urgency === "HIGH") score += 10

  // A signal is a "discovery" candidate when it passed relevance purely via
  // sector/theme — no ticker overlap with the analyst's known universe.
  const isDiscovery = !hasTickerMatch && score >= 15

  return { score: Math.min(100, score), reasons, isDiscovery }
}

// ── Inngest function ────────────────────────────────────────────────────────

export const signalRouter = inngest.createFunction(
  {
    id: "signal-router",
    name: "Signal Router",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "TZ=America/New_York 30 7 * * 1-5" },
    { event: "intelligence/route-signals" },
  ],
  async ({ step }) => {
    // ── Step 1: Build analyst profiles ──────────────────────────────────────

    const profiles = await step.run("build-analyst-profiles", async () => {
      const analysts = await prisma.agentConfig.findMany({
        where: { enabled: true },
        include: {
          positions: {
            where: { status: "OPEN" },
            select: { symbol: true },
          },
          watchlistItems: {
            where: { status: "ACTIVE" },
            select: { symbol: true },
          },
        },
      })

      return analysts.map((a): AnalystProfile => {
        const tickerSet = new Set<string>([
          ...a.watchlist.map((t) => t.toUpperCase()),
          ...a.tickerUniverse.map((t) => t.toUpperCase()),
          ...a.positions.map((p) => p.symbol.toUpperCase()),
          ...a.watchlistItems.map((w) => w.symbol.toUpperCase()),
        ])

        const sectorSet = new Set(a.sectors.map((s) => s.toUpperCase()))

        const keywordSet = new Set([
          ...extractKeywords(a.analystPrompt),
          ...extractKeywords(a.strategyInstructions),
        ])

        return {
          id: a.id,
          tickers: [...tickerSet],
          sectors: [...sectorSet],
          keywords: [...keywordSet],
          exclusions: a.exclusionList.map((e) => e.toUpperCase()),
        }
      })
    })

    if (profiles.length === 0) {
      return { routed: 0, reason: "no-enabled-analysts" }
    }

    // ── Step 2: Get today's unrouted signals ────────────────────────────────

    const signals = await step.run("load-unrouted-signals", async () => {
      const todayStart = etTradingDayDate()

      return prisma.signal.findMany({
        where: {
          createdAt: { gte: todayStart },
          routes: { none: {} },
          // Skip signals older than a week or with OLDER freshness — stale stories
          // are noise and erode analyst trust in the signal feed.
          freshness: { not: "OLDER" },
          // Skip overplayed stories (noveltyScore < 25 = same story seen 30+ times
          // in the last 7 days). Default is 50 so this only fires on computed scores.
          noveltyScore: { gte: 25 },
        },
        select: {
          id: true,
          tickers: true,
          sectors: true,
          themes: true,
          urgency: true,
          noveltyScore: true,
          freshness: true,
        },
      })
    })

    if (signals.length === 0) {
      return { routed: 0, reason: "no-unrouted-signals" }
    }

    // ── Step 3: Route signals to analysts ───────────────────────────────────

    const routeResult = await step.run("route-signals", async () => {
      const routes: {
        analystId: string
        signalId: string
        relevanceScore: number
        routeReason: string
      }[] = []

      // Track per-analyst discovery route count to cap at 5.
      // Discovery signals are valuable but should not crowd out known-ticker intel.
      const discoveryCount = new Map<string, number>()

      for (const signal of signals) {
        for (const profile of profiles) {
          // Skip if any ticker is on exclusion list
          const excluded = signal.tickers.some((t) =>
            profile.exclusions.includes(t.toUpperCase())
          )
          if (excluded) continue

          const { score, reasons, isDiscovery } = computeRelevance(signal, profile)

          if (score >= 15) {
            // Cap discovery routes at 5 per analyst per run so the feed isn't
            // flooded with sector-match noise at the expense of known-ticker intel.
            if (isDiscovery) {
              const dc = discoveryCount.get(profile.id) ?? 0
              if (dc >= 5) continue
              discoveryCount.set(profile.id, dc + 1)
            }

            routes.push({
              analystId: profile.id,
              signalId: signal.id,
              relevanceScore: score,
              // Prefix discovery routes so read_signals can separate them from
              // known-ticker intel and surface them to the agent as new opportunities.
              routeReason: isDiscovery
                ? `discovery:${reasons.join(", ")}`
                : reasons.join(", "),
            })
          }
        }
      }

      if (routes.length > 0) {
        await prisma.analystSignalRoute.createMany({
          data: routes,
          skipDuplicates: true,
        })
      }

      return {
        routesCreated: routes.length,
        discoveryRoutes: [...discoveryCount.values()].reduce((a, b) => a + b, 0),
      }
    })

    return {
      signalsProcessed: signals.length,
      analystsActive: profiles.length,
      routesCreated: routeResult.routesCreated,
      discoveryRoutes: routeResult.discoveryRoutes,
    }
  }
)
