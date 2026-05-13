import { getAnalystList } from "@/lib/actions/analyst.actions";
import AnalystsPageClient from "@/components/analysts/AnalystsPageClient";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";

export default async function AnalystsPage() {
  const environment = await getCurrentEnvironment();
  const analysts = await getAnalystList(environment);
  return <AnalystsPageClient analysts={analysts} />;
}
