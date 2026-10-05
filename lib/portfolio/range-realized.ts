/**
 * What the account actually BOOKED inside the window the header is showing.
 *
 * ONE rule: the split is measured over the same window the headline number
 * came from, so it is handed that window's FIRST POINT — never a range name
 * and never a second clock of its own.
 *
 * That matters because the window is not always "the last N days". 1D is the
 * newest SESSION present in the data (a rolling 24 hours is empty on a Sunday
 * and drew a straight line), and a sparse curve can fall back to its last two
 * points. While the split read `now − N days` instead, the two disagreed every
 * trading morning: on the live book SRRK closed at 15:50 ET, so for the first
 * 6h20m of the next session its −$192.51 was counted as "sold" in a 1D total
 * that did not include the previous day at all — and `held`, which is the
 * remainder, absorbed it with the opposite sign. The gap is one window per
 * sale, as wide as the sale is late in the day.
 *
 * Summed from the closed trades, not taken as a delta off the realized curve.
 * That curve only carries a point on days when something closed, so
 * "last minus first inside the window" uses the first in-window sale as its
 * baseline and silently drops it: over one month on the live book that read
 * −$534.66 instead of −$1,336.84, missing PBH's −$802.18 exactly because it
 * was the earliest of the six sales in the window.
 */
export function realizedSince(
  trades: ReadonlyArray<{ closedAt?: string | null; pnl?: number | null }>,
  windowStart: string | null | undefined,
): number {
  if (!windowStart) return 0;
  // The window's baseline is the VALUE AT its first point, so a trade counts
  // only if it closed strictly after it. The comparison matches the curve's
  // own granularity: an ISO timestamp (the 15-minute series) is exact to the
  // minute, while a bare `YYYY-MM-DD` (the daily series) is that day's close,
  // so that day's own sales are already in the baseline. US market hours
  // (13:30–20:00Z) never straddle midnight UTC, so a close's UTC date is its
  // trading day.
  const startsAt = windowStart.includes("T")
    ? new Date(windowStart).getTime()
    : null;
  const startDay = windowStart.slice(0, 10);

  let sum = 0;
  for (const t of trades) {
    if (!t.closedAt) continue;
    const at = new Date(t.closedAt).getTime();
    if (!Number.isFinite(at)) continue;
    if (startsAt === null) {
      if (new Date(at).toISOString().slice(0, 10) <= startDay) continue;
    } else if (at <= startsAt) {
      continue;
    }
    sum += t.pnl ?? 0;
  }
  return sum;
}
