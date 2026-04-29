/**
 * read_signals — aligned with Session 3 / Workstream B Universe contract.
 *
 * Reads intelligence signals routed to this analyst by background jobs.
 * Applies intelligence-policy constraints (urgency floor, source quality,
 * budget). Falls back to sector/industry/theme/watchlist match if no
 * routed signals.
 *
 * Returns three buckets, segmented by `routeReasonCode` (set by
 * signal-router.ts):
 *   portfolioSignals  — routeReasonCode === "POSITION" OR an aggregate
 *                       route (FIRM_AGGREGATE_FEED / AGGREGATE_TICKER_MATCH)
 *                       where matchedUniverse.inPositions is true
 *   watchlistSignals  — routeReasonCode === "WATCHLIST" OR an aggregate
 *                       route where matchedUniverse.inWatchlist is true
 *                       (and inPositions is not)
 *   discoverySignals  — DISCOVERY | SECTOR_MATCH | INDUSTRY_MATCH |
 *                       THEME_MATCH | DIRECT_TICKER | CROSS_ANALYST |
 *                       FIRM_AGGREGATE_FEED (with no ticker overlap)
 *
 * The flat `signals` array is kept for legacy renderers and urgency sorts.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { etTradingDayDate } from "@/lib/market-hours";
import { toSourceRefs, sourceRefsToToolSources } from "@/lib/agent/tool-types";
import type {
  SignalItem,
  SignalsToolData,
  RouteReasonCode,
  MatchedUniverse,
} from "@/lib/agent/tool-types";

function mapSignal(
  r: {
    relevanceScore: number;
    routeReason: string | null;
    routeReasonCode: string | null;
    matchedUniverse: unknown;
    signal: {
      id: string;
      type: string;
      headline: string;
      summary: string | null;
      tickers: string[];
      themes: string[];
      sentiment: string | null;
      urgency: string | null;
      freshness: string | null;
      sourceNames: string[];
      sourceUrls: string[];
      artifactId: string | null;
    };
  },
): SignalItem {
  const code = (r.routeReasonCode as RouteReasonCode | null) ?? undefined;
  const mu = (r.matchedUniverse as MatchedUniverse | null) ?? null;
  return {
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
    routeReasonCode: code,
    matchedUniverse: mu,
    crossAnalystSource:
      code === "CROSS_ANALYST" ? mu?.fromAnalystId ?? null : null,
  };
}

/** Bucket a SignalItem by its routeReasonCode for the 3-bucket view. */
function bucketOf(
  s: SignalItem,
): "portfolio" | "watchlist" | "discovery" {
  const c = s.routeReasonCode;
  if (c === "POSITION") return "portfolio";
  if (c === "WATCHLIST") return "watchlist";
  // Aggregate routes — FIRM_AGGREGATE_FEED and AGGREGATE_TICKER_MATCH —
  // can land via ticker overlap with watchlist / positions. The route code
  // reflects the matching DIMENSION (subscription vs. ticker) but bucket
  // should reflect the name context: if one of the aggregate's tickers is
  // in the analyst's portfolio, surface this signal in the portfolio bucket
  // so holdings coverage isn't silently dropped to "discovery". Otherwise
  // fall through to discovery — subscribed feeds with no holding overlap
  // ARE the discovery firehose.
  if (c === "FIRM_AGGREGATE_FEED" || c === "AGGREGATE_TICKER_MATCH") {
    if (s.matchedUniverse?.inPositions) return "portfolio";
    if (s.matchedUniverse?.inWatchlist) return "watchlist";
    return "discovery";
  }
  // Everything else — DISCOVERY, SECTOR_MATCH, INDUSTRY_MATCH, THEME_MATCH,
  // DIRECT_TICKER, CROSS_ANALYST, or undefined — reads as discovery.
  return "discovery";
}

