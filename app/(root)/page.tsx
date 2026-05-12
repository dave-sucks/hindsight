import DashboardClient from "@/components/dashboard/DashboardClient";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import type { DashboardData } from "@/lib/actions/portfolio.actions";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { EnvironmentTabs, parseEnvParam } from "@/components/settings/EnvironmentTabs";

const EMPTY_DASHBOARD: DashboardData = {
  openTrades: [], closedTrades: [], activityFeed: [],
  portfolio: {
    totalValue: 100_000,
    unrealizedPnl: 0,
    realizedPnl: 0,
    winRate: null,
    openCount: 0,
    netPositionValue: 0,
    positionMarketValue: 0,
    longMarketValue: 0,
    shortMarketValue: 0,
    cash: 100_000,
    buyingPower: 100_000,
    usingMargin: false,
    leverageRatio: 1,
    totalPnl: 0,
    accountReturnPct: 0,
  },
  equityCurve: [], realizedCurve: [], agentConfigs: [], recentRuns: [],
  todaysPicks: [], recentPicks: [], hasAlpacaKey: false, analystCount: 0,
  hasCompletedRun: false, hasBrief: false, analysts: [], analystEquityCurves: {},
  spyBenchmark: { '1W': null, '1M': null, '1Y': null },
  spyCandles: [],
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ env?: string }>;
}) {
  const params = await searchParams;
  const environment = parseEnvParam(params.env);

  const [data, supabase] = await Promise.all([
    getDashboardData(environment).catch(() => EMPTY_DASHBOARD),
    createClient(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [paperCount, liveCount] = user
    ? await Promise.all([
        prisma.position.count({ where: { userId: user.id, environment: "PAPER" } }),
        prisma.position.count({ where: { userId: user.id, environment: "LIVE" } }),
      ])
    : [0, 0];

  return (
    <div className="space-y-4">
      <div className="px-4 sm:px-6 pt-4 flex justify-end">
        <EnvironmentTabs
          current={environment}
          basePath="/"
          paperCount={paperCount}
          liveCount={liveCount}
        />
      </div>
      <DashboardClient
        data={data}
        userId={user?.id}
      />
    </div>
  );
}
