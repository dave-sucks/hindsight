import { etDateOf, etMinutesOf } from "@/lib/market-data/intraday-window";

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
 * Since the series carries pre-market and after-hours points (2026-11-08),
 * the previous session's close is its last point AT OR BEFORE 16:00 ET, not
 * its last point of the evening — the same close every stock's 1D measures
 * from, and the figure Alpaca calls last_equity.
 *
 * Falls back to the whole newest session when there is no earlier day in the
 * series (a brand-new account, or the first session the vendor returns).
 */
const CLOSE_MINUTES = 16 * 60;

/** The New York date a point belongs to: an after-hours print at 20:00 ET is the next day in UTC, still today here. A daily key is its own day. */
function dayOf(date: string): string {
  return date.includes("T") ? etDateOf(date) : date.slice(0, 10);
}

export function oneDayWindow<T extends { date: string }>(
  points: ReadonlyArray<T>,
): T[] {
  if (points.length === 0) return [];
  const newestDay = dayOf(points[points.length - 1].date);
  let firstOfToday = points.length - 1;
  while (firstOfToday > 0 && dayOf(points[firstOfToday - 1].date) === newestDay) {
    firstOfToday--;
  }
  if (firstOfToday === 0) return points.slice();
  // The previous session's close: its last point at or before 16:00 ET, or
  // its last point at all when none is (a daily series, or a short one).
  const priorDay = dayOf(points[firstOfToday - 1].date);
  let close = firstOfToday - 1;
  for (let i = firstOfToday - 1; i >= 0 && dayOf(points[i].date) === priorDay; i--) {
    if (!points[i].date.includes("T") || etMinutesOf(points[i].date) <= CLOSE_MINUTES) {
      close = i;
      break;
    }
  }
  return [points[close], ...points.slice(firstOfToday)];
}
