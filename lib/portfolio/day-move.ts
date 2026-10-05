/**
 * What a position made or lost today, in dollars.
 *
 * The coverage row carries the day's move as a PERCENT only (`oneDayPct`), so
 * the mobile 1D tab could show "−0.03%" and nothing else while the All tab
 * next to it showed dollars and percent. On a phone those two tabs are the
 * whole table, so one of them was half a column.
 *
 * `oneDayPct` is computed from the previous close as
 * `((current − prevClose) / prevClose) × 100`, so this inverts it exactly
 * rather than approximating: prevClose = current ÷ (1 + pct/100), and the
 * move is shares × (current − prevClose). Both inputs come from the same
 * quote, so they cannot disagree.
 *
 * Null when there is nothing to say: a watched name holds no shares, and a
 * −100% move has no previous close to divide by.
 */
export function dayDollarMove(input: {
  shares: number | null;
  currentPrice: number | null;
  oneDayPct: number | null;
}): number | null {
  const { shares, currentPrice, oneDayPct } = input;
  if (shares == null || currentPrice == null || oneDayPct == null) return null;
  if (shares === 0) return null;
  const factor = 1 + oneDayPct / 100;
  if (factor === 0) return null;
  const prevClose = currentPrice / factor;
  return shares * (currentPrice - prevClose);
}
