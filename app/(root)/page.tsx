import DashboardClient from "@/components/dashboard/DashboardClient";
import { getDashboardData } from "@/lib/actions/portfolio.actions";

export default async function Home() {
  const data = await getDashboardData();
  return <DashboardClient data={data} />;
}
