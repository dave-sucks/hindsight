import DashboardClient from "@/components/dashboard/DashboardClient";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import type { DashboardData } from "@/lib/actions/portfolio.actions";
import { getCoverageData } from "@/lib/actions/coverage.actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";
import { getLatestDigest } from "@/lib/actions/digest.actions";
import { getPinnedTickers } from "@/lib/actions/pins.actions";

const EMPTY_DASHBOARD: DashboardData = {
  openTrades: [], pendingTrades: [], closedTrades: [], activityFeed: [],
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

  const [data, digest, coverage, pinned, supabase] = await Promise.all([
    getDashboardData(environment).catch(() => EMPTY_DASHBOARD),
    getLatestDigest(environment).catch(() => null),
    // Coverage Table (Feature B). Read-only, additive — failure degrades to
    // empty groups so the rest of the dashboard is unaffected.
    getCoverageData(environment).catch(() => ({ trades: [], watching: [], passed: [] })),
    // Pinned rail. Read-only and additive — a failure just hides the panel.
    getPinnedTickers().catch(() => [] as string[]),
    createClient(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <DashboardClient
      data={data}
      userId={user?.id}
      digest={digest}
      coverage={coverage}
      pinned={pinned}
    />
  );
}
