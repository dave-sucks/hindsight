/**
 * Pure label formatters for StockPriceChart. In their own module (no React,
 * no recharts imports) so they can be unit-tested — the chart itself can't
 * be imported under jest's node environment.
 *
 * Every formatter here MUST be total over `unknown`: recharts types its
 * tick/label formatters loosely and, in transient frames (an active tooltip
 * surviving a range switch while the data array is swapped underneath it),
 * can pass the numeric index instead of the category value. That number
 * crashed the whole trade page behind the app error boundary on 2026-08-19
 * ("e.includes is not a function" — first 1W click). A label is never worth
 * the page: render nothing for a frame, and log loudly so the feeding path
 * is identifiable if it happens again.
 */

// Tolerates both a plain YYYY-MM-DD (daily bars) and a full ISO timestamp
// (hourly bars, whose `date` carries the hour) — both render as a date label.
export function formatDateLabel(dateStr: unknown): string {
  if (typeof dateStr !== 'string') {
    console.warn('[StockPriceChart] formatDateLabel got non-string tick', dateStr);
    return '';
  }
  const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Hourly tooltip: date + time-of-day in ET (the bar's `date` is a UTC ISO).
export function formatDateTimeLabel(v: string | number): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Intraday candles carry a full ISO timestamp in `date`; label them as ET
// time-of-day (e.g. "9:35 AM") instead of a calendar date.
export function formatTimeLabel(v: string | number): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The change a range shows: the last visible price against what the range is
 * measured from — yesterday's close on 1D (what the header's day change reads
 * from), the first visible point on every other range. Null when there is
 * nothing to measure against, never a made-up zero.
 */
export function rangeChange(
  closes: number[],
  from: number | null | undefined,
): { dollars: number; pct: number } | null {
  if (closes.length === 0) return null;
  const base = from != null && from > 0 ? from : closes[0];
  const last = closes[closes.length - 1];
  if (!(base > 0) || !Number.isFinite(last)) return null;
  return { dollars: last - base, pct: ((last - base) / base) * 100 };
}

export function formatRangeChange(change: { dollars: number; pct: number }): string {
  const sign = change.dollars >= 0 ? '+' : '−';
  const abs = Math.abs(change.dollars).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${abs} (${sign}${Math.abs(change.pct).toFixed(2)}%)`;
}

/**
 * Where the green/red split sits, as a fraction of the plot band from the top
 * (0) to the bottom (1). The gradient is drawn in the plot's own pixels, so
 * this is the price scale's own arithmetic; a baseline outside the visible
 * range pins to an edge, so a gap day reads all green or all red.
 */
export function splitOffset(yLo: number, yHi: number, baseline: number): number {
  const span = yHi - yLo || 1;
  return Math.min(0.999, Math.max(0.001, (yHi - baseline) / span));
}
