import DashboardClient from "@/components/dashboard/DashboardClient";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const [data, supabase] = await Promise.all([
    getDashboardData(),
    createClient(),
  ]);
  const { data: { user } } = await supabase.auth.getUser();
  return <DashboardClient data={data} userId={user?.id} />;
}
