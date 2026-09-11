import PerformancePage from "@/components/performance/PerformancePage";
import { getAnalyticsData } from "@/lib/actions/analytics.actions";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";
import { getSetupScorecard } from "@/lib/performance/load-setup-scorecard";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";

export default async function Performance() {
  const environment = await getCurrentEnvironment();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const accountId = user?.id ? await getAccountId(user.id) : null;
  const [data, scorecard] = await Promise.all([
    getAnalyticsData(environment),
    accountId ? getSetupScorecard(accountId, environment).catch(() => []) : Promise.resolve([]),
  ]);
  return <PerformancePage data={data} scorecard={scorecard} />;
}
