import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";

// ── /api/intelligence/health ────────────────────────────────────────────────
// All data needed to render the Health tab on /intelligence.
// Single round-trip, server-side aggregation.

export interface HealthData {
  // ── Signal volume ──────────────────────────────────────────────────────────
  signalsByDay: { date: string; total: number; routed: number }[];

  // ── Ticker concentration ──────────────────────────────────────────────────
  topTickers: {
    ticker: string;
    count: number;
    kind: "portfolio" | "watchlist" | "discovery";
  }[];
  tickerKinds: { portfolio: number; watchlist: number; discovery: number };

  // ── Route reason breakdown ─────────────────────────────────────────────────
  routeBreakdown: { code: string; count: number }[];

  // ── Monitor health ─────────────────────────────────────────────────────────
  monitorHealth: {
    id: string;
    name: string;
    type: string;
    method: string | null;
    lastRunAt: string | null;
    signalCount7d: number;
    enabled: boolean;
  }[];

  // ── Coverage (sectors / industries / themes) ───────────────────────────────
  coverage: {
    total: number;
    orphanCount: number;
    sectors: { name: string; count: number }[];
    industries: { name: string; count: number }[];
    themes: { name: string; count: number }[];
  };

  // ── Agent run tool stats ───────────────────────────────────────────────────
  toolStats: {
    name: string;
    calls: number;
    errors: number;
    avgLatencyMs: number;
  }[];
  recentRuns: {
    date: string;
    analystName: string;
    totalToolCalls: number;
    durationMs: number;
    status: string;
  }[];

