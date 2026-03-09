import DashboardClient from "@/components/dashboard/DashboardClient";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import { getRecentRunsForDashboard } from "@/lib/actions/analyst.actions";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const [data, recentRuns, supabase] = await Promise.all([
    getDashboardData(),
    getRecentRunsForDashboard(),
    createClient(),
  ]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return <DashboardClient data={data} recentRuns={recentRuns} userId={user?.id} />;
}
