import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { createClient } from "@/lib/supabase/server"

// GET /api/intelligence/signals — list recent signals/findings scoped to current user
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Get this user's analyst IDs
  const userAnalysts = await prisma.agentConfig.findMany({
    where: { userId: user.id },
    select: { id: true },
  })
  const analystIds = userAnalysts.map((a) => a.id)

  const ticker = req.nextUrl.searchParams.get("ticker")
  const type = req.nextUrl.searchParams.get("type")
  const urgency = req.nextUrl.searchParams.get("urgency")
  const batchId = req.nextUrl.searchParams.get("batchId")
  const analystId = req.nextUrl.searchParams.get("analystId")
  const sector = req.nextUrl.searchParams.get("sector")
  const industry = req.nextUrl.searchParams.get("industry")
  const theme = req.nextUrl.searchParams.get("theme")
  const routeReasonCode = req.nextUrl.searchParams.get("routeReasonCode")
  const orphans = req.nextUrl.searchParams.get("orphans") === "1"
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50")

  // routeReasonCode accepts a single code or a comma-separated list. The
  // analyst Routing strip collapses POSITION + WATCHLIST + DIRECT_TICKER into
  // a single "Holdings" chip and sends all three codes in one request.
  const parseRouteCodes = (raw: string | null): string[] | null => {
    if (!raw) return null;
    const codes = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return codes.length > 0 ? codes : null;
  };
  const routeCodes = parseRouteCodes(routeReasonCode);
  const routeReasonWhere = routeCodes
    ? routeCodes.length === 1
      ? { routeReasonCode: routeCodes[0] }
      : { routeReasonCode: { in: routeCodes } }
    : {};

  // Build the analyst-route constraint once. When analystId is set, scope
  // to just that analyst (and optionally that route reason); otherwise scope
  // to any of this user's analysts.
  const analystRouteWhere: Record<string, unknown> = analystId
    ? { analystId, ...routeReasonWhere }
    : { analystId: { in: analystIds }, ...routeReasonWhere };

  const signals = await prisma.signal.findMany({
    where: {
      ...(ticker ? { tickers: { has: ticker } } : {}),
      ...(type ? { type } : {}),
      ...(urgency ? { urgency } : {}),
      ...(batchId ? { batchId } : {}),
      ...(sector ? { sectors: { has: sector } } : {}),
      ...(industry ? { industries: { has: industry } } : {}),
      ...(theme ? { themes: { has: theme } } : {}),
      // Orphans: no sector tag AND no theme tag. Industry alone doesn't count
      // as "routable" — the router scores industry as a single-dim SECTOR
      // sibling, and an industry-only tag usually means Sonar drifted.
      ...(orphans ? { sectors: { isEmpty: true }, themes: { isEmpty: true } } : {}),
      routes: { some: analystRouteWhere },
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
