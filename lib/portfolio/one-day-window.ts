/**
 * The 1D window: from the PREVIOUS SESSION'S CLOSE to now.
 *
 * Not "the points stamped today". Alpaca's intraday series starts at 09:30,
 * so a window of today's points alone measures from the OPEN and drops the
 * overnight gap — while every per-stock 1D on the same screen is measured
 * against the previous close (`(current − prevClose) / prevClose`). The two
 * disagreed by the whole gap.
 *
 * On 2026-10-06 that was $1,081.14 of it, mostly CEG gapping +10.88%: the
 * header read −$423.41 while the book was up. Alpaca's own number for the day
 * (equity − last_equity) was +$651.40, and measuring from the prior close
 * gives +$706.90 — the same side of zero, within the resolution of a
 * 15-minute series whose last point is the 16:00 bar.
 *
 * Returning the prior close as the window's FIRST POINT is what makes the
 * header and the chart agree: the line starts where the day started, which is
 * also how a broker draws it, and the header delta is last − that point.
 *
 * Falls back to the whole newest session when there is no earlier day in the
 * series (a brand-new account, or the first session the vendor returns).
 */
export function oneDayWindow<T extends { date: string }>(
  points: ReadonlyArray<T>,
): T[] {
  if (points.length === 0) return [];
  const newestDay = points[points.length - 1].date.slice(0, 10);
  let firstOfToday = points.length - 1;
  while (firstOfToday > 0 && points[firstOfToday - 1].date.slice(0, 10) === newestDay) {
    firstOfToday--;
  }
  // The point before today's first IS the previous session's close.
  const start = firstOfToday > 0 ? firstOfToday - 1 : 0;
  return points.slice(start);
}