/**
 * ──────────────────────────────────────────────────────────────────────────────
 * TOOL DESIGN NOTE — why `bucket` was removed from the schema (2026-04-24)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Earlier versions of this tool exposed a `bucket` parameter
 * (POSITION | WATCHLIST | DISCOVERY) to let the agent narrow to one
 * routing bucket. In practice GPT-4o reached for it on every FIRST call,
 * passing `bucket: "POSITION"` (or similar) and only seeing 1/3 of its
 * routed day. That happened despite:
 *
 *   • Tool description LEADING with "CALL WITH NO ARGUMENTS"
 *   • Parameter description saying "FOLLOW-UP ONLY. Do not use on first call"
 *   • System prompt Stage 1 listing "DO NOT pass bucket..." explicitly
 *
 * The enum shape `["POSITION","WATCHLIST","DISCOVERY"]` simply looks like a
 * "pick one" knob to the model. No amount of prompt hardening stuck.
 *
 * Decision: remove `bucket` from the schema entirely. All other filters
 * (tickers, themes, type, urgency, limit) remain available for legitimate
 * targeted follow-ups — those have lower footgun risk because they require
 * the agent to supply specific values (a ticker, a theme name) it can only
 * know AFTER seeing the first call's response.
 *
 * What if someone later wants to add bucket back? Acceptable paths:
 *   1. Add a new tool like `browse_signals_by_bucket` that's explicit and
 *      not the default research path.
 *   2. Add `bucket` back ONLY after building a runtime gate that enforces
 *      "first read_signals call in this run must be no-args" — e.g. via the
 *      run context tracker.
 *
 * Do NOT just add `bucket` back with stronger prompt language. Been there.
 * See commit history 2026-04-24 and run cmodf9ipe000004kvmai13sne for
 * evidence.
 * ──────────────────────────────────────────────────────────────────────────────
 */
