// ── Signal Router ────────────────────────────────────────────────────────────
// Runs at 7:30 AM ET after all intelligence jobs, or triggered after any batch.
//
// Session 3 / Workstream B contract — see docs/UNIVERSE_HANDOFF.md on the B
// branch. The router now does three things the old one didn't:
//
//   1. Universe fence. Each AgentConfig has industries/themes/marketCapMin/Max
//      plus the existing sectors/exchanges/watchlist/exclusionList. A signal
//      is "in-universe" when every NON-EMPTY dimension is matched (AND across
//      dimensions, OR within a dimension). Empty array / null numeric = no
//      filter on that dimension. Watchlist + open positions bypass the fence.
//
//   2. Tier-aware routing. An analyst-scoped Monitor (T2/T3/T5) fast-paths to
//      its owning analyst and cross-posts to OTHER analysts whose
//      position/watchlist overlaps the ticker (as CROSS_ANALYST, with a
//      relevance penalty). Firm-scoped monitors (T1/T4) score against every
//      enabled analyst using the fence above.
//
//   3. Canonical routeReasonCode + matchedUniverse tagging on every route.
//      Enum (string, not Postgres enum — easier to evolve):
//        DISCOVERY | WATCHLIST | POSITION | DIRECT_TICKER |
//        SECTOR_MATCH | INDUSTRY_MATCH | THEME_MATCH | CROSS_ANALYST
//      Decision order: exclusion → POSITION → WATCHLIST → DIRECT_TICKER
//      (owned monitor explicitly named the ticker) → DISCOVERY (fence match) →
//      {SECTOR,INDUSTRY,THEME}_MATCH (only the named dimension matched) →
//      CROSS_ANALYST (cross-posted from another analyst's owned signal) →
//      drop.
//
// Novelty (Session 2) stays: per-(analyst,signal) novelty 80/50/20/5 applied
// as a multiplier on the raw relevance score. Stale non-BREAKING signals
// drop; owner routes are exempt.
//
// NOTE: Inngest step.run() serializes return values to JSON, so we use plain
// arrays instead of Sets. The profiles get JSON-roundtripped between steps.

import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { etTradingDayDate } from "@/lib/market-hours"

// ── Types ───────────────────────────────────────────────────────────────────

type RouteReasonCode =
  | "DISCOVERY"
  | "WATCHLIST"
  | "POSITION"
  | "DIRECT_TICKER"
  | "SECTOR_MATCH"
  | "INDUSTRY_MATCH"
  | "THEME_MATCH"
  | "CROSS_ANALYST"
  // Aggregate signal routes — aggregates have empty sectors/industries by
  // design, so they bypass the news-signal universe fence. They reach
  // analysts via two paths:
  //   • FIRM_AGGREGATE_FEED — analyst subscribed via AgentConfig.feeds
  //     (canonical values match Signal.aggregateType 1:1 — see
  //     lib/universe/feeds.ts). Full firehose.
  //   • AGGREGATE_TICKER_MATCH — no feed subscription, but at least one of
  //     the aggregate's tickers overlaps the analyst's watchlist + positions.
  //     Fenced "your N names in this aggregate" view.
  | "FIRM_AGGREGATE_FEED"
  | "AGGREGATE_TICKER_MATCH"

interface MatchedUniverse {
  sectors?: string[]
  industries?: string[]
  themes?: string[]
  inWatchlist?: boolean
  inPositions?: boolean
  fromAnalystId?: string
  marketCap?: string
  // Populated for aggregate routes — the canonical FEEDS value from
  // Signal.aggregateType. Drives the UI's ability to show "earnings
  // calendar" vs "movers gainers" in the matched-universe chip.
  feed?: string
}

