import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getStockProfile } from "@/lib/actions/finnhub.actions";
import ResearchPage from "@/components/research/ResearchPage";
import type { CompanyProfile, ResearchRun, Analyst } from "@/components/research/ResearchPage";

export default async function ResearchRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userId = user?.id ?? "";

  if (!userId) {
    return (
      <ResearchPage
        analysts={[]}
        initialRuns={[]}
        profiles={{}}
        hasRunning={false}
      />
    );
  }

  // ── Load analysts + recent runs in parallel ───────────────────────────────
  const [analysts, runs, runningCount] = await Promise.all([
    prisma.agentConfig.findMany({
      where: { userId },
      select: { id: true, name: true, enabled: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.researchRun.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
      take: 30,
      select: {
        id: true,
        agentConfigId: true,
        status: true,
        source: true,
        startedAt: true,
        completedAt: true,
        agentConfig: { select: { name: true } },
        theses: {
          select: {
            id: true,
            ticker: true,
            direction: true,
            confidenceScore: true,
            holdDuration: true,
            signalTypes: true,
            sector: true,
            reasoningSummary: true,
            entryPrice: true,
            targetPrice: true,
            stopLoss: true,
            createdAt: true,
            trade: {
              select: {
                id: true,
                realizedPnl: true,
                status: true,
                entryPrice: true,
                closePrice: true,
              },
            },
          },
          orderBy: { confidenceScore: "desc" },
        },
      },
    }),
    prisma.researchRun.count({ where: { userId, status: "RUNNING" } }),
  ]);

  // ── Resolve analyst names on runs ─────────────────────────────────────────
  const typedRuns: ResearchRun[] = runs.map((run) => ({
    id: run.id,
    agentConfigId: run.agentConfigId,
    analystName:
      run.agentConfig?.name ??
      (run.source === "MANUAL" ? "Manual Research" : "Agent"),
    status: run.status,
    source: run.source,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    theses: run.theses,
  }));

  // ── Fetch company profiles for all unique tickers ─────────────────────────
  const uniqueTickers = [
    ...new Set(runs.flatMap((r) => r.theses.map((t) => t.ticker))),
  ];

  const profileResults = await Promise.allSettled(
    uniqueTickers.map(async (sym) => {
      const profile = await getStockProfile(sym);
      return [sym, profile] as const;
    })
  );

  const profiles: Record<string, CompanyProfile> = {};
  for (const result of profileResults) {
    if (result.status === "fulfilled" && result.value[1]) {
      const [sym, profile] = result.value;
      if (profile) {
        profiles[sym] = {
          name: profile.name,
          logo: profile.logo,
          exchange: profile.exchange,
        };
      }
    }
  }

  const typedAnalysts: Analyst[] = analysts;

  return (
    <ResearchPage
      analysts={typedAnalysts}
      initialRuns={typedRuns}
      profiles={profiles}
      hasRunning={runningCount > 0}
    />
  );
}
