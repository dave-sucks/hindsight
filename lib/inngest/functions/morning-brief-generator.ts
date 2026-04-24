// ── Morning Brief Generator ─────────────────────────────────────────────────
// Runs at 7:45 AM ET after signal routing.
// For each enabled analyst, reads their routed signals + portfolio state
// and generates a structured MorningBrief via GPT-4o.
// This brief becomes the analyst's pre-run intelligence when they start.

import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { generateObject } from "ai"
import { openai } from "@ai-sdk/openai"
import { z } from "zod"
import { etTradingDayDate } from "@/lib/market-hours"

// ── Brief schema ────────────────────────────────────────────────────────────

const morningBriefSchema = z.object({
  marketContext: z
    .string()
    .describe(
      "3-4 sentences on today's market regime, key themes, and macro backdrop relevant to this analyst's mandate. Reference specific data points from signals."
    ),
  portfolioAlerts: z
    .array(
      z.object({
        ticker: z.string(),
        alert: z.string().describe("What happened — be specific. e.g. 'Beat EPS by 12%, raised guidance'"),
        urgency: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
        signalIds: z.array(z.string()).describe("IDs of the signals that informed this alert"),
      })
    )
    .describe("Alerts for the analyst's current positions and active watchlist items. Only include if there are real developments — do not invent alerts."),
  watchlistUpdates: z
    .array(
      z.object({
        ticker: z.string(),
        update: z.string().describe("What changed since the last check"),
        recommendation: z.enum(["INITIATE", "ADD_TO_WATCHLIST", "REMOVE", "HOLD", "RESEARCH_MORE"]),
        signalIds: z.array(z.string()),
      })
    )
    .describe("Updates for watchlist items based on today's signals."),
  newOpportunities: z
    .array(
      z.object({
        headline: z.string(),
        tickers: z.array(z.string()),
        thesisSeed: z.string().describe("A 1-2 sentence thesis seed the analyst could develop"),
        signalIds: z.array(z.string()),
      })
    )
    .describe(
      "NEW tickers the analyst should consider — MUST be tickers NOT on the " +
      "watchlist and NOT in open positions. Watchlist graduations belong in " +
      "watchlistUpdates, not here. Surface up to 5 genuine discovery candidates; " +
      "if DISCOVERY_SIGNALS has >= 3 eligible tickers, include at least 3. " +
      "Cap watchlist-recycling will be scrubbed."
    ),
  attentionPriority: z
    .array(z.string())
    .describe("Ordered list of tickers the analyst should focus on today, most urgent first. Max 5."),
  riskFlags: z
    .array(z.string())
    .describe("Specific risk warnings — earnings today, ex-div dates, sector rotation signals, macro events. Only include real, concrete flags."),
})

// ── Build prompt context ────────────────────────────────────────────────────

type BriefSignal = {
  id: string
  type: string
  headline: string
  summary: string | null
  tickers: string[]
  sentiment: string | null
  urgency: string | null
  freshness: string | null
  relevanceScore: number
  routeReason: string | null
  // Session 3 / Workstream B contract — canonical enum + match payload.
  // One of: POSITION | WATCHLIST | DIRECT_TICKER | DISCOVERY |
  //         INDUSTRY_MATCH | SECTOR_MATCH | THEME_MATCH | CROSS_ANALYST
  routeReasonCode: string | null
  // JSON payload from signal-router explaining which universe dims matched.
  // Shape: { sectors?, industries?, themes?, inWatchlist?, inPositions?,
  //          fromAnalystId?, marketCap? }
  matchedUniverse: unknown
  sources: string[]
}

