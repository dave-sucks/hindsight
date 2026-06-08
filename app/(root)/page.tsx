import DashboardClient from "@/components/dashboard/DashboardClient";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import type { DashboardData } from "@/lib/actions/portfolio.actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";

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
    netContributed: 100_000,
    dayPnl: 0,
    dayPnlPct: 0,
  },
  equityCurve: [], pnlCurve: [], realizedCurve: [], agentConfigs: [], recentRuns: [],
  todaysPicks: [], recentPicks: [], hasAlpacaKey: false, analystCount: 0,
  hasCompletedRun: false, hasBrief: false, analysts: [], analystEquityCurves: {},
  spyBenchmark: { '1W': null, '1M': null, '1Y': null },
  spyCandles: [],
};

export default async function Home() {
  const environment = await getCurrentEnvironment();

  const [data, supabase] = await Promise.all([
    getDashboardData(environment).catch(() => EMPTY_DASHBOARD),
    createClient(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <DashboardClient
      data={data}
      userId={user?.id}
    />
  );
}
