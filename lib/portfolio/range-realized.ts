/**
 * What the account actually BOOKED inside a window.
 *
 * Summed from the closed trades, not taken as a delta off the realized curve.
 * That curve only carries a point on days when something closed, so
 * "last minus first inside the window" uses the first in-window sale as its
 * baseline and silently drops it: over one month on the live book that read
 * −$534.66 instead of −$1,336.84, missing PBH's −$802.18 exactly because it
 * was the earliest of the six sales in the window.
 */
export function realizedInWindow(
  trades: ReadonlyArray<{ closedAt?: string | null; pnl?: number | null }>,
  cutoffMs: number,
): number {
  let sum = 0;
  for (const t of trades) {
    if (!t.closedAt) continue;
    const at = new Date(t.closedAt).getTime();
    if (!Number.isFinite(at) || at < cutoffMs) continue;
    sum += t.pnl ?? 0;
  }
  return sum;
}