async function buildBriefContext(analystId: string) {
  // Ground the brief to TODAY's routing pool only. The old query loaded every
  // PENDING route across all time, which let the generator recycle signalIds
  // from prior days and report bogus `signalCount` values (the hardcoded
  // `take: 50` cap was being surfaced verbatim). Scoping to today's trading
  // day + requesting a generous ceiling means signalCount reflects reality
  // and cited IDs can only come from today's router output.
  const tradingDayStart = etTradingDayDate()
  const [analyst, signals, positions, watchlistItems] = await Promise.all([
    prisma.agentConfig.findUniqueOrThrow({
      where: { id: analystId },
    }),
    prisma.analystSignalRoute.findMany({
      where: {
        analystId,
        routedAt: { gte: tradingDayStart },
      },
      include: {
        signal: true,
      },
      orderBy: { relevanceScore: "desc" },
      take: 150, // generous ceiling — we want the real count, not the cap
    }),
    prisma.position.findMany({
      where: { analystId, status: "OPEN" },
      select: { symbol: true, direction: true, quantity: true, avgCost: true },
    }),
    prisma.analystWatchlistItem.findMany({
      where: { analystId, status: "ACTIVE" },
      select: { symbol: true, reason: true, priority: true },
    }),
  ])

  const positionTickers = positions.map((p) => p.symbol)
  const watchlistTickers = watchlistItems.map((w) => w.symbol)

  // Format signals for the prompt
  const signalSummaries: BriefSignal[] = signals.map((route) => {
    const s = route.signal
    return {
      id: s.id,
      type: s.type,
      headline: s.headline,
      summary: s.summary,
      tickers: s.tickers,
      sentiment: s.sentiment,
      urgency: s.urgency,
      freshness: s.freshness,
      relevanceScore: route.relevanceScore,
      routeReason: route.routeReason,
      routeReasonCode: route.routeReasonCode,
      matchedUniverse: route.matchedUniverse,
      sources: s.sourceNames,
    }
  })

  // Session 3: split signals into 3 buckets by routeReasonCode so the model
  // sees discovery candidates as a distinct first-class category (not buried at
  // the bottom of a flat 50-item list). The discovery bucket absorbs any
  // non-portfolio/non-watchlist code: DISCOVERY, SECTOR_MATCH, INDUSTRY_MATCH,
  // THEME_MATCH, DIRECT_TICKER, CROSS_ANALYST.
  //
  // Aggregate routes (FIRM_AGGREGATE_FEED, AGGREGATE_TICKER_MATCH — from
  // subscribed feeds or ticker-intersection with the aggregate firehose)
  // route into portfolio / watchlist when matchedUniverse says one of the
  // analyst's held/watched tickers is named; otherwise discovery. Without
  // this the earnings calendar line about AAPL (which the analyst holds)
  // gets buried under "new opportunities" — the user wanted the exact opposite.
  const isAggregate = (s: BriefSignal) =>
    s.routeReasonCode === "FIRM_AGGREGATE_FEED" ||
    s.routeReasonCode === "AGGREGATE_TICKER_MATCH"
  const mu = (s: BriefSignal) =>
    (s.matchedUniverse as { inPositions?: boolean; inWatchlist?: boolean } | null) ?? null
  const portfolioBucket = signalSummaries.filter(
    (s) =>
      s.routeReasonCode === "POSITION" ||
      (isAggregate(s) && mu(s)?.inPositions === true)
  )
  const watchlistBucket = signalSummaries.filter(
    (s) =>
      s.routeReasonCode === "WATCHLIST" ||
      (isAggregate(s) && mu(s)?.inPositions !== true && mu(s)?.inWatchlist === true)
  )
  const discoveryBucket = signalSummaries.filter(
    (s) =>
      s.routeReasonCode !== "POSITION" &&
      s.routeReasonCode !== "WATCHLIST" &&
      !(isAggregate(s) && (mu(s)?.inPositions === true || mu(s)?.inWatchlist === true))
  )

  // IntelligencePolicy lives as JSON on AgentConfig. Extract the fields the
  // brief generator cares about with defensive defaults so older analysts
  // don't break.
  const policy = (analyst.intelligencePolicy ?? {}) as {
    holdingsAttention?: number
    watchlistAttention?: number
    discoveryAttention?: number
  }

  // Allowlist of signalIds that are in today's routing pool. The post-
  // generation validator rejects any cited signalId not in this set so the
  // model can't recycle IDs from prior days.
  const allowedSignalIds = new Set(signalSummaries.map((s) => s.id))

  return {
    analystName: analyst.name,
    analystPrompt: analyst.analystPrompt ?? "",
    sectors: analyst.sectors,
    // Universe fields live directly on AgentConfig per B contract.
    universe: {
      sectors: analyst.sectors,
      industries: analyst.industries,
      themes: analyst.themes,
      exclusions: analyst.exclusionList,
      marketCapMin: analyst.marketCapMin ? Number(analyst.marketCapMin) : null,
      marketCapMax: analyst.marketCapMax ? Number(analyst.marketCapMax) : null,
    },
    positions: positions.map((p) => `${p.symbol} (${p.direction}, ${p.quantity} shares @ $${p.avgCost})`),
    positionRows: positions,
    watchlist: watchlistItems.map((w) => `${w.symbol} [${w.priority}] — ${w.reason}`),
    positionTickers,
    watchlistTickers,
    signalCount: signals.length,
    signals: signalSummaries,
    portfolioSignals: portfolioBucket,
    watchlistSignals: watchlistBucket,
    discoverySignals: discoveryBucket,
    allowedSignalIds,
    holdingsAttention: policy.holdingsAttention ?? 0,
  }
}