export const readSignals = defineTool({
  description:
    "Read TODAY's intelligence signals routed to you by background discovery jobs. Scoped to the current ET trading day.\n\n" +
    "The tool ALWAYS returns today's entire routed pool for this analyst, grouped into three buckets — portfolioSignals (news on your open positions), watchlistSignals (news on your watchlist), and discoverySignals (new-ticker candidates matched via your Universe fence). You cannot filter to a single bucket; that's the point — you need to see all three every run.\n\n" +
    "All parameters are OPTIONAL. For your FIRST call in a run, pass nothing — that returns the complete pool across all three buckets. Filters (tickers, themes, type, urgency) are for rare follow-up calls to deep-dive a specific ticker or sweep BREAKING urgency; never narrow on the first call.\n\n" +
    "Every returned signal carries a `signalId` — pass them to record_thesis as `sourceSignalIds` so the system can attribute the trade's outcome back to the monitors that produced them. Signals are marked as READ after retrieval. Do NOT ignore discoverySignals — that bucket is how new names surface.",
  schema: z.object({
    tickers: z
      .array(z.string())
      .optional()
      .describe("FOLLOW-UP ONLY. Restrict to signals mentioning these tickers. Do not use on your first call."),
    themes: z
      .array(z.string())
      .optional()
      .describe("FOLLOW-UP ONLY. Restrict to signals tagged with these themes (e.g. AI_CAPEX, FED_RATE_CUT). Do not use on your first call."),
    type: z
      .enum(["NEWS", "EARNINGS", "FILING", "SOCIAL", "PRICE_ACTION", "ANALYST_NOTE", "OPTIONS", "MACRO", "SECTOR"])
      .optional()
      .describe("FOLLOW-UP ONLY. Restrict to one signal type. Do not use on your first call."),
    urgency: z
      .enum(["LOW", "MEDIUM", "HIGH", "BREAKING"])
      .optional()
      .describe("FOLLOW-UP ONLY. Minimum urgency floor. Use urgency='BREAKING' only as a targeted sweep after an initial no-argument call."),
    limit: z
      .number()
      .optional()
      .describe("Max signals to return. Defaults to your policy cap. Rarely need to change."),
    lookbackDays: z
      .number()
      .int()
      .min(0)
      .max(14)
      .optional()
      .describe(
        "How many trading days back to include. Default 0 (today only). Use sparingly — historical signals are noisy and pollute today's picture.",
      ),
  }),
  ui: "tool-ui" as const,

  progressLabel: (args) => {
    const hasFilters =
      (args.tickers && args.tickers.length > 0) ||
      (args.themes && args.themes.length > 0) ||
      args.type ||
      args.urgency ||
      args.limit !== undefined;
    if (!hasFilters) return "Reading today's routed signals";
    if (args.tickers && args.tickers.length > 0) {
      const sample = args.tickers.slice(0, 2).map((t) => `$${t.toUpperCase()}`).join(", ");
      const extra = args.tickers.length > 2 ? ` (+${args.tickers.length - 2} more)` : "";
      return `Follow-up: signals on ${sample}${extra}`;
    }
    if (args.themes && args.themes.length > 0) {
      return `Follow-up: signals on ${args.themes[0]}${args.themes.length > 1 ? ` (+${args.themes.length - 1} more)` : ""}`;
    }
    if (args.urgency === "HIGH" || args.urgency === "BREAKING") return "Sweeping urgent signals";
    return "Reading signals routed to this analyst";
  },

  execute: async ({ tickers, themes, type, urgency, limit, lookbackDays = 0 }, ctx) => {
    // ── Podcast segment branch ───────────────────────────────────────────
    // When the run is a podcast-segment-run, ctx carries podcastSegmentId
    // (and analystId is undefined). Read the segment's routed signals from
    // PodcastSegmentSignalRoute. Same Signal table, different routing
    // table, different routing codes (OWNER / TOPIC_MATCH).
    //
    // We map onto the same SignalItem shape so downstream renderers and
    // the agent's text view stay identical — and bucket everything as
    // "discovery" since segments don't have positions/watchlist.
    if (ctx.podcastSegmentId) {
      return readSignalsForSegment({
        segmentId: ctx.podcastSegmentId,
        tickers,
        themes,
        type,
        urgency,
        limit,
        lookbackDays,
      });
    }

    if (!ctx.analystId) {
      return {
        summary: "No analyst or segment context — cannot read signals.",
        data: {
          count: 0,
          signals: [],
          portfolioSignals: [],
          watchlistSignals: [],
          discoverySignals: [],
        } as SignalsToolData,
        sources: [],
      };
    }

    const policy = ctx.intelligencePolicy;
    // Cap how many routes a single call returns. Practical upper bound kept
    // bounded so the response stays inside the reasoning-token budget.
    const HARD_LIMIT = 75;
    const policyMaxSignals = policy?.maxSignalsPerRun ?? 50;
    const callerLimit = typeof limit === "number" && limit > 0 ? limit : policyMaxSignals;
    const effectiveLimit = Math.min(callerLimit, policyMaxSignals, HARD_LIMIT);

    const urgencyOrder = ["LOW", "MEDIUM", "HIGH", "BREAKING"];
    const callerMinIdx = urgency ? urgencyOrder.indexOf(urgency) : 0;
    const policyMinIdx = policy?.minUrgency ? urgencyOrder.indexOf(policy.minUrgency) : 0;
    const effectiveMinIdx = Math.max(callerMinIdx, policyMinIdx);
    const validUrgencies = urgencyOrder.slice(effectiveMinIdx);

    const minSourceQuality = policy?.minSourceQuality ?? 2;
    const excludedCategories = policy?.excludedSourceCategories ?? [];

    // Load a wide slice so we can enforce per-ticker dedup and still have
    // enough variety left across all three buckets. The tool ALWAYS returns
    // all three buckets (see top-of-file design note — `bucket` was
    // removed from the schema because GPT-4o kept narrowing to one bucket
    // on first calls despite every prompt warning).
    const loadCap = Math.max(effectiveLimit * 2, 60);

    // Today-only by default. lookbackDays opens the window backwards in
    // trading-day terms; legacy rows with null tradingDay are tolerated by
    // matching on routedAt/createdAt for the same window. The signal-router
    // writes tradingDay using the same ET trading-day boundary.
    const today = etTradingDayDate();
    const windowStart = new Date(today);
    windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays);
    const tradingDayWindow = { gte: windowStart, lte: today };

    const routes = await prisma.analystSignalRoute.findMany({
      where: {
        analystId: ctx.analystId,
        status: { in: ["PENDING", "READ"] },
        OR: [
          { tradingDay: tradingDayWindow },
          { tradingDay: null, routedAt: { gte: windowStart } },
        ],
        signal: {
          ...(tickers && tickers.length > 0 ? { tickers: { hasSome: tickers } } : {}),
          ...(themes && themes.length > 0 ? { themes: { hasSome: themes } } : {}),
          ...(type ? { type } : {}),
          urgency: { in: validUrgencies },
          sourceQuality: { gte: minSourceQuality },
          deletedAt: null,
        },
      },
      include: { signal: { include: { artifact: true } } },
      orderBy: { relevanceScore: "desc" },
      take: loadCap + excludedCategories.length * 5,
    });

    let filtered = routes;
    if (excludedCategories.length > 0) {
      filtered = routes.filter((r) => {
        const signalSectors = r.signal.sectors ?? [];
        return !signalSectors.some((s: string) => (excludedCategories as string[]).includes(s));
      });
    }

    // Per-ticker cap: SMH × 9 in the top 10 is how TMT missed POET/GSIT/CSCO
    // on 2026-04-23. Allow max 2 signals per ticker so one hot story doesn't
    // starve discovery of unique names. Macro/aggregate signals with no
    // ticker are uncapped.
    const MAX_PER_TICKER = 2;
    const firstTickerKey = (r: (typeof filtered)[number]): string | null => {
      const t = r.signal.tickers?.[0];
      return t ? t.toUpperCase() : null;
    };

    // Group by bucket for the return shape, but do NOT filter to one bucket
    // — the agent always gets all three.
    const groupedByBucket: {
      portfolio: typeof filtered;
      watchlist: typeof filtered;
      discovery: typeof filtered;
    } = { portfolio: [], watchlist: [], discovery: [] };
    for (const r of filtered) {
      const code = r.routeReasonCode as RouteReasonCode | null;
      if (code === "POSITION") groupedByBucket.portfolio.push(r);
      else if (code === "WATCHLIST") groupedByBucket.watchlist.push(r);
      else groupedByBucket.discovery.push(r);
    }

    // Per-bucket fair-share so a hot bucket doesn't dominate. Generous
    // (~50/bucket at limit 150) — the point is the agent sees a reasonable
    // slice of each bucket, not a thin token from one.
    const perBucketCap = Math.max(10, Math.floor(effectiveLimit / 3));
    const picked: typeof filtered = [];
    const pickedIds = new Set<string>();
    for (const b of ["portfolio", "watchlist", "discovery"] as const) {
      const perTickerCount = new Map<string, number>();
      let kept = 0;
      for (const r of groupedByBucket[b]) {
        if (kept >= perBucketCap) break;
        const tk = firstTickerKey(r);
        if (tk) {
          const n = perTickerCount.get(tk) ?? 0;
          if (n >= MAX_PER_TICKER) continue;
          perTickerCount.set(tk, n + 1);
        }
        picked.push(r);
        pickedIds.add(r.id);
        kept++;
      }
    }
    // Backfill to effectiveLimit with whatever's left, highest score first,
    // respecting the per-ticker cap globally.
    const globalPerTicker = new Map<string, number>();
    for (const r of picked) {
      const tk = firstTickerKey(r);
      if (tk) globalPerTicker.set(tk, (globalPerTicker.get(tk) ?? 0) + 1);
    }
    for (const r of filtered) {
      if (picked.length >= effectiveLimit) break;
      if (pickedIds.has(r.id)) continue;
      const tk = firstTickerKey(r);
      if (tk) {
        const n = globalPerTicker.get(tk) ?? 0;
        if (n >= MAX_PER_TICKER) continue;
        globalPerTicker.set(tk, n + 1);
      }
      picked.push(r);
      pickedIds.add(r.id);
    }

    const finalRoutes = picked.slice(0, effectiveLimit);

    if (finalRoutes.length > 0) {
      await prisma.analystSignalRoute.updateMany({
        where: { id: { in: finalRoutes.map((r) => r.id) } },
        data: { status: "READ" },
      });
    }

    // Fallback: no routed signals at all for this analyst today — fall back
    // to direct sector/industry/theme/watchlist matching on today's signals.
    if (finalRoutes.length === 0) {
      const config = await prisma.agentConfig.findUnique({
        where: { id: ctx.analystId },
        select: {
          sectors: true,
          industries: true,
          themes: true,
          watchlist: true,
          exclusionList: true,
        },
      });

      const cfgSectors = config?.sectors ?? [];
      const cfgIndustries = config?.industries ?? [];
      const cfgThemes = config?.themes ?? [];
      const cfgWatchlist = config?.watchlist ?? [];
      const exclSet = new Set(
        (config?.exclusionList ?? []).map((e) => e.toUpperCase()),
      );

      const hasAnyFilter =
        cfgWatchlist.length > 0 ||
        cfgSectors.length > 0 ||
        cfgIndustries.length > 0 ||
        cfgThemes.length > 0;

      if (hasAnyFilter) {
        const fallbackSignals = await prisma.signal.findMany({
          where: {
            AND: [
              {
                OR: [
                  { tradingDay: tradingDayWindow },
                  { tradingDay: null, createdAt: { gte: windowStart } },
                ],
              },
              {
                OR: [
                  ...(cfgWatchlist.length > 0 ? [{ tickers: { hasSome: cfgWatchlist } }] : []),
                  ...(cfgSectors.length > 0 ? [{ sectors: { hasSome: cfgSectors } }] : []),
                  ...(cfgIndustries.length > 0 ? [{ industries: { hasSome: cfgIndustries } }] : []),
                  ...(cfgThemes.length > 0 ? [{ themes: { hasSome: cfgThemes } }] : []),
                ],
              },
            ],
            urgency: { in: validUrgencies },
            sourceQuality: { gte: minSourceQuality },
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
          take: effectiveLimit,
        });

        if (fallbackSignals.length > 0) {
          const watchSet = new Set(cfgWatchlist.map((w) => w.toUpperCase()));
          const fbSignals: SignalItem[] = fallbackSignals
            .filter((s) => !s.tickers.some((t) => exclSet.has(t.toUpperCase())))
            .map((s): SignalItem => {
              const hasWatchlist = s.tickers.some((t) => watchSet.has(t.toUpperCase()));
              // Fallback never has position data (positions require routing),
              // so classify as WATCHLIST or DISCOVERY only.
              const code: RouteReasonCode = hasWatchlist ? "WATCHLIST" : "DISCOVERY";
              return {
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
                routeReasonCode: code,
                matchedUniverse: {
                  inWatchlist: hasWatchlist,
                  inPositions: false,
                },
                crossAnalystSource: null,
              };
            });

          const portfolioSignals: SignalItem[] = [];
          const watchlistSignals = fbSignals.filter((s) => bucketOf(s) === "watchlist");
          const discoverySignals = fbSignals.filter((s) => bucketOf(s) === "discovery");

          const urgent = fbSignals.filter((s) => s.urgency === "HIGH" || s.urgency === "BREAKING").length;
          const bullish = fbSignals.filter((s) => s.sentiment === "BULLISH").length;
          const bearish = fbSignals.filter((s) => s.sentiment === "BEARISH").length;
          return {
            summary: `${fbSignals.length} signal${fbSignals.length !== 1 ? "s" : ""} (${urgent} urgent, ${bullish} bullish, ${bearish} bearish). Fallback: sector/industry/theme/watchlist match.`,
            data: {
              count: fbSignals.length,
              fallback: true,
              fallbackReason:
                "No routed signals found — falling back to sector/industry/theme/watchlist match",
              policyApplied: {
                maxSignals: policyMaxSignals,
                minUrgency: urgencyOrder[effectiveMinIdx],
                minSourceQuality,
                excludedCategories,
              },
              signals: fbSignals,
              portfolioSignals,
              watchlistSignals,
              discoverySignals,
              discoveryNote:
                discoverySignals.length === 0
                  ? "No discovery candidates this session — your Universe may need expansion."
                  : undefined,
              tickers: fbSignals.map((s) => ({
                ticker: s.tickers[0] ?? "MACRO",
                tag: s.urgency,
                summary: s.headline,
              })),
            } as SignalsToolData & { tickers: { ticker: string; tag: string; summary: string }[] },
            sources: sourceRefsToToolSources(fbSignals.flatMap((s) => s.sources)),
          };
        }
      }

      // Nothing — return empty but still shape-stable.
      return {
        summary: "No signals routed or available for fallback.",
        data: {
          count: 0,
          signals: [],
          portfolioSignals: [],
          watchlistSignals: [],
          discoverySignals: [],
          discoveryNote: "No discovery candidates this session.",
        } as SignalsToolData,
        sources: [],
      };
    }

    const mappedSignals = finalRoutes.map(mapSignal);

    const portfolioSignals = mappedSignals.filter((s) => bucketOf(s) === "portfolio");
    const watchlistSignals = mappedSignals.filter((s) => bucketOf(s) === "watchlist");
    const discoverySignals = mappedSignals.filter((s) => bucketOf(s) === "discovery");

    const urgent = mappedSignals.filter((s) => s.urgency === "HIGH" || s.urgency === "BREAKING").length;
    const bullish = mappedSignals.filter((s) => s.sentiment === "BULLISH").length;
    const bearish = mappedSignals.filter((s) => s.sentiment === "BEARISH").length;


    return {
      summary:
        `${mappedSignals.length} signal${mappedSignals.length !== 1 ? "s" : ""} ` +
        `(${urgent} urgent, ${bullish} bullish, ${bearish} bearish) · ` +
        `${portfolioSignals.length} portfolio / ${watchlistSignals.length} watchlist / ${discoverySignals.length} discovery.`,
      data: {
        count: mappedSignals.length,
        policyApplied: {
          maxSignals: policyMaxSignals,
          minUrgency: urgencyOrder[effectiveMinIdx],
          minSourceQuality,
          excludedCategories,
        },
        signals: mappedSignals,
        portfolioSignals,
        watchlistSignals,
        discoverySignals,
        discoveryNote:
          discoverySignals.length === 0
            ? "No discovery candidates this session — your Universe may need expansion."
            : undefined,
        tickers: mappedSignals.map((s) => ({
          ticker: s.tickers[0] ?? "MACRO",
          tag: s.urgency,
          summary: s.headline,
        })),
      } as SignalsToolData & { tickers: { ticker: string; tag: string; summary: string }[] },
      sources: sourceRefsToToolSources(mappedSignals.flatMap((s) => s.sources)),
    };
  },
});

