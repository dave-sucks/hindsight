/**
 * The earnings calendar as a product surface — the same two Finnhub calls
 * the trigger evaluator makes, shaped for a person to read.
 *
 * Three readers, one source (docs/plans/MARKET_DATA.md §2):
 *   • the /earnings page      — a day's reporters with the numbers
 *   • the stock page / sheet  — one company: next report, last quarters
 *   • get_earnings_calendar   — the agent's view of the same rows
 *
 * Nothing here is stored. The vendor is the database; a local copy is a
 * second one that goes stale. Every function reads live through the shared
 * `finnhub()` client (5-minute cache, throttle, retries) and fails soft —
 * empty, never a throw — so a vendor miss leaves a page blank rather than
 * broken.
 */

import { finnhub } from "@/lib/agent/research-helpers";
import { getStockQuote } from "@/lib/actions/finnhub.actions";
import { getStockInfo } from "@/lib/actions/stock-info";
import { surprisePct } from "@/lib/agent/triggers/earnings";
import type { EarningsReport } from "@/lib/agent/triggers/earnings";

interface FinnhubCalendarRow {
  symbol?: string;
  date?: string;
  hour?: string | null;
  quarter?: number | null;
  year?: number | null;
  epsActual?: number | null;
  epsEstimate?: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** One calendar row → the shared report shape. Null when unusable. */
function normalize(row: FinnhubCalendarRow): EarningsReport | null {
  if (!row.symbol || !row.date) return null;
  const hasActual = row.epsActual != null && Number.isFinite(row.epsActual);
  return {
    symbol: row.symbol.toUpperCase(),
    reportDate: row.date,
    hour: row.hour ?? null,
    epsActual: hasActual ? (row.epsActual as number) : null,
    epsEstimate: row.epsEstimate ?? null,
    surprisePct: hasActual ? surprisePct(row.epsActual as number, row.epsEstimate) : null,
    revenueActual: row.revenueActual ?? null,
    revenueEstimate: row.revenueEstimate ?? null,
    quarter: row.quarter ?? null,
    year: row.year ?? null,
  };
}

/** Every calendar row in [from, to], normalized. Symbol-scoped when given. */
export async function fetchCalendarRows(opts: {
  from: string;
  to: string;
  symbol?: string;
}): Promise<EarningsReport[]> {
  const sym = opts.symbol ? `&symbol=${opts.symbol.toUpperCase()}` : "";
  const res = await finnhub(`/calendar/earnings?from=${opts.from}&to=${opts.to}${sym}`, 1);
  if (res.error || res.data == null) return [];
  const rows = (res.data as { earningsCalendar?: FinnhubCalendarRow[] }).earningsCalendar ?? [];
  return rows.map(normalize).filter((r): r is EarningsReport => r != null);
}

// ── The day view ────────────────────────────────────────────────────────────

/**
 * Which rows are worth a person's eye. The raw calendar is ~900 names a
 * week, mostly micro-caps with no analyst coverage. A row with no EPS and
 * no revenue estimate is one nobody on the street bothers to forecast —
 * skip it unless it's on the book, in which case it's ours regardless.
 */
export function isNotable(r: EarningsReport, covered: Set<string>): boolean {
  return covered.has(r.symbol) || r.epsEstimate != null || r.revenueEstimate != null;
}

/**
 * A "real company" for reading-order purposes: ≥ $100M of quarterly
 * revenue expected. The calendar carries no market cap; revenue is the
 * proxy. Below this, a one-cent EPS estimate turns any miss into a
 * "−194% surprise" that would outrank Oracle — verified on 2026-09-10.
 */
const REAL_COMPANY_REVENUE = 1e8;

/**
 * Reading order for a day: our names first; then real companies before
 * micro-caps; then the biggest surprise; then the biggest company.
 */
export function compareRows(covered: Set<string>) {
  return (a: EarningsReport, b: EarningsReport): number => {
    const ca = covered.has(a.symbol) ? 1 : 0;
    const cb = covered.has(b.symbol) ? 1 : 0;
    if (ca !== cb) return cb - ca;
    const ra = (a.revenueEstimate ?? 0) >= REAL_COMPANY_REVENUE ? 1 : 0;
    const rb = (b.revenueEstimate ?? 0) >= REAL_COMPANY_REVENUE ? 1 : 0;
    if (ra !== rb) return rb - ra;
    const sa = Math.abs(a.surprisePct ?? 0);
    const sb = Math.abs(b.surprisePct ?? 0);
    if (sa !== sb) return sb - sa;
    return (b.revenueEstimate ?? 0) - (a.revenueEstimate ?? 0);
  };
}

export interface EarningsDayRow extends EarningsReport {
  companyName: string | null;
  /** Live quote — price and the day's % move. Null when the vendor had none. */
  price: number | null;
  changePct: number | null;
  /** Analyst ids holding or watching this name. */
  analystIds: string[];
}

export interface EarningsDayView {
  date: string;
  /** Sun..Sat around `date`, each with how many notable reporters. */
  days: Array<{ date: string; count: number }>;
  rows: EarningsDayRow[];
}

/** The most rows we'll quote for one day — the throttle is 60/min. */
const MAX_QUOTED = 40;

/**
 * One day's reporters with the numbers, plus counts for the week around
 * it. One calendar call for the week; quotes and names only for the
 * selected day, capped.
 *
 * `coveredBy` maps ticker → analyst ids for the book, so the page can put
 * our names first and offer "send to agent" with the right analyst state.
 */
export async function getEarningsDay(opts: {
  date: string;
  coveredBy: Map<string, string[]>;
}): Promise<EarningsDayView> {
  const anchor = new Date(`${opts.date}T00:00:00Z`);
  // Week strip: Sunday through Saturday containing the date.
  const sunday = addDays(anchor, -anchor.getUTCDay());
  const from = isoDay(sunday);
  const to = isoDay(addDays(sunday, 6));
  const covered = new Set(opts.coveredBy.keys());

  const all = (await fetchCalendarRows({ from, to })).filter((r) => isNotable(r, covered));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = isoDay(addDays(sunday, i));
    return { date: d, count: all.filter((r) => r.reportDate === d).length };
  });

  const dayRows = all.filter((r) => r.reportDate === opts.date).sort(compareRows(covered));

  // Enrich the top of the list. Quotes and names are cached and coalesced
  // upstream; the cap keeps a busy Thursday inside the vendor throttle.
  const rows: EarningsDayRow[] = await Promise.all(
    dayRows.map(async (r, i) => {
      const [quote, info] =
        i < MAX_QUOTED
          ? await Promise.all([
              getStockQuote(r.symbol).catch(() => null),
              getStockInfo(r.symbol).catch(() => null),
            ])
          : [null, null];
      return {
        ...r,
        companyName: info?.companyName ?? null,
        price: quote?.c ?? null,
        changePct: typeof quote?.dp === "number" ? quote.dp : null,
        analystIds: opts.coveredBy.get(r.symbol) ?? [],
      };
    }),
  );

  return { date: opts.date, days, rows };
}