// ── Validators ──────────────────────────────────────────────────────────────

type BriefOutput = {
  marketContext: string
  portfolioAlerts: Array<{
    ticker: string
    alert: string
    urgency: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    signalIds: string[]
  }>
  watchlistUpdates: Array<{
    ticker: string
    update: string
    recommendation: string
    signalIds: string[]
  }>
  newOpportunities: Array<{
    headline: string
    tickers: string[]
    thesisSeed: string
    signalIds: string[]
  }>
  attentionPriority: string[]
  riskFlags: string[]
}

/**
 * Strip any signalId that isn't in today's routed pool. Returns the cleaned
 * brief and the count of hallucinated IDs (for logging). Cites that match
 * nothing the model could have actually seen indicate drift — surface the
 * count but don't fail the brief (we'd rather ship a scrubbed brief than
 * none at all).
 */
function scrubHallucinatedSignalIds(
  brief: BriefOutput,
  allowed: Set<string>
): { brief: BriefOutput; hallucinated: number } {
  let hallucinated = 0
  const scrub = (ids: string[]): string[] => {
    const kept: string[] = []
    for (const id of ids) {
      if (allowed.has(id)) kept.push(id)
      else hallucinated++
    }
    return kept
  }

  return {
    brief: {
      ...brief,
      portfolioAlerts: brief.portfolioAlerts.map((a) => ({
        ...a,
        signalIds: scrub(a.signalIds),
      })),
      watchlistUpdates: brief.watchlistUpdates.map((u) => ({
        ...u,
        signalIds: scrub(u.signalIds),
      })),
      newOpportunities: brief.newOpportunities.map((o) => ({
        ...o,
        signalIds: scrub(o.signalIds),
      })),
    },
    hallucinated,
  }
}

/**
 * Scrub newOpportunities whose tickers overlap the analyst's watchlist or
 * open positions. The prompt says "discovery candidates only" but GPT-4o
 * defaults to safe watchlist names (NVDA, TSM) and collapses the brief to
 * 2 familiar tickers even when the discovery bucket has 8+ genuine new
 * candidates. Post-process: drop watchlist/position tickers, count drops,
 * log so the failure is visible.
 *
 * Returns the cleaned brief and the count of scrubbed entries. If every
 * newOpportunities entry gets scrubbed, the array becomes empty rather
 * than silently corrected — that's intentional. An empty newOpportunities
 * with >0 drops is a clearer failure signal than a laundered "looks fine"
 * brief.
 */
function scrubWatchlistFromNewOpportunities(
  brief: BriefOutput,
  watchlistTickers: string[],
  positionTickers: string[]
): { brief: BriefOutput; scrubbed: number } {
  const excluded = new Set<string>([
    ...watchlistTickers.map((t) => t.toUpperCase()),
    ...positionTickers.map((t) => t.toUpperCase()),
  ])

  let scrubbed = 0
  const cleaned = brief.newOpportunities.filter((opp) => {
    const hasOverlap = opp.tickers.some((t) =>
      excluded.has(t.toUpperCase())
    )
    if (hasOverlap) scrubbed++
    return !hasOverlap
  })

  return {
    brief: { ...brief, newOpportunities: cleaned },
    scrubbed,
  }
}

/**
 * If intelligencePolicy.holdingsAttention > 0 and the analyst has open
 * positions, every holding must have at least one portfolioAlerts entry.
 * The model often emits `portfolioAlerts: []` when there's no fresh signal
 * on a position — not useful, the analyst needs to see every holding
 * acknowledged each morning. Inject a "no material change" placeholder
 * per missing position so the brief surfaces them all.
 */
function enforceHoldingsCoverage(
  brief: BriefOutput,
  positions: Array<{ symbol: string }>,
  holdingsAttention: number
): BriefOutput {
  if (holdingsAttention <= 0 || positions.length === 0) return brief

  const covered = new Set(
    brief.portfolioAlerts.map((a) => a.ticker.toUpperCase())
  )
  const missing = positions.filter(
    (p) => !covered.has(p.symbol.toUpperCase())
  )

  if (missing.length === 0) return brief

  const placeholders = missing.map((p) => ({
    ticker: p.symbol,
    alert: "No material change in today's routed signals.",
    urgency: "LOW" as const,
    signalIds: [],
  }))

  return {
    ...brief,
    portfolioAlerts: [...brief.portfolioAlerts, ...placeholders],
  }
}

