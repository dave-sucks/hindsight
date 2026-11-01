/**
 * A stock's 1D / 5D / 30D move, in percent, from its daily closes. One
 * function so the dashboard table and /trades read the same numbers.
 *
 * Measured from the closes before the day the price belongs to: 1D from the
 * prior close, 5D from five sessions back, 30D from the last close on or
 * before 30 calendar days ago. During the session that day is today and
 * today's partial bar is dropped. Outside it the price is the last finished
 * session's close (lib/market-data/live-quote), so its day is that session's
 * — on a weekend, Friday — and 1D is Friday's move against Thursday, the
 * number the sheet header shows. Measured against "today" instead, a
 * Saturday read 0.00% on every row (2026-10-31).
 */

export interface WindowMoves {
  oneDayPct: number | null;
  fiveDayPct: number | null;
  thirtyDayPct: number | null;
}

export const NO_MOVES: WindowMoves = { oneDayPct: null, fiveDayPct: null, thirtyDayPct: null };

/** The New York date of an instant, "YYYY-MM-DD" — the day a bar or a price belongs to. */
export function todayEt(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

export function windowMoves(
  candles: { date: string; close: number }[],
  current: number,
  /** The New York date the price belongs to, "YYYY-MM-DD". */
  priceDay: string,
): WindowMoves {
  const d30 = new Date(`${priceDay}T00:00:00Z`);
  d30.setUTCDate(d30.getUTCDate() - 30);
  const target30 = d30.toISOString().slice(0, 10);

  const completed = candles.filter((c) => c.date < priceDay);
  const prevClose = completed[completed.length - 1]?.close ?? null;
  const close5 = completed[completed.length - 5]?.close ?? null;
  let close30: number | null = null;
  for (const c of completed) {
    if (c.date <= target30) close30 = c.close;
    else break;
  }
  const pct = (den: number | null) =>
    den != null && den !== 0 ? ((current - den) / den) * 100 : null;
  return { oneDayPct: pct(prevClose), fiveDayPct: pct(close5), thirtyDayPct: pct(close30) };
}