  // ── Headline totals ────────────────────────────────────────────────────────
  totals: {
    signals7d: number;
    signalsToday: number;
    routedToday: number;
    activeMonitors: number;
    briefs7d: number;
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const agentConfigs = await prisma.agentConfig.findMany({
    where: { accountId },
    select: { id: true },
  });
  const analystIds: string[] = agentConfigs.map((a: { id: string }) => a.id);

  const now = new Date();
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  // ── Parallel fetches ──────────────────────────────────────────────────────
  const routeWhere =
    analystIds.length > 0 ? { analystId: { in: analystIds } } : undefined;

  const [signals14d, positions, watchlistItems, monitors, recentRuns, briefs7d] =
    await Promise.all([
      // Signals last 14 days with minimal select
      prisma.signal.findMany({
        where: { createdAt: { gte: fourteenDaysAgo } },
        select: {
          id: true,
          createdAt: true,
          tickers: true,
          sectors: true,
          themes: true,
          industries: true,
          routes: {
            where: routeWhere,
            select: { routeReasonCode: true },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
        take: 3000,
      }),

      // Open positions — for portfolio ticker classification
      prisma.position.findMany({
        where: { status: "OPEN", accountId },
        select: { symbol: true },
      }),

      // Watchlist — for watchlist ticker classification
      prisma.analystWatchlistItem.findMany({
        where: {
          accountId,
          status: "ACTIVE",
        },
        select: { symbol: true },
      }),

      // All monitors (scoped to this user)
      prisma.monitor.findMany({
        where: {
          OR: [
            { scope: "FIRM" },
            ...(analystIds.length > 0
              ? [{ analystId: { in: analystIds } }]
              : []),
          ],
        },
        select: {
          id: true,
          name: true,
          type: true,
          method: true,
          lastRunAt: true,
          enabled: true,
        },
      }),

      // Recent research runs with toolStats
      prisma.researchRun.findMany({
        where: { accountId },
        orderBy: { startedAt: "desc" },
        take: 14,
        select: {
          id: true,
          startedAt: true,
          completedAt: true,
          status: true,
          parameters: true,
          agentConfig: { select: { name: true } },
        },
      }),

      // Briefs generated in last 7 days
      analystIds.length > 0
        ? prisma.morningBrief.count({
            where: {
              analystId: { in: analystIds },
              generatedAt: { gte: sevenDaysAgo },
            },
          })
        : Promise.resolve(0),
    ]);

  // ── Per-monitor 7-day signal counts ───────────────────────────────────────
  const monitorSignalCountsRaw = await prisma.signal.groupBy({
    by: ["monitorId"],
    where: {
      createdAt: { gte: sevenDaysAgo },
      monitorId: { not: null },
    },
    _count: { id: true },
  });
  const monitorCountMap = new Map<string, number>();
  for (const row of monitorSignalCountsRaw) {
    if (row.monitorId) monitorCountMap.set(row.monitorId, row._count.id);
  }

  // ── Build Sets for ticker classification ──────────────────────────────────
  const portfolioSet = new Set<string>(
    positions.map((p: { symbol: string }) => p.symbol.toUpperCase())
  );
  const watchlistSet = new Set<string>(
    watchlistItems.map((w: { symbol: string }) => w.symbol.toUpperCase())
  );

  // ── Signals by day ─────────────────────────────────────────────────────────
  const dayTotals = new Map<string, { total: number; routed: number }>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(fourteenDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
    const key = dateKey(d);
    dayTotals.set(key, { total: 0, routed: 0 });
  }
  const todayKeyStr = dateKey(now);
  if (!dayTotals.has(todayKeyStr)) dayTotals.set(todayKeyStr, { total: 0, routed: 0 });

  for (const s of signals14d) {
    const key = dateKey(s.createdAt);
    const entry = dayTotals.get(key) ?? { total: 0, routed: 0 };
    entry.total += 1;
    if (s.routes.length > 0) entry.routed += 1;
    dayTotals.set(key, entry);
  }

  const signalsByDay = Array.from(dayTotals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { total, routed }]) => ({ date, total, routed }));

  // ── Ticker concentration (last 7 days) ────────────────────────────────────
  const tickerCounts = new Map<string, number>();
  for (const s of signals14d) {
    if (s.createdAt < sevenDaysAgo) continue;
    for (const ticker of s.tickers) {
      const t = ticker.toUpperCase();
      tickerCounts.set(t, (tickerCounts.get(t) ?? 0) + 1);
    }
  }

  const topTickers: HealthData["topTickers"] = Array.from(tickerCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([ticker, count]) => {
      const kind: "portfolio" | "watchlist" | "discovery" = portfolioSet.has(ticker)
        ? "portfolio"
        : watchlistSet.has(ticker)
        ? "watchlist"
        : "discovery";
      return { ticker, count, kind };
    });

  const tickerKinds = { portfolio: 0, watchlist: 0, discovery: 0 };
  for (const t of topTickers) tickerKinds[t.kind] += 1;

  // ── Route reason breakdown (last 7 days) ──────────────────────────────────
  const routeCodeCounts = new Map<string, number>();
  for (const s of signals14d) {
    if (s.createdAt < sevenDaysAgo) continue;
    for (const r of s.routes) {
      if (r.routeReasonCode) {
        routeCodeCounts.set(
          r.routeReasonCode,
          (routeCodeCounts.get(r.routeReasonCode) ?? 0) + 1
        );
      }
    }
  }
  const routeBreakdown: HealthData["routeBreakdown"] = Array.from(
    routeCodeCounts.entries()
  )
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  // ── Coverage (sectors / industries / themes) — last 7 days ────────────────
  const sectorCounts = new Map<string, number>();
  const industryCounts = new Map<string, number>();
  const themeCounts = new Map<string, number>();
  let orphanCount = 0;
  let coverageTotal = 0;

  for (const s of signals14d) {
    if (s.createdAt < sevenDaysAgo) continue;
    coverageTotal++;
    if (s.sectors.length === 0 && s.themes.length === 0) orphanCount++;
    for (const v of s.sectors) sectorCounts.set(v, (sectorCounts.get(v) ?? 0) + 1);
    for (const v of s.industries) industryCounts.set(v, (industryCounts.get(v) ?? 0) + 1);
    for (const v of s.themes) themeCounts.set(v, (themeCounts.get(v) ?? 0) + 1);
  }

  const toRows = (m: Map<string, number>): { name: string; count: number }[] =>
    Array.from(m.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

  const coverage: HealthData["coverage"] = {
    total: coverageTotal,
    orphanCount,
    sectors: toRows(sectorCounts),
    industries: toRows(industryCounts),
    themes: toRows(themeCounts),
  };

  // ── Monitor health ─────────────────────────────────────────────────────────
  type MonitorRow = { id: string; name: string; type: string; method: string | null; lastRunAt: Date | null; enabled: boolean };
  const monitorHealth: HealthData["monitorHealth"] = monitors.map((m: MonitorRow) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    method: m.method,
    lastRunAt: m.lastRunAt ? m.lastRunAt.toISOString() : null,
    signalCount7d: monitorCountMap.get(m.id) ?? 0,
    enabled: m.enabled,
  }));

