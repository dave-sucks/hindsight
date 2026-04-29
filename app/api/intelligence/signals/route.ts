import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"
import { etTradingDayDate } from "@/lib/market-hours"

// GET /api/intelligence/signals — list recent signals/findings.
//
// PRODUCT CONTRACT (updated):
//   The Findings feed shows EVERY signal the firm has collected. Routing is
//   about per-analyst relevance ranking, not about firm-feed visibility. An
//   aggregate signal (market movers, earnings calendar) should appear in
//   Findings even before — or without ever — being routed to an analyst.
//
//   Previous implementation filtered by `routes.some(analystId IN userAnalysts)`,
//   which meant aggregate signals with no routes (the common case while the
//   router catches up or if they match no analyst's fence) disappeared from
//   the feed entirely. Fixed here.
//
//   The route payload is still returned on each signal so the UI can render
//   "Routed to: …" chips. Analyst + Route filters still work — they just
//   become opt-in narrow-downs rather than mandatory visibility gates.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Get this user's analyst IDs — used only when the client explicitly filters
  // by analyst or route reason (so the filter is intersected with this user's
  // analysts rather than leaking cross-firm in a future multi-user world).
  const userAnalysts = await prisma.agentConfig.findMany({
    where: { userId: user.id },
    select: { id: true },
  })
  const analystIds = userAnalysts.map((a) => a.id)

  const type = req.nextUrl.searchParams.get("type")
  const urgency = req.nextUrl.searchParams.get("urgency")
  const batchId = req.nextUrl.searchParams.get("batchId")
  const theme = req.nextUrl.searchParams.get("theme")
  const routeReasonCode = req.nextUrl.searchParams.get("routeReasonCode")
  const orphans = req.nextUrl.searchParams.get("orphans") === "1"
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50")

  // Time scoping. Default: today's trading day only. Callers can:
  //   ?lookbackDays=N — extend N trading days backwards
  //   ?all=1          — no time filter (full history, audit/debug only)
  const allTime = req.nextUrl.searchParams.get("all") === "1"
  const lookbackDaysRaw = req.nextUrl.searchParams.get("lookbackDays")
  const lookbackDays = Math.max(
    0,
    Math.min(30, parseInt(lookbackDaysRaw ?? "0") || 0),
  )
  let timeFilterClause: object = {}
  if (!allTime) {
    const today = etTradingDayDate()
    const windowStart = new Date(today)
    windowStart.setUTCDate(windowStart.getUTCDate() - lookbackDays)
    timeFilterClause = {
      OR: [
        { tradingDay: { gte: windowStart, lte: today } },
        { tradingDay: null, createdAt: { gte: windowStart } },
      ],
    }
  }

  const parseCsv = (raw: string | null): string[] | null => {
    if (!raw) return null;
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : null;
  };
  const tickers = parseCsv(req.nextUrl.searchParams.get("ticker"));
  const sectors = parseCsv(req.nextUrl.searchParams.get("sector"));
  const industries = parseCsv(req.nextUrl.searchParams.get("industry"));
  const filterAnalystIds = parseCsv(req.nextUrl.searchParams.get("analystId"));
  const routeCodes = parseCsv(routeReasonCode);
  // Podcast feature — `podcastId=` filters to signals routed to ANY segment
  // of the named podcast via PodcastSegmentSignalRoute. Mirror of analystId
  // routing: same Signal table, different routing junction. Mutually exclusive
  // in practice (a signal can have both kinds of routes; the filter just
  // determines which we INTERSECT against). Ownership check: we resolve the
  // podcast's segment ids only if the podcast belongs to this user.
  const podcastIdRaw = req.nextUrl.searchParams.get("podcastId");
  let podcastSegmentIds: string[] | null = null;
  if (podcastIdRaw) {
    const podcast = await prisma.podcast.findFirst({
      where: { id: podcastIdRaw, userId: user.id },
      select: { segments: { select: { id: true } } },
    });
    podcastSegmentIds = podcast?.segments.map((s) => s.id) ?? [];
  }

  // Route filter is now OPT-IN. We only attach a `routes: { some: … }` clause
  // if the caller actually filtered by analyst or route-reason. With no such
  // filter, every signal is visible — routing is metadata, not a visibility
  // gate.
  //
  // Podcast filter takes precedence — if podcastId is set, we filter via the
  // podcast-segment route junction table instead.
  const hasRouteFilter = filterAnalystIds !== null || routeCodes !== null;
  let routeFilterClause: object = {};
  if (podcastSegmentIds !== null) {
    if (podcastSegmentIds.length === 0) {
      // Podcast exists with no segments, OR podcast doesn't belong to user.
      // Either way: empty result is the right answer.
      return NextResponse.json([]);
    }
    routeFilterClause = {
      segmentRoutes: {
        some: { podcastSegmentId: { in: podcastSegmentIds } },
      },
    };
  } else if (hasRouteFilter) {
    const routeReasonWhere = routeCodes
      ? routeCodes.length === 1
        ? { routeReasonCode: routeCodes[0] }
        : { routeReasonCode: { in: routeCodes } }
      : {};
    const scopedAnalystIds = filterAnalystIds
      ? filterAnalystIds.filter((id) => analystIds.includes(id))
      : analystIds;
    const analystRouteWhere: Record<string, unknown> =
      scopedAnalystIds.length === 1
        ? { analystId: scopedAnalystIds[0], ...routeReasonWhere }
        : { analystId: { in: scopedAnalystIds }, ...routeReasonWhere };
    routeFilterClause = { routes: { some: analystRouteWhere } };
  }

  const signals = await prisma.signal.findMany({
    where: {
      ...(tickers
        ? tickers.length === 1
          ? { tickers: { has: tickers[0] } }
          : { tickers: { hasSome: tickers } }
        : {}),
      ...(type ? { type } : {}),
      ...(urgency ? { urgency } : {}),
      ...(batchId ? { batchId } : {}),
      ...(sectors
        ? sectors.length === 1
          ? { sectors: { has: sectors[0] } }
          : { sectors: { hasSome: sectors } }
        : {}),
      ...(industries
        ? industries.length === 1
          ? { industries: { has: industries[0] } }
          : { industries: { hasSome: industries } }
        : {}),
      ...(theme ? { themes: { has: theme } } : {}),
      ...(orphans ? { sectors: { isEmpty: true }, themes: { isEmpty: true } } : {}),
      ...routeFilterClause,
      ...timeFilterClause,
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: {
      id: true,
      batchId: true,
      artifactId: true,
      monitorId: true,
      type: true,
      headline: true,
      summary: true,
      evidence: true,
      tickers: true,
      themes: true,
      sectors: true,
      industries: true,
      sentiment: true,
      noveltyScore: true,
      urgency: true,
      sourceQuality: true,
      freshness: true,
      sourceUrls: true,
      sourceNames: true,
      searchTool: true,
      searchQuery: true,
      searchContext: true,
      aggregateType: true,
      dataPayload: true,
      itemCount: true,
      expiresAt: true,
      createdAt: true,
      batch: {
        select: { jobType: true, status: true, startedAt: true },
      },
      monitor: {
        select: { id: true, name: true, type: true, method: true, config: true },
      },
      routes: {
        select: {
          id: true,
          analystId: true,
          analyst: { select: { id: true, name: true } },
          relevanceScore: true,
          routeReason: true,
          routeReasonCode: true,
          matchedUniverse: true,
          status: true,
        },
      },
    },
  })

  return NextResponse.json(signals)
}