// ── One company ─────────────────────────────────────────────────────────────

export interface SymbolEarnings {
  /** Next scheduled report, if the calendar has one inside two quarters. */
  next: EarningsReport | null;
  /** Most recent report, with revenue — from the calendar, when it still carries it. */
  latest: EarningsReport | null;
  /** EPS history, newest first — Finnhub's own surprise figure. */
  recent: Array<{
    period: string;
    actual: number | null;
    estimate: number | null;
    surprisePct: number | null;
  }>;
}

interface HistoryRow {
  period?: string;
  actual?: number | null;
  estimate?: number | null;
  surprisePercent?: number | null;
}

/**
 * Next report, last report, and the EPS history for one ticker. Two calls:
 * the symbol-scoped calendar (past ~100 days through the next two
 * quarters — it carries revenue, which the history endpoint doesn't) and
 * the EPS history.
 */
export async function getEarningsForSymbol(ticker: string, now = new Date()): Promise<SymbolEarnings> {
  const T = ticker.toUpperCase();
  const today = isoDay(now);
  const [calendar, history] = await Promise.all([
    fetchCalendarRows({ symbol: T, from: isoDay(addDays(now, -100)), to: isoDay(addDays(now, 180)) }),
    finnhub(`/stock/earnings?symbol=${T}&limit=8`, 1),
  ]);

  const scheduled = calendar
    .filter((r) => r.epsActual == null && r.reportDate >= today)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const reported = calendar
    .filter((r) => r.epsActual != null)
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate));

  const recent = (Array.isArray(history.data) ? (history.data as HistoryRow[]) : [])
    .filter((r) => r.period)
    .map((r) => ({
      period: r.period as string,
      actual: r.actual ?? null,
      estimate: r.estimate ?? null,
      surprisePct:
        typeof r.surprisePercent === "number"
          ? r.surprisePercent
          : r.actual != null
            ? surprisePct(r.actual, r.estimate)
            : null,
    }));

  return { next: scheduled[0] ?? null, latest: reported[0] ?? null, recent };
}
