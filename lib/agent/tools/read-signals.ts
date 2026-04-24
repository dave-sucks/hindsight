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

export const readSignals = defineTool({
  description:
    "Read today's intelligence signals routed to you by background discovery jobs. " +
    "Returns all three buckets in one call — portfolioSignals (your open positions), watchlistSignals (your watchlist), and discoverySignals (new-ticker candidates matched via your Universe fence). You cannot filter to a single bucket; the tool always returns the full routed pool. Call with no arguments for standard usage. " +
    "Every returned signal carries a `signalId` — remember the ones that actually informed your thinking and pass them to record_thesis as `sourceSignalIds` so the system can attribute the trade's outcome back to the monitors that produced them. Signals are marked as READ after retrieval. Do NOT ignore discoverySignals — that bucket is how new names surface.",
  schema: z.object({
    urgency: z
      .enum(["LOW", "MEDIUM", "HIGH", "BREAKING"])
      .optional()
      .describe("Optional minimum urgency floor. Omit for the full pool. Use urgency='BREAKING' only as a rare targeted follow-up after the default call."),
  }),
  ui: "tool-ui" as const,

  progressLabel: (args) => {
    if (args.urgency === "HIGH" || args.urgency === "BREAKING") {
      return "Sweeping urgent signals";
    }
    return "Reading today's routed signals";
  },

  execute: async ({ urgency }, ctx) => {
    if (!ctx.analystId) {
      return {
        summary: "No analyst context — cannot read signals.",
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
    // Practical hard ceiling on what a single call can return. Keeps context
    // bounded while still covering a full day's routes for normal analysts.
    // TMT hit 165 routes on 2026-04-23 — this fits the expected shape.
    const HARD_LIMIT = 150;
    const policyMaxSignals = policy?.maxSignalsPerRun ?? 100;
    const effectiveLimit = Math.min(policyMaxSignals, HARD_LIMIT);

    const urgencyOrder = ["LOW", "MEDIUM", "HIGH", "BREAKING"];
    const callerMinIdx = urgency ? urgencyOrder.indexOf(urgency) : 0;
    const policyMinIdx = policy?.minUrgency ? urgencyOrder.indexOf(policy.minUrgency) : 0;
    const effectiveMinIdx = Math.max(callerMinIdx, policyMinIdx);
    const validUrgencies = urgencyOrder.slice(effectiveMinIdx);

    const minSourceQuality = policy?.minSourceQuality ?? 2;
    const excludedCategories = policy?.excludedSourceCategories ?? [];

    // Load a wide slice so we can enforce per-ticker dedup and still have
    // enough variety left across all three buckets.
    const loadCap = Math.max(effectiveLimit * 2, 60);

    const routes = await prisma.analystSignalRoute.findMany({
      where: {
        analystId: ctx.analystId,
        status: { in: ["PENDING", "READ"] },
        signal: {
          urgency: { in: validUrgencies },
          sourceQuality: { gte: minSourceQuality },
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
        const today = etTradingDayDate();
        const fallbackSignals = await prisma.signal.findMany({
          where: {
            createdAt: { gte: today },
            urgency: { in: validUrgencies },
            sourceQuality: { gte: minSourceQuality },
            OR: [
              ...(cfgWatchlist.length > 0 ? [{ tickers: { hasSome: cfgWatchlist } }] : []),
              ...(cfgSectors.length > 0 ? [{ sectors: { hasSome: cfgSectors } }] : []),
              ...(cfgIndustries.length > 0 ? [{ industries: { hasSome: cfgIndustries } }] : []),
              ...(cfgThemes.length > 0 ? [{ themes: { hasSome: cfgThemes } }] : []),
            ],
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
