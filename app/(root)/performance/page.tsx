import PerformancePage from "@/components/performance/PerformancePage";
import { getAnalyticsData } from "@/lib/actions/analytics.actions";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";

export default async function Performance() {
  const environment = await getCurrentEnvironment();
  const data = await getAnalyticsData(environment);
  return <PerformancePage data={data} />;
}
