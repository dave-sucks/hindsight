/**
 * Does this window reach back to the account's first day?
 *
 * It matters because a whole-account window's P&L is the identity the digest
 * uses — equity − net contributed — and NOT "curve today minus curve on day
 * one". The curve's first point is only zero if every opening dollar has a
 * matching deposit record on or before it, and on the live book it is
 * −$40,000: the history starts 2026-05-15 with $8,000 of equity while
 * $48,000 of deposits had already landed by that date.
 *
 * The window must be measured against the FULL-HISTORY curve, never against
 * whichever curve is being drawn. 1D and 1W draw a 15-minute series that only
 * reaches back a week, so "the window covers the whole curve" became true for
 * 1W the moment intraday shipped — and 1W reported the all-time number
 * (+$6,242.51 instead of +$1,438.09).
 */
export function windowReachesInception(
  windowPoints: ReadonlyArray<{ date: string }>,
  fullHistory: ReadonlyArray<{ date: string }>,
): boolean {
  if (windowPoints.length === 0 || fullHistory.length === 0) return false;
  return windowPoints[0].date.slice(0, 10) <= fullHistory[0].date.slice(0, 10);
}
