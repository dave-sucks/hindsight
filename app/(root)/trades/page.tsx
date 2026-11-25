import TradesPage from "@/components/trades/TradesPage";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";
import { getStockCandles } from "@/lib/actions/finnhub.actions";
import { NO_MOVES, todayEt, windowMoves, type WindowMoves } from "@/lib/portfolio/window-moves";

export default async function Trades() {
  const environment = await getCurrentEnvironment();
  // Trades are what we own or owned: the held positions (newest first) and the
  // sold ones. A buy waiting for approval owns no shares, so it is not here; it
  // is on the dashboard's Proposals list. A held stock with a sale or add
  // waiting is a holding and carries that proposal on its row.
  const { openTrades: initialOpenTrades, closedTrades } = await getDashboardData(environment);

  // The 1D / 5D / 30D moves behind the window tabs — held names only; a sold
  // position has no shares riding on today's move. Each window is measured
  // from the closes before the day the price belongs to: today during the
  // session, the last finished session's (Friday, on a weekend) outside it.
  const held = new Map<string, { current: number; day: string }>();
  for (const t of initialOpenTrades) {
    if (held.has(t.ticker)) continue;
    held.set(t.ticker, { current: t.currentPrice, day: t.priceAsOf ? todayEt(new Date(t.priceAsOf)) : todayEt() });
  }
  const moves: Record<string, WindowMoves> = {};
  await Promise.all(
    [...held].map(async ([ticker, { current, day }]) => {
      const candles = await getStockCandles(ticker, 45).catch(() => []);
      moves[ticker] = current > 0 ? windowMoves(candles, current, day) : NO_MOVES;
    }),
  );

  return (
    <>
      <LiveRefresh />
      <TradesPage
        initialOpenTrades={initialOpenTrades}
        initialClosedTrades={closedTrades}
        moves={moves}
      />
    </>
  );
}
