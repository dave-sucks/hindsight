/**
 * Reported-earnings lookup for the trigger evaluator.
 *
 * EARNINGS_BEAT / EARNINGS_MISS were written against the signal router:
 * a producer had to summarise a report into a Signal row and stamp
 * `surprisePct` onto its dataPayload, the router had to route that row to
 * the analyst, and only then could the predicate read the number. Every
 * step of that chain is currently down — routing has been paused since
 * 2026-05-31, and of the 138 EARNINGS signals ingested in the 30 days to
 * 2026-09-02 (all from inbound email, none from a market-data job) exactly
 * zero carried a surprise figure. 57 earnings triggers across 30 names have
 * never fired once.
 *
 * None of that chain is necessary. Beat/miss is arithmetic against a
 * published calendar: Finnhub's /calendar/earnings returns `epsActual`
 * alongside `epsEstimate` once a company reports, and the whole firm's
 * recent reports come back in ONE call (~18KB for a 3-day window). So the
 * evaluator reads earnings the same way it already reads quotes — fetch,
 * compute, done — instead of waiting on a news pipeline. See
 * docs/plans/EARNINGS_AND_MOVERS.md §2.
 *
 * This does NOT replace the signal path in evaluate.ts. If routing ever
 * returns, a signal carrying a surprise still fires these predicates; the
 * calendar is simply the source that works today, and it is preferred when
 * both are present because it is arithmetic rather than a summariser's
 * recollection of one.
 */

import { finnhub } from "@/lib/agent/research-helpers";

/** One company's most recent reported quarter, as the calendar has it. */
export interface EarningsReport {
  symbol: string;
  /** Report date, YYYY-MM-DD. Finnhub's calendar `date`. */
  reportDate: string;
  /** "bmo" | "amc" | "" — before open / after close, when known. */
  hour: string | null;
  epsActual: number;
  epsEstimate: number | null;
  /**
   * (actual − estimate) ÷ |estimate| × 100. Positive = beat, negative =
   * miss. Null when the estimate is missing or zero, which makes a
   * surprise percentage undefined — the predicates then return false
   * rather than guessing.
   */
  surprisePct: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  quarter: number | null;
  year: number | null;
}

/**
 * How far back to look for reports.
 *
 * THIS VALUE IS LOAD-BEARING FOR DE-DUPLICATION. A report stays visible in
 * the window for its whole length, so the same quarter is a match on every
 * evaluation pass inside it. What stops a re-fire is the per-trigger
 * cooldown, which is 7 days for both earnings kinds (the code default in
 * ./defaults, and the stored value on 56 of the 57 live earnings triggers).
 * Window < cooldown ⇒ at most one fire per report; cooldown ≪ a quarter ⇒
 * the next report still fires. Keep this comfortably under 7 if you change
 * it, and don't raise it without re-checking the stored cooldowns.
 *
 * 3 rather than 1 so a Friday after-close report is still caught when the
 * market next opens on Monday.
 */
export const EARNINGS_LOOKBACK_DAYS = 3;

/**
 * The surprise percentage, or null when it isn't defined.
 *
 * `|estimate|` in the denominator so a company expected to lose money gets
 * the right sign: an estimate of −$0.26 against an actual of −$0.20 is a
 * beat (+22%), not a miss. Matches Finnhub's own `surprisePercent` on the
 * /stock/earnings endpoint — verified against NVDA 2026-08-26 (est 2.1384,
 * actual 2.22 → 3.8159% both ways).
 *
 * A zero estimate has no meaningful percentage, so it returns null rather
 * than Infinity. A predicate with no `minSurprisePct` would otherwise fire
 * on a number that means nothing.
 */