export interface AnalystProfile {
  id: string
  positionTickers: string[]   // OPEN positions
  watchlistTickers: string[]  // watchlist + watchlistItems + tickerUniverse (directed)
  // Universe dimensions — canonical GICS Title Case sectors/industries and
  // uppercase snake_case themes. Session A normalizers enforce this at every
  // write path, so the router compares values directly without upper()-ing.
  sectors: string[]
  industries: string[]
  themes: string[]
  // Feeds — firm-aggregate subscription dimension. Canonical values mirror
  // Signal.aggregateType (see lib/universe/feeds.ts). Checked by exact string
  // equality; no normalization at read time.
  feeds: string[]
  exchanges: string[]
  exclusions: string[]
  // Keywords extracted from prompt/strategy — used for soft THEME_MATCH.
  keywords: string[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Per-dimension overlap. Both sides are canonical (Session A), so this is a
 * plain equality compare. Empty analyst dimension = "no filter" → return null
 * to signal the dimension is vacuously satisfied.
 */
function overlap(
  analystDim: string[],
  signalDim: string[]
): string[] | null {
  if (analystDim.length === 0) return null
  return analystDim.filter((a) => signalDim.includes(a))
}

/**
 * Is the signal in-universe for this analyst?
 * AND across dimensions, OR within a dimension. Empty dims are satisfied.
 * Returns null if the signal is NOT in-universe, otherwise the matched
 * dimensions payload (for tagging).
 *
 * Exported so integration tests can exercise the fence contract directly.
 */
export function matchUniverse(
  signal: { sectors: string[]; industries: string[]; themes: string[] },
  profile: AnalystProfile
): MatchedUniverse | null {
  const matched: MatchedUniverse = {}
  const sectorHit = overlap(profile.sectors, signal.sectors)
  const industryHit = overlap(profile.industries, signal.industries)
  const themeHit = overlap(profile.themes, signal.themes)

  // If ANY configured dimension has NO overlap, the signal is not in-universe.
  // `null` from overlap() means "dimension empty / no filter" — that's a pass.
  if (sectorHit !== null) {
    if (sectorHit.length === 0) return null
    matched.sectors = sectorHit
  }
  if (industryHit !== null) {
    if (industryHit.length === 0) return null
    matched.industries = industryHit
  }
  if (themeHit !== null) {
    if (themeHit.length === 0) return null
    matched.themes = themeHit
  }
  return matched
}

// ── Relevance scoring ───────────────────────────────────────────────────────

function computeRelevance(args: {
  signal: { tickers: string[]; sectors: string[]; industries: string[]; themes: string[]; urgency: string }
  profile: AnalystProfile
  matched: MatchedUniverse | null
  tickerHit: "POSITION" | "WATCHLIST" | null
}): { score: number; reasons: string[] } {
  const { signal, profile, matched, tickerHit } = args
  let score = 0
  const reasons: string[] = []

  if (tickerHit === "POSITION") {
    score += 50
    reasons.push("position_match")
  } else if (tickerHit === "WATCHLIST") {
    score += 45
    reasons.push("watchlist_match")
  }

  if (matched?.sectors && matched.sectors.length > 0) {
    score += 20
    reasons.push(`sector_match:${matched.sectors.join("/")}`)
  }
  if (matched?.industries && matched.industries.length > 0) {
    score += 22
    reasons.push(`industry_match:${matched.industries.join("/")}`)
  }
  if (matched?.themes && matched.themes.length > 0) {
    score += 18
    reasons.push(`theme_match:${matched.themes.join("/")}`)
  }

  // Soft keyword match — only useful when producers haven't tagged signals
  // with clean sectors/industries/themes yet.
  const signalText = [...signal.themes, ...signal.tickers].join(" ").toLowerCase()
  for (const kw of profile.keywords) {
    if (signalText.includes(kw)) {
      score += 8
      reasons.push(`keyword:${kw}`)
    }
  }

  if (signal.urgency === "BREAKING") score += 15
  else if (signal.urgency === "HIGH") score += 10

  return { score: Math.min(100, score), reasons }
}

/**
 * Decide routeReasonCode for a (signal, analyst) pair.
 * Decision order matches the B contract:
 *   POSITION > WATCHLIST > DIRECT_TICKER > DISCOVERY (multi-dim universe) >
 *   {INDUSTRY,SECTOR,THEME}_MATCH (single dimension) > CROSS_ANALYST.
 */
function decideRouteCode(args: {
  tickerHit: "POSITION" | "WATCHLIST" | null
  isOwnedMonitorTicker: boolean  // DIRECT_TICKER: owned monitor named this ticker
  matched: MatchedUniverse | null
  isCrossAnalyst: boolean
}): RouteReasonCode | null {
  const { tickerHit, isOwnedMonitorTicker, matched, isCrossAnalyst } = args

  if (tickerHit === "POSITION") return "POSITION"
  if (tickerHit === "WATCHLIST") return "WATCHLIST"
  if (isOwnedMonitorTicker) return "DIRECT_TICKER"

  if (matched) {
    const dims = [
      matched.sectors?.length ?? 0,
      matched.industries?.length ?? 0,
      matched.themes?.length ?? 0,
    ].filter((n) => n > 0)

    if (dims.length >= 1) return "DISCOVERY"
  }

  if (isCrossAnalyst) return "CROSS_ANALYST"
  return null
}

// ── Novelty (per-(analyst, signal)) ─────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function computeNoveltyScore(args: {
  signalTickers: string[]
  signalThemes: string[]
  recentRoutes: { tickers: string[]; themes: string[] }[]
}): number {
  const tickers = new Set(args.signalTickers.map((t) => t.toUpperCase()))
  const themes = new Set(args.signalThemes.map((t) => t.toUpperCase()))
  if (tickers.size === 0 && themes.size === 0) return 50

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

// ── Discovery reservation ───────────────────────────────────────────────────
//
// Per-analyst cap + reserve ≥20% of slots for DISCOVERY-coded routes so
// discovery representation survives top-N truncation.

interface RouteCandidate {
  analystId: string
  signalId: string
  relevanceScore: number
  rawRelevanceScore: number
  noveltyScore: number
  routeReason: string
  routeReasonCode: RouteReasonCode
  matchedUniverse: MatchedUniverse
}

const DISCOVERY_RESERVATION = 0.2
const MAX_ROUTES_PER_ANALYST = 40

function applyDiscoveryReservation(routes: RouteCandidate[]): RouteCandidate[] {
  if (routes.length === 0) return []
  const sorted = [...routes].sort((a, b) => b.relevanceScore - a.relevanceScore)
  const cap = Math.min(MAX_ROUTES_PER_ANALYST, sorted.length)
  const reserveSlots = Math.ceil(cap * DISCOVERY_RESERVATION)

  const discovery: RouteCandidate[] = []
  const rest: RouteCandidate[] = []
  for (const c of sorted) {
    if (c.routeReasonCode === "DISCOVERY" && discovery.length < reserveSlots) {
      discovery.push(c)
    } else {
      rest.push(c)
    }
  }
  const remaining = cap - discovery.length
  const kept = [...discovery, ...rest.slice(0, remaining)]
  kept.sort((a, b) => b.relevanceScore - a.relevanceScore)
  return kept
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
        const positionSet = new Set<string>(
          a.positions.map((p) => p.symbol.toUpperCase())
        )
        const watchlistSet = new Set<string>([
          ...a.watchlist.map((t) => t.toUpperCase()),
          ...a.tickerUniverse.map((t) => t.toUpperCase()),
          ...a.watchlistItems.map((w) => w.symbol.toUpperCase()),
        ])
        for (const p of positionSet) watchlistSet.delete(p)

        const keywordSet = new Set([
          ...extractKeywords(a.analystPrompt),
          ...extractKeywords(a.strategyInstructions),
        ])

        return {
          id: a.id,
          positionTickers: [...positionSet],
          watchlistTickers: [...watchlistSet],
          // Session A: sectors/industries/themes arrive canonical; no upper().
          sectors: a.sectors,
          industries: a.industries,
          themes: a.themes,
          // Feeds values are canonical uppercase FEEDS; compared by exact
          // equality against Signal.aggregateType (same casing, same spelling).
          feeds: a.feeds ?? [],
          // Exchanges + exclusions are still uppercase-by-convention (tickers
          // + exchange codes), so keep the defensive toUpperCase() here.
          exchanges: a.exchanges.map((x) => x.toUpperCase()),
          exclusions: a.exclusionList.map((x) => x.toUpperCase()),
          keywords: [...keywordSet],
        }
      })
    })

    if (profiles.length === 0) {
      return { routed: 0, reason: "no-enabled-analysts" }
    }

    // ── Step 2: Get today's signals (with monitor scope) ────────────────────
    //
    // Historically this used `routes: { none: {} }` to skip signals that had
    // any prior route. Problem: once ONE analyst was routed, every later
    // router invocation (triggered by subsequent batch events) skipped the
    // signal entirely — so analysts missed on the first pass could never
    // recover. Observed in practice: TMT had 0 POSITION routes on NVDA/AMZN
    // despite holding both; signals had routed to STA on an earlier pass
    // and then got skipped.
    //
    // Fix: load every signal from today. The (analystId, signalId) UNIQUE
    // constraint + skipDuplicates on createMany below makes re-evaluation
    // idempotent — a second pass can only ADD missing routes, never dupe.
    // Cost: N analysts × M signals evaluations per invocation, bounded by
    // today's volume (~200 signals × 6 analysts = 1.2k iterations, trivial).

    const signals = await step.run("load-todays-signals", async () => {
      const todayStart = etTradingDayDate()
      return prisma.signal.findMany({
        where: {
          createdAt: { gte: todayStart },
        },
        select: {
          id: true,
          tickers: true,
          sectors: true,
          industries: true,
          themes: true,
          urgency: true,
          aggregateType: true,
          monitorId: true,
          monitor: {
            select: { scope: true, analystId: true },
          },
        },
      })
    })

    if (signals.length === 0) {
      return { routed: 0, reason: "no-unrouted-signals" }
    }

    // ── Step 2.5: Load recent route history per analyst (7d, for novelty) ───

    const recentRoutesByAnalyst = await step.run(
      "load-recent-routes",
      async () => {
        const since = new Date(Date.now() - SEVEN_DAYS_MS)
        const result: Record<string, { tickers: string[]; themes: string[] }[]> = {}
        for (const profile of profiles) {
          const rows = await prisma.analystSignalRoute.findMany({
            where: { analystId: profile.id, routedAt: { gte: since } },
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

    // ── Step 3: Build candidates per analyst ────────────────────────────────

    const routeResult = await step.run("route-signals", async () => {
      const candidatesByAnalyst: Record<string, RouteCandidate[]> = {}
      for (const p of profiles) candidatesByAnalyst[p.id] = []

      let droppedByNovelty = 0
      let droppedByThreshold = 0
      let droppedOutOfUniverse = 0
      let fastPathed = 0
      let crossPosted = 0

      for (const signal of signals) {
        const ownerId =
          signal.monitor?.scope === "ANALYST"
            ? signal.monitor.analystId ?? null
            : null

        for (const profile of profiles) {
          // Hard exclusion wins.
          if (
            signal.tickers.some((t) =>
              profile.exclusions.includes(t.toUpperCase())
            )
          ) {
            continue
          }

          // Ticker membership check (bypasses universe fence).
          const positionSet = new Set(profile.positionTickers)
          const watchlistSet = new Set(profile.watchlistTickers)
          let tickerHit: "POSITION" | "WATCHLIST" | null = null
          for (const t of signal.tickers) {
            const up = t.toUpperCase()
            if (positionSet.has(up)) {
              tickerHit = "POSITION"
              break
            }
            if (watchlistSet.has(up)) {
              tickerHit = "WATCHLIST"
              // Don't break — a position hit on another ticker should still win.
            }
          }

          const isOwner = ownerId !== null && profile.id === ownerId
          const isCrossAnalyst = ownerId !== null && profile.id !== ownerId

          // For cross-analyst routes, require a ticker overlap (the cross-post
          // gate). Otherwise one analyst's owned feed would flood every other
          // analyst.
          if (isCrossAnalyst && tickerHit === null) continue

          // Feed-subscription check. Aggregate signals (earnings calendar,
          // market movers — signal.aggregateType populated) carry empty
          // sectors/industries by design, so the news-signal matchUniverse
          // below would always reject them for any analyst with a configured
          // sector/industry fence. Short-circuit: if this analyst subscribed
          // to the feed via AgentConfig.feeds (canonical FEEDS values — see
          // lib/universe/feeds.ts), route the full firehose. Ticker overlap
          // is a separate tier-2 path handled by the existing tickerHit.
          const feedHit =
            signal.aggregateType != null &&
            profile.feeds.includes(signal.aggregateType)

          // Aggregates that don't match the feed AND don't have a ticker hit
          // AND aren't owner-scoped drop here. Previously they squeaked
          // through matchUniverse via the "empty dim = vacuous pass" semantic
          // only for analysts with no Universe set; explicit short-circuit
          // makes the behavior obvious.
          if (
            signal.aggregateType != null &&
            !feedHit &&
            tickerHit === null &&
            !isOwner
          ) {
            droppedOutOfUniverse++
            continue
          }

          // Universe match (skipped when ticker is owned, feeds-subscribed,
          // or the signal is an aggregate that already passed the feed/ticker
          // check above — aggregates have no sector/industry/theme fence to
          // match against).
          const matched =
            tickerHit !== null || feedHit || signal.aggregateType != null
              ? ({} as MatchedUniverse) // ticker / feeds / aggregate bypass
              : matchUniverse(
                  {
                    sectors: signal.sectors,
                    industries: signal.industries,
                    themes: signal.themes,
                  },
                  profile
                )

          if (matched === null && !isOwner) {
            droppedOutOfUniverse++
            continue
          }

          const { score: rawScore, reasons } = computeRelevance({
            signal,
            profile,
            matched: tickerHit !== null ? null : matched,
            tickerHit,
          })

          // Owner fast-path: no floor. Feed-subscribed aggregates: no floor
          // either — subscription IS the intent signal, and aggregates carry
          // no sector/industry/theme boosts that would otherwise lift them
          // over 15 on relevance scoring alone. Everyone else: 15-point floor.
          if (!isOwner && !feedHit && rawScore < 15) continue

          const novelty = computeNoveltyScore({
            signalTickers: signal.tickers,
            signalThemes: signal.themes,
            recentRoutes: recentRoutesByAnalyst[profile.id] ?? [],
          })

          // Three independent novelty / threshold carve-outs:
          //
          // 1. Urgency — a HIGH or BREAKING signal is actionable news (+49%
          //    breakout, insider burst, earnings beat) even when the ticker
          //    is familiar. Spare it from the low-novelty drop AND floor the
          //    multiplier at 30 so a fresh development on a known name still
          //    beats generic noise after scoring.
          //
          // 2. Aggregate — market movers / earnings calendar are daily
          //    recurring snapshots over wide ticker sets (earnings calendar
          //    alone can be ~1000 tickers). That overlap drives novelty to 5
          //    and the standard floor silently discards every one of them.
          //    Exempt aggregates so "Top Gainers" / "Earnings calendar" land
          //    every day.
          //
          // 3. Ticker-owned — POSITION and WATCHLIST matches mean the analyst
          //    holds or is tracking this ticker. They NEED news on it, even
          //    MEDIUM-urgency news, even when the ticker has been in routing
          //    history forever. Previously TMT held NVDA but got 0 POSITION
          //    routes because novelty=5 killed every MEDIUM NVDA signal and
          //    the cross-penalty pushed HIGH ones below the 15-point
          //    threshold. Treat ticker-owned like isOwner: bypass novelty
          //    drop, bypass threshold drop, and floor novelty at 30 for
          //    scoring.
          const isUrgent =
            signal.urgency === "BREAKING" || signal.urgency === "HIGH"
          const isAggregate = signal.aggregateType != null
          const isTickerOwned = tickerHit !== null

          if (
            novelty < 20 &&
            !isUrgent &&
            !isOwner &&
            !isAggregate &&
            !isTickerOwned
          ) {
            droppedByNovelty++
            continue
          }

          const effectiveNovelty =
            isUrgent || isTickerOwned ? Math.max(novelty, 30) : novelty
          const crossPenalty = isCrossAnalyst ? 0.6 : 1.0
          const adjusted = Math.max(
            0,
            Math.min(
              100,
              Math.round((rawScore * effectiveNovelty * crossPenalty) / 100)
            )
          )

          if (adjusted < 15 && !isOwner && !isTickerOwned && !feedHit) {
            droppedByThreshold++
            continue
          }

          // Decide routeReasonCode.
          const isOwnedMonitorTicker =
            isOwner && signal.tickers.length > 0 && tickerHit === null
          let code = decideRouteCode({
            tickerHit,
            isOwnedMonitorTicker,
            matched: tickerHit !== null ? null : matched,
            isCrossAnalyst,
          })

          // Aggregate overrides take precedence over ticker-hit codes so the
          // UI can distinguish "this aggregate contains one of your names"
          // (AGGREGATE_TICKER_MATCH) from "news about your position"
          // (POSITION). Subscription wins over ticker overlap when both
          // are true — subscription IS the intent signal.
          if (signal.aggregateType != null) {
            if (feedHit) code = "FIRM_AGGREGATE_FEED"
            else if (tickerHit !== null) code = "AGGREGATE_TICKER_MATCH"
          }

          // Cross-analyst hits override to CROSS_ANALYST when the originating
          // analyst is NOT this one — so the UI can show provenance even if
          // the ticker happens to be in watchlist. Applies to aggregates too.
          if (isCrossAnalyst) code = "CROSS_ANALYST"

          if (code === null) continue

          // Build matchedUniverse JSON (only populate contributing keys).
          const mu: MatchedUniverse = {}
          if (tickerHit === "POSITION") mu.inPositions = true
          if (tickerHit === "WATCHLIST") mu.inWatchlist = true
          if (matched?.sectors?.length) mu.sectors = matched.sectors
          if (matched?.industries?.length) mu.industries = matched.industries
          if (matched?.themes?.length) mu.themes = matched.themes
          if (isCrossAnalyst && ownerId) mu.fromAnalystId = ownerId
          if (signal.aggregateType != null) mu.feed = signal.aggregateType

          if (isOwner && code === "DIRECT_TICKER") fastPathed++
          if (isCrossAnalyst) crossPosted++

          candidatesByAnalyst[profile.id].push({
            analystId: profile.id,
            signalId: signal.id,
            relevanceScore: adjusted,
            rawRelevanceScore: rawScore,
            noveltyScore: novelty,
            routeReason: [
              ...reasons,
              `code:${code}`,
              ...(isOwner ? ["owned_monitor"] : []),
              ...(isCrossAnalyst ? [`cross_analyst:${ownerId}`] : []),
              `novelty:${novelty}`,
              `raw:${rawScore}`,
            ].join(", "),
            routeReasonCode: code,
            matchedUniverse: mu,
          })
        }
      }

      const finalRoutes: RouteCandidate[] = []
      const codeCounts: Record<RouteReasonCode, number> = {
        DISCOVERY: 0,
        WATCHLIST: 0,
        POSITION: 0,
        DIRECT_TICKER: 0,
        SECTOR_MATCH: 0,
        INDUSTRY_MATCH: 0,
        THEME_MATCH: 0,
        CROSS_ANALYST: 0,
        FIRM_AGGREGATE_FEED: 0,
        AGGREGATE_TICKER_MATCH: 0,
      }
      for (const profileId of Object.keys(candidatesByAnalyst)) {
        const kept = applyDiscoveryReservation(candidatesByAnalyst[profileId])
        for (const r of kept) {
          finalRoutes.push(r)
          codeCounts[r.routeReasonCode]++
        }
      }

      if (finalRoutes.length > 0) {
        await prisma.analystSignalRoute.createMany({
          data: finalRoutes.map((r) => ({
            analystId: r.analystId,
            signalId: r.signalId,
            relevanceScore: r.relevanceScore,
            rawRelevanceScore: r.rawRelevanceScore,
            noveltyScore: r.noveltyScore,
            routeReason: r.routeReason,
            routeReasonCode: r.routeReasonCode,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            matchedUniverse: r.matchedUniverse as any,
          })),
          skipDuplicates: true,
        })

        // Denormalize the MAX novelty for each signal back onto Signal.
        // Novelty is per-(analyst, signal), but Signal.noveltyScore is the
        // global "how fresh is this signal to *anyone*" value the /intelligence
        // UI shows. Without this, every Signal row sits at the default 50
        // forever and the global novelty view is meaningless. MAX reflects the
        // "most-novel-for-some-analyst" read — stale cross-analyst signals fall
        // to 5, genuinely new content stays at 80.
        const maxByS: Record<string, number> = {}
        for (const r of finalRoutes) {
          const prev = maxByS[r.signalId]
          if (prev === undefined || r.noveltyScore > prev) {
            maxByS[r.signalId] = r.noveltyScore
          }
        }
        await Promise.all(
          Object.entries(maxByS).map(([signalId, noveltyScore]) =>
            prisma.signal.update({
              where: { id: signalId },
              data: { noveltyScore },
            })
          )
        )
      }

      return {
        routesCreated: finalRoutes.length,
        droppedByNovelty,
        droppedByThreshold,
        droppedOutOfUniverse,
        fastPathed,
        crossPosted,
        codeCounts,
      }
    })

    return {
      signalsProcessed: signals.length,
      analystsActive: profiles.length,
      ...routeResult,
    }
  }
)
