/**
 * A stock's 1D / 5D / 30D move, in percent, from its daily closes. One
 * function so the dashboard table and /trades read the same numbers.
 *
 * Measured from the last COMPLETED close (today's partial bar is dropped):
 * 1D from the prior close, 5D from five completed sessions back, 30D from the
 * last close on or before 30 calendar days ago.
 */

export interface WindowMoves {
  oneDayPct: number | null;
  fiveDayPct: number | null;
  thirtyDayPct: number | null;
}

export const NO_MOVES: WindowMoves = { oneDayPct: null, fiveDayPct: null, thirtyDayPct: null };

/** Today's date in New York, "YYYY-MM-DD" — the day a bar belongs to. */
export function todayEt(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

export function windowMoves(
  candles: { date: string; close: number }[],
  current: number,
  today: string,
): WindowMoves {
  const d30 = new Date(`${today}T00:00:00Z`);
  d30.setUTCDate(d30.getUTCDate() - 30);
  const target30 = d30.toISOString().slice(0, 10);

  const completed = candles.filter((c) => c.date < today);
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