export function surprisePct(
  actual: number,
  estimate: number | null | undefined,
): number | null {
  if (estimate == null || !Number.isFinite(estimate) || estimate === 0) return null;
  if (!Number.isFinite(actual)) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

/** $96.22B / $383.98M / $52.38M — revenue at a readable scale. */
function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toFixed(0)}`;
}

/**
 * One sentence of the actual numbers, for the audit row and the tactical
 * agent's kickoff message.
 *
 *   "Reported 2026-08-26 (after close): EPS $2.22 vs $2.14 est — beat by
 *    3.8%. Revenue $96.22B vs $94.01B est."
 *
 * This is the INPUT half of the work, and it is the half that decides
 * whether the fire is useful. 56 of the 57 live earnings triggers are
 * REVIEW: they write an audit row and the next morning's run reads it. A
 * row that says only "Earnings miss" makes the analyst go and fetch what
 * everyone already knows; a row carrying the figures lets it decide.
 */
export function describeEarningsReport(r: EarningsReport): string {
  const when =
    r.hour === "bmo"
      ? " (before open)"
      : r.hour === "amc"
        ? " (after close)"
        : "";
  const parts = [`Reported ${r.reportDate}${when}: EPS $${r.epsActual.toFixed(2)}`];

  if (r.epsEstimate != null) parts.push(` vs $${r.epsEstimate.toFixed(2)} est`);
  if (r.surprisePct != null) {
    const verb = r.surprisePct >= 0 ? "beat" : "missed";
    parts.push(` — ${verb} by ${Math.abs(r.surprisePct).toFixed(1)}%`);
  }
  parts.push(".");

  if (r.revenueActual != null) {
    parts.push(` Revenue ${money(r.revenueActual)}`);
    if (r.revenueEstimate != null) parts.push(` vs ${money(r.revenueEstimate)} est`);
    parts.push(".");
  }

  return parts.join("");
}

/** YYYY-MM-DD for a Date, in UTC — the calendar's own date format. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

/**
 * Every company that reported in the last `lookbackDays`, keyed by ticker.
 *
 * ONE firm-wide call — deliberately not one per ticker. The window is short
 * enough that the whole market's reports are ~110 rows / 18KB, which is
 * cheaper than fanning out over the 30-odd names we cover and stays cheap
 * as the book grows.
 *
 * `epsActual != null` is the "has reported" test: the calendar carries the
 * estimate for scheduled quarters and fills the actual in afterwards
 * (verified — NVDA's 2026-11-17 row has a null actual, its 2026-08-26 row
 * does not).
 *
 * Never throws. A vendor failure returns an empty map and logs; the caller
 * carries on with price triggers. A dropped call must delay a look, never
 * block a stop.
 */
export async function fetchRecentEarningsReports(opts: {
  now: Date;
  lookbackDays?: number;
}): Promise<Map<string, EarningsReport>> {
  const out = new Map<string, EarningsReport>();

  const lookback = opts.lookbackDays ?? EARNINGS_LOOKBACK_DAYS;
  const to = isoDay(opts.now);
  const from = isoDay(new Date(opts.now.getTime() - lookback * 86_400_000));
  const path = `/calendar/earnings?from=${from}&to=${to}`;

  // Through the shared client, like every other Finnhub call — it owns the
  // 60/min throttle, the 429 backoff, the retry, and the call counter. The
  // evaluator fans out over up to 200 quotes on the same tick, so an
  // unthrottled extra call is exactly the one that trips the rate limit.
  //
  // The helper gives this path its 5-minute cache rather than the 30-second
  // quote TTL, which is right: a filed report doesn't change, and the
  // evaluator runs every 5 minutes anyway, so the cache costs at most one
  // tick's delay in noticing a print that landed outside market hours. This
  // is NOT the stale-quote trap in CLAUDE.md — that one bites single-fetch
  // surfaces served an arbitrarily old value; this surface is polled, so
  // every window boundary refreshes it.
  //
  // `finnhub()` resolves rather than throws on failure. Empty map + a log,
  // and the caller carries on with price triggers: a dropped call must delay
  // a look, never block a stop.
  const res = await finnhub(path, 1);
  if (res.error || res.data == null) {
    console.warn(
      `[earnings] calendar ${from}→${to} unavailable (${res.error ?? "no data"}); skipping earnings evaluation this pass`,
    );
    return out;
  }
  const rows =
    (res.data as { earningsCalendar?: FinnhubCalendarRow[] }).earningsCalendar ??
    [];

  for (const row of rows) {
    if (!row.symbol || !row.date) continue;
    if (row.epsActual == null || !Number.isFinite(row.epsActual)) continue;

    const symbol = row.symbol.toUpperCase();
    const report: EarningsReport = {
      symbol,
      reportDate: row.date,
      hour: row.hour ?? null,
      epsActual: row.epsActual,
      epsEstimate: row.epsEstimate ?? null,
      surprisePct: surprisePct(row.epsActual, row.epsEstimate),
      revenueActual: row.revenueActual ?? null,
      revenueEstimate: row.revenueEstimate ?? null,
      quarter: row.quarter ?? null,
      year: row.year ?? null,
    };

    // A ticker can't report twice in three days, but the calendar has been
    // known to carry a duplicate row; keep the later date.
    const existing = out.get(symbol);
    if (existing && existing.reportDate >= report.reportDate) continue;
    out.set(symbol, report);
  }

  return out;
}
