import TradesPage from "@/components/trades/TradesPage";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";

export default async function Trades() {
  const environment = await getCurrentEnvironment();
  const { openTrades, closedTrades } = await getDashboardData(environment);
  return <TradesPage initialOpenTrades={openTrades} initialClosedTrades={closedTrades} />;
}
