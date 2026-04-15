// ── Signal Router ────────────────────────────────────────────────────────────
// Runs at 7:30 AM ET after all intelligence jobs, or triggered after any batch.
// Takes unrouted signals and matches them to analysts based on:
//   1. Ticker match (position, watchlist, universe)
//   2. Sector match
//   3. Theme match (from analyst strategy keywords)
//
// Session 2 update — novelty is computed PER (analyst, signal) at routing time
// against the analyst's last-7-days route history, then applied as a MULTIPLIER
// on the raw relevance score. Stale signals drop below threshold instead of
// crowding the brief at the same score as fresh ones.
//
// Creates AnalystSignalRoute rows with relevance scores (final novelty-adjusted
// score, plus rawRelevanceScore + noveltyScore for debugging).
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
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Ticker match (highest signal)
  for (const ticker of signal.tickers) {
    if (profile.tickers.includes(ticker.toUpperCase())) {
      score += 40
      reasons.push(`ticker_match:${ticker}`)
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

  return { score: Math.min(100, score), reasons }
}

// ── Novelty (computed per-(analyst, signal) at routing time) ────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Score how "fresh" a signal is FOR A GIVEN ANALYST, based on how often the
 * same tickers/themes have already shown up in this analyst's route history
 * over the last 7 days.
 *
 *   never seen → 80   (genuinely new for this analyst)
 *   1-2 hits   → 50   (some repetition, still worth surfacing)
 *   3-5 hits   → 20   (getting stale)
 *   6+ hits    →  5   (this analyst has seen this story all week — drop it)
 *
 * Applied as a MULTIPLIER on raw relevance — see route-signals step.
 */
function computeNoveltyScore(args: {
  signalTickers: string[]
  signalThemes: string[]
  recentRoutes: { tickers: string[]; themes: string[] }[]
}): number {
  const tickers = new Set(args.signalTickers.map((t) => t.toUpperCase()))
  const themes = new Set(args.signalThemes.map((t) => t.toUpperCase()))

  if (tickers.size === 0 && themes.size === 0) {
    // No identifying tags — treat as moderately novel (no history to compare).
    return 50
  }

  let hits = 0
  for (const r of args.recentRoutes) {
    const tickerOverlap = r.tickers.some((t) => tickers.has(t.toUpperCase()))
    if (tickerOverlap) {
      hits++
      continue
    }
    const themeOverlap = r.themes.some((t) => themes.has(t.toUpperCase()))
    if (themeOverlap) hits++
  }

  if (hits === 0) return 80
  if (hits <= 2) return 50
  if (hits <= 5) return 20
  return 5
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
        },
        select: {
          id: true,
          tickers: true,
          sectors: true,
          themes: true,
          urgency: true,
        },
      })
    })

    if (signals.length === 0) {
      return { routed: 0, reason: "no-unrouted-signals" }
    }

    // ── Step 2.5: Load recent route history per analyst (7d) ────────────────
    //
    // Used by computeNoveltyScore to decide how often each analyst has already
    // seen tickers/themes in the past week. One round-trip per analyst keeps
    // this O(analysts) instead of O(analysts × signals).

    const recentRoutesByAnalyst = await step.run(
      "load-recent-routes",
      async () => {
        const since = new Date(Date.now() - SEVEN_DAYS_MS)
        const result: Record<string, { tickers: string[]; themes: string[] }[]> =
          {}
        for (const profile of profiles) {
          const rows = await prisma.analystSignalRoute.findMany({
            where: {
              analystId: profile.id,
              routedAt: { gte: since },
            },
            select: { signal: { select: { tickers: true, themes: true } } },
          })
          result[profile.id] = rows.map((r) => ({
            tickers: r.signal.tickers,
            themes: r.signal.themes,
          }))
        }
        return result
      }
    )

    // ── Step 3: Route signals to analysts (novelty-adjusted) ────────────────

    const routeResult = await step.run("route-signals", async () => {
      const routes: {
        analystId: string
        signalId: string
        relevanceScore: number
        rawRelevanceScore: number
        noveltyScore: number
        routeReason: string
      }[] = []

      let droppedByNovelty = 0
      let droppedByThreshold = 0

      for (const signal of signals) {
        for (const profile of profiles) {
          // Skip if any ticker is on exclusion list
          const excluded = signal.tickers.some((t) =>
            profile.exclusions.includes(t.toUpperCase())
          )
          if (excluded) continue

          const { score: rawScore, reasons } = computeRelevance(signal, profile)
          if (rawScore < 15) continue

          const novelty = computeNoveltyScore({
            signalTickers: signal.tickers,
            signalThemes: signal.themes,
            recentRoutes: recentRoutesByAnalyst[profile.id] ?? [],
          })

          // Stale signals (novelty < 20) drop entirely UNLESS the urgency is
          // BREAKING — breaking news always gets through even on a story the
          // analyst has been reading all week.
          if (novelty < 20 && signal.urgency !== "BREAKING") {
            droppedByNovelty++
            continue
          }

          // MULTIPLIER (not additive) — stale signals collapse to ~5% of raw,
          // fresh signals retain ~80% of raw.
          const adjusted = Math.max(0, Math.min(100, Math.round((rawScore * novelty) / 100)))

          if (adjusted < 15) {
            droppedByThreshold++
            continue
          }

          routes.push({
            analystId: profile.id,
            signalId: signal.id,
            relevanceScore: adjusted,
            rawRelevanceScore: rawScore,
            noveltyScore: novelty,
            routeReason: [
              ...reasons,
              `novelty:${novelty}`,
              `raw:${rawScore}`,
            ].join(", "),
          })
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
        droppedByNovelty,
        droppedByThreshold,
      }
    })

    return {
      signalsProcessed: signals.length,
      analystsActive: profiles.length,
      routesCreated: routeResult.routesCreated,
      droppedByNovelty: routeResult.droppedByNovelty,
      droppedByThreshold: routeResult.droppedByThreshold,
    }
  }
)
