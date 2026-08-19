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