// ── Podcast segment branch ────────────────────────────────────────────────
// Mirrors the analyst path but reads from PodcastSegmentSignalRoute. Same
// SignalItem shape so renderers and the agent's text view are identical.
// Buckets everything as "discovery" — segments don't have
// positions/watchlist concepts.
async function readSignalsForSegment(args: {
  segmentId: string;
  tickers?: string[];
  themes?: string[];
  type?: string;
  urgency?: "LOW" | "MEDIUM" | "HIGH" | "BREAKING";
  limit?: number;
  lookbackDays?: number;
}) {
  const { segmentId, tickers, themes, type, urgency, limit, lookbackDays = 0 } = args;

  const HARD_LIMIT = 75;
  const callerLimit = typeof limit === "number" && limit > 0 ? limit : 50;
  const effectiveLimit = Math.min(callerLimit, HARD_LIMIT);

  const urgencyOrder = ["LOW", "MEDIUM", "HIGH", "BREAKING"];
  const minIdx = urgency ? urgencyOrder.indexOf(urgency) : 0;
  const validUrgencies = urgencyOrder.slice(minIdx);

  const today = etTradingDayDate();
  const windowStart = new Date(today);
  windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays);
  const tradingDayWindow = { gte: windowStart, lte: today };

  const routes = await prisma.podcastSegmentSignalRoute.findMany({
    where: {
      podcastSegmentId: segmentId,
      status: { in: ["PENDING", "READ"] },
      OR: [
        { tradingDay: tradingDayWindow },
        { tradingDay: null, routedAt: { gte: windowStart } },
      ],
      signal: {
        ...(tickers && tickers.length > 0 ? { tickers: { hasSome: tickers } } : {}),
        ...(themes && themes.length > 0 ? { themes: { hasSome: themes } } : {}),
        ...(type ? { type } : {}),
        urgency: { in: validUrgencies },
        deletedAt: null,
      },
    },
    include: { signal: { include: { artifact: true } } },
    orderBy: { relevanceScore: "desc" },
    take: effectiveLimit,
  });

  if (routes.length > 0) {
    await prisma.podcastSegmentSignalRoute.updateMany({
      where: { id: { in: routes.map((r) => r.id) } },
      data: { status: "READ" },
    });
  }

  const mapped: SignalItem[] = routes.map((r) => {
    const code = (r.routeReasonCode ?? undefined) as RouteReasonCode | undefined;
    const mu = (r.matchedUniverse as MatchedUniverse | null) ?? null;
    return {
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
      routeReasonCode: code,
      matchedUniverse: mu,
      crossAnalystSource: null,
    };
  });

  // Segments don't have positions or watchlists — everything routes as
  // "discovery" for the bucketed return shape so downstream consumers
  // (renderer, system prompt) keep the same contract.
  return {
    summary:
      mapped.length === 0
        ? "No routed signals for this segment today."
        : `${mapped.length} signal${mapped.length === 1 ? "" : "s"} routed to this segment.`,
    data: {
      count: mapped.length,
      signals: mapped,
      portfolioSignals: [] as SignalItem[],
      watchlistSignals: [] as SignalItem[],
      discoverySignals: mapped,
      tickers: mapped.map((s) => ({
        ticker: s.tickers[0] ?? "TOPIC",
        tag: s.urgency,
        summary: s.headline,
      })),
    } as SignalsToolData & { tickers: { ticker: string; tag: string; summary: string }[] },
    sources: sourceRefsToToolSources(mapped.flatMap((s) => s.sources)),
  };
}
