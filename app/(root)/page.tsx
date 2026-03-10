import DashboardClient from "@/components/dashboard/DashboardClient";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import { getRecentRunsForDashboard } from "@/lib/actions/analyst.actions";
import { getStockProfile } from "@/lib/actions/finnhub.actions";
import { createClient } from "@/lib/supabase/server";
import type { ThesisCardProfile } from "@/components/ThesisCard";

export default async function Home() {
  const [data, recentRuns, supabase] = await Promise.all([
    getDashboardData(),
    getRecentRunsForDashboard(),
    createClient(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch company profiles for all recent picks
  const uniqueTickers = [...new Set(data.todaysPicks.map((p) => p.ticker))];
  const profileResults = await Promise.allSettled(
    uniqueTickers.map(async (sym) => {
      const profile = await getStockProfile(sym);
      return [sym, profile] as const;
    })
  );
  const profiles: Record<string, ThesisCardProfile> = {};
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

  return (
    <DashboardClient
      data={data}
      recentRuns={recentRuns}
      userId={user?.id}
      profiles={profiles}
    />
  );
}
