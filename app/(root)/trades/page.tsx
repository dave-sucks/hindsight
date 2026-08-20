import TradesPage from "@/components/trades/TradesPage";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";
import type { MockTrade } from "@/lib/mock-data/trades";

export default async function Trades() {
  const environment = await getCurrentEnvironment();
  const { openTrades, pendingTrades, closedTrades } = await getDashboardData(environment);

  // getDashboardData returns two DELIBERATELY overlapping lists: a held name
  // with an outstanding close/trim/add is in BOTH `openTrades` (still held, so
  // it feeds P&L) and `pendingTrades` (it needs a decision). The dashboard
  // renders those as two separate surfaces, so the overlap is invisible there.
  //
  // This page merges them into ONE list, which turned the overlap into the same
  // Position.id twice — i.e. duplicate React keys in the table. That breaks list
  // reconciliation: stale rows accumulate in the DOM on every tab switch and
  // survive into tabs whose filter they don't match (a held name showing up
  // under Won AND Lost), while the "Showing N of M" counter keeps reporting the
  // correct, smaller `filtered.length`.
  //
  // Dedupe by id, first occurrence wins. Nothing is lost: the held entry already
  // carries `pendingProposal`, so its Review control still renders — the second
  // list only contributes genuinely-new buys (PENDING_APPROVAL positions, which
  // are absent from `openTrades`).
  const byId = new Map<string, MockTrade>();
  for (const t of [...openTrades, ...pendingTrades]) {
    if (!byId.has(t.id)) byId.set(t.id, t);
  }
  const initialOpenTrades = [...byId.values()].sort(
    (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
  );

  return <TradesPage initialOpenTrades={initialOpenTrades} initialClosedTrades={closedTrades} />;
}
