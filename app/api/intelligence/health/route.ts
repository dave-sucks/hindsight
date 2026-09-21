import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";

// ── /api/intelligence/health ────────────────────────────────────────────────
// What the Health tab on /intelligence renders. Single round-trip.
//
// Trimmed 2026-09-21 to the two things that still have a producer: the tool
// stats and the run list, both read off ResearchRun.parameters. The signal
// volume, route origins, ticker concentration, coverage, monitor health and
// the four headline counters went with the jobs that filled them — they would
// read zero forever. The Alpaca↔DB panel above them has its own endpoint
// (/api/intelligence/sync-health) and is untouched.

export interface HealthData {
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
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const recentRuns = await prisma.researchRun.findMany({
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
  });

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

  return NextResponse.json({ toolStats, recentRuns: recentRunRows } as HealthData);
}