  // ── Tool stats from recent runs ────────────────────────────────────────────
  type ToolStatsEntry = {
    count?: number;
    errors?: number;
    totalLatencyMs?: number;
  };
  // Two possible shapes in parameters:
  //   API route runs (PR #170+):   { toolStats: { totalToolCalls, durationMs, byTool } }
  //   Morning cron runs (all):     { agentToolCalls: N, elapsedMs: N }
  type RunParams = {
    toolStats?: {
      byTool?: Record<string, ToolStatsEntry>;
      totalToolCalls?: number;
      durationMs?: number;
    };
    // Morning cron fields
    agentToolCalls?: number;
    elapsedMs?: number;
  };

  const aggregatedTools = new Map<
    string,
    { calls: number; errors: number; totalLatencyMs: number }
  >();

  const recentRunRows: HealthData["recentRuns"] = [];

  for (const run of recentRuns) {
    const params = run.parameters as RunParams;
    const ts = params?.toolStats;

    // Prefer toolStats (API route), fall back to cron-written agentToolCalls
    const totalToolCalls = ts?.totalToolCalls ?? params?.agentToolCalls ?? 0;
    const durationMs = ts?.durationMs ?? params?.elapsedMs ?? 0;

    recentRunRows.push({
      date: run.startedAt.toISOString(),
      analystName: run.agentConfig?.name ?? "Unknown",
      totalToolCalls,
      durationMs,
      status: run.status,
    });

    if (!ts?.byTool) continue;
    for (const [toolName, stats] of Object.entries(ts.byTool)) {
      const existing = aggregatedTools.get(toolName) ?? {
        calls: 0,
        errors: 0,
        totalLatencyMs: 0,
      };
      existing.calls += stats.count ?? 0;
      existing.errors += stats.errors ?? 0;
      existing.totalLatencyMs += stats.totalLatencyMs ?? 0;
      aggregatedTools.set(toolName, existing);
    }
  }

  const toolStats: HealthData["toolStats"] = Array.from(
    aggregatedTools.entries()
  )
    .map(([name, { calls, errors, totalLatencyMs }]) => ({
      name,
      calls,
      errors,
      avgLatencyMs: calls > 0 ? Math.round(totalLatencyMs / calls) : 0,
    }))
    .sort((a, b) => b.calls - a.calls);

  // ── Headline totals ────────────────────────────────────────────────────────
  let signals7d = 0;
  let signalsToday = 0;
  let routedToday = 0;

  for (const s of signals14d) {
    if (s.createdAt >= sevenDaysAgo) signals7d++;
    if (s.createdAt >= todayStart) {
      signalsToday++;
      if (s.routes.length > 0) routedToday++;
    }
  }

  const activeMonitors = monitors.filter((m: MonitorRow) => m.enabled).length;

  const data: HealthData = {
    signalsByDay,
    topTickers,
    tickerKinds,
    routeBreakdown,
    monitorHealth,
    coverage,
    toolStats,
    recentRuns: recentRunRows,
    totals: {
      signals7d,
      signalsToday,
      routedToday,
      activeMonitors,
      briefs7d,
    },
  };

  return NextResponse.json(data);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
