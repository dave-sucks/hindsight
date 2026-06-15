import TradesPage from "@/components/trades/TradesPage";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";

export default async function Trades() {
  const environment = await getCurrentEnvironment();
  const { openTrades, pendingTrades, closedTrades } = await getDashboardData(environment);
  // The Trades page shows held positions and pending buy proposals together
  // (its own All / Open / Closed tabs filter by trade status). getDashboardData
  // now returns them split, so recombine here — sorted newest-first to match the
  // prior single-query order — keeping this page's behavior unchanged.
  const initialOpenTrades = [...openTrades, ...pendingTrades].sort(
    (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
  );
  return <TradesPage initialOpenTrades={initialOpenTrades} initialClosedTrades={closedTrades} />;
}