// ── Inngest function ────────────────────────────────────────────────────────

export const morningBriefGenerator = inngest.createFunction(
  {
    id: "morning-brief-generator",
    name: "Morning Brief Generator",
    concurrency: { limit: 1 },
    retries: 1,
  },
  [
    { cron: "TZ=America/New_York 45 7 * * 1-5" },
    { event: "intelligence/generate-briefs" },
  ],
  async ({ step }) => {
    // ── Step 1: Get enabled analysts ────────────────────────────────────────

    const analysts = await step.run("load-analysts", async () => {
      return prisma.agentConfig.findMany({
        where: { enabled: true },
        select: { id: true, name: true },
      })
    })

    if (analysts.length === 0) {
      return { generated: 0, reason: "no-enabled-analysts" }
    }

    let generated = 0
    let failed = 0

    // ── Step 2: Generate brief per analyst ──────────────────────────────────

    for (const analyst of analysts) {
      const result = await step.run(`brief-${analyst.id}`, async () => {
        try {
          const context = await buildBriefContext(analyst.id)

          if (context.signalCount === 0) {
            return { success: true, skipped: true, reason: "no-signals" }
          }

          // Session 3: force discovery representation when discovery signals
          // exist. When they don't, we previously told the brief "do NOT
          // invent new tickers" — that cascaded into the research run as
          // a license for the agent to skip discovery entirely. Revised
          // 2026-04-24: even when DISCOVERY_SIGNALS is empty, nudge the
          // brief toward a discovery-intent signal to the analyst rather
          // than explicitly forbidding new names. The analyst's Stage 2
          // Discovery gate ALWAYS fires regardless of what the brief says,
          // so the brief should orient the agent, not give it an out.
          const hasDiscovery = context.discoverySignals.length > 0
          const discoveryClause = hasDiscovery
            ? `- newOpportunities MUST include at least 1 (ideally 2) items drawn from DISCOVERY_SIGNALS below — these are candidates outside the analyst's watchlist/positions that matched the Universe. Do NOT skip them just because they look unfamiliar.`
            : `- No discovery signals were routed to this analyst today. Leave newOpportunities empty in the structured output, but in marketContext note "Discovery router returned no candidates today — the analyst will run universe-fit discovery via get_stock_data and web_search during Stage 2." Do NOT tell the analyst to skip discovery; they are required to research at least 2 new tickers every run regardless of brief content.`

          const { object: rawBrief } = await generateObject({
            model: openai("gpt-4o"),
            schema: morningBriefSchema,
            prompt: `You are the morning intelligence briefer for "${context.analystName}".

ANALYST MANDATE:
${context.analystPrompt}

SECTORS: ${context.sectors.join(", ") || "All"}

UNIVERSE (discovery fence — AND across dims, OR within; empty = no filter):
  sectors:      ${context.universe.sectors.join(", ") || "—"}
  industries:   ${context.universe.industries.join(", ") || "—"}
  themes:       ${context.universe.themes.join(", ") || "—"}
  exclusions:   ${context.universe.exclusions.join(", ") || "—"}
  marketCapMin: ${context.universe.marketCapMin ?? "—"}
  marketCapMax: ${context.universe.marketCapMax ?? "—"}

CURRENT POSITIONS:
${context.positions.length > 0 ? context.positions.join("\n") : "None"}

ACTIVE WATCHLIST:
${context.watchlist.length > 0 ? context.watchlist.join("\n") : "None"}

PORTFOLIO_SIGNALS (${context.portfolioSignals.length}) — ticker is in an OPEN position:
${JSON.stringify(context.portfolioSignals, null, 2)}

WATCHLIST_SIGNALS (${context.watchlistSignals.length}) — ticker is on watchlist:
${JSON.stringify(context.watchlistSignals, null, 2)}

DISCOVERY_SIGNALS (${context.discoverySignals.length}) — NEW tickers matched via Universe or pure sector/theme:
${JSON.stringify(context.discoverySignals, null, 2)}

INSTRUCTIONS:
- Write a concise, actionable morning brief for this specific analyst.
- portfolioAlerts MUST only cover tickers from PORTFOLIO_SIGNALS.
- watchlistUpdates MUST only cover tickers from WATCHLIST_SIGNALS.
- newOpportunities items MUST be tickers NOT in the analyst's watchlist and NOT in any open position. These are DISCOVERY candidates — new names the analyst should consider researching today. Watchlist names graduating to tradeable setup go in watchlistUpdates (with recommendation=INITIATE), NEVER in newOpportunities. newOpportunities tickers that overlap watchlist/positions will be scrubbed out post-generation as a quality failure.
${discoveryClause}
- Be specific — reference the actual signals, not generic market commentary.
- Attention priority should reflect what needs action TODAY, not just what's interesting.
- Risk flags must be concrete and time-bound, not vague warnings.
- Include signal IDs in arrays so the analyst can drill into sources.
- If a signal contradicts the analyst's current positioning, flag it prominently.
- Surface up to 5 newOpportunities. If DISCOVERY_SIGNALS has >= 3 tickers that are NOT in watchlist and NOT in positions, newOpportunities MUST include at least 3. Do not artificially cap at 2 because "quality over quantity" — the analyst wants visibility on every genuine new-ticker candidate, not a filtered 2-pick highlight reel.
- If a signal has routeReasonCode "CROSS_ANALYST" (matchedUniverse.fromAnalystId set), another analyst's owned monitor surfaced it because it touches a ticker in this analyst's book — treat it as a credible second opinion, not as noise.
- Every signalId you cite MUST appear in one of the three signal arrays above. Do not invent IDs. Do not reference signals from prior days.`,
          })

          // Post-process pipeline:
          //   1. scrubHallucinatedSignalIds — drop cited IDs not in today's pool
          //   2. scrubWatchlistFromNewOpportunities — drop any newOpportunities
          //      whose tickers are on the watchlist or in positions. The model
          //      defaults to familiar watchlist names (NVDA, TSM) instead of
          //      genuine discovery candidates, collapsing a 50-signal brief to
          //      2 recycled tickers. This scrub forces the output to actually
          //      reflect new-ticker opportunities from DISCOVERY_SIGNALS.
          //   3. enforceHoldingsCoverage — ensure every open position has an
          //      alert row when holdingsAttention > 0.
          const { brief: idScrubbed, hallucinated } = scrubHallucinatedSignalIds(
            rawBrief,
            context.allowedSignalIds
          )
          if (hallucinated > 0) {
            console.warn(
              `[morning-brief] ${analyst.name}: scrubbed ${hallucinated} hallucinated signalId reference(s) not in today's pool`
            )
          }
          const { brief: noptScrubbed, scrubbed: nonDiscoveryDrops } =
            scrubWatchlistFromNewOpportunities(
              idScrubbed,
              context.watchlistTickers,
              context.positionTickers
            )
          if (nonDiscoveryDrops > 0) {
            console.warn(
              `[morning-brief] ${analyst.name}: scrubbed ${nonDiscoveryDrops} newOpportunities entry/entries that were watchlist/position tickers (not genuine discovery)`
            )
          }
          const brief = enforceHoldingsCoverage(
            noptScrubbed,
            context.positionRows,
            context.holdingsAttention
          )

          // Upsert today's brief (idempotent if re-run).
          // ET trading-day date — see lib/market-hours.ts for rationale.
          const today = etTradingDayDate()

          await prisma.morningBrief.upsert({
            where: {
              analystId_date: {
                analystId: analyst.id,
                date: today,
              },
            },
            create: {
              analystId: analyst.id,
              date: today,
              marketContext: brief.marketContext,
              portfolioAlerts: brief.portfolioAlerts,
              watchlistUpdates: brief.watchlistUpdates,
              newOpportunities: brief.newOpportunities,
              attentionPriority: brief.attentionPriority,
              riskFlags: brief.riskFlags,
              signalCount: context.signalCount,
            },
            update: {
              marketContext: brief.marketContext,
              portfolioAlerts: brief.portfolioAlerts,
              watchlistUpdates: brief.watchlistUpdates,
              newOpportunities: brief.newOpportunities,
              attentionPriority: brief.attentionPriority,
              riskFlags: brief.riskFlags,
              signalCount: context.signalCount,
              generatedAt: new Date(),
            },
          })

          return { success: true, skipped: false }
        } catch (error) {
          console.error(
            `[morning-brief] Failed for analyst "${analyst.name}":`,
            error instanceof Error ? error.message : error
          )
          return { success: false, skipped: false }
        }
      })

      if (result.success && !result.skipped) generated++
      if (!result.success) failed++
    }

    return {
      analystsTotal: analysts.length,
      briefsGenerated: generated,
      briefsFailed: failed,
    }
  }
)
