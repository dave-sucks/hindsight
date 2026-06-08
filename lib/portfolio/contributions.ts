/**
 * contributions.ts — net contributed capital + deposit-adjusted P&L.
 *
 * Alpaca's `equity` and `/v2/account/portfolio/history` blend external cash
 * flows (deposits / withdrawals) straight into the equity number. So funding
 * the account reads as an investment gain — the homepage "+1015%" cliff the
 * moment $80k lands. This module strips external cash flows back out so
 * reported P&L is pure trading performance:
 *
 *   net contributed capital (cost basis) = Σ deposits − Σ withdrawals
 *   true P&L(t)                          = equity(t) − cumulativeContributed(t)
 *
 * Funding events come from the Alpaca account-activities endpoint
 * (CSD = cash deposit, CSW = cash withdrawal) — see `getFundingActivities`
 * in `lib/alpaca.ts`. Everything here is pure so it can be unit-tested
 * without touching Alpaca.
 */

/** A single external cash flow. Deposits are positive, withdrawals negative. */
export interface FundingEvent {
  /** YYYY-MM-DD — the activity's settlement/transaction date. */
  date: string;
  /** Signed dollars: + for a deposit (CSD), − for a withdrawal (CSW). */
  amount: number;
}

/** Total net contributed capital across all funding events. */
export function netContributedTotal(events: FundingEvent[]): number {
  return events.reduce((sum, e) => sum + e.amount, 0);
}

export interface ContributionPoint {
  date: string; // YYYY-MM-DD
  cumulative: number; // net contributed capital as of (and including) this date
}

/**
 * Collapse funding events into one cumulative point per date, ascending.
 * Same-day events are summed before the running total advances.
 */
export function cumulativeContributions(events: FundingEvent[]): ContributionPoint[] {
  const byDate = new Map<string, number>();
  for (const e of events) {
    byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.amount);
  }
  const dates = [...byDate.keys()].sort();
  let running = 0;
  return dates.map((date) => {
    running += byDate.get(date)!;
    return { date, cumulative: running };
  });
}

/**
 * Net contributed capital as of `date` (inclusive): the cumulative total of
 * the most recent contribution on or before `date`. Returns 0 for any date
 * before the first contribution. `points` must be ascending by date (as
 * returned by `cumulativeContributions`). ISO YYYY-MM-DD strings compare
 * lexicographically, so plain `<=` is a correct date comparison here.
 */
export function contributedAsOf(points: ContributionPoint[], date: string): number {
  let result = 0;
  for (const p of points) {
    if (p.date <= date) result = p.cumulative;
    else break;
  }
  return result;
}

/**
 * Deposit-adjusted P&L curve. For each equity point, subtract the capital
 * contributed on or before that date. The result is cumulative trading P&L
 * over time — it does NOT jump when money is deposited, because a deposit
 * raises both `equity` and `contributed` by the same amount on the same day.
 *
 * With no funding events the curve equals the raw equity curve (nothing to
 * strip) — which keeps paper accounts (no real transfers) unchanged.
 */
export function depositAdjustedPnlCurve(
  equityCurve: { date: string; equity: number }[],
  events: FundingEvent[],
): { date: string; value: number }[] {
  const points = cumulativeContributions(events);
  return equityCurve.map((p) => ({
    date: p.date,
    value: p.equity - contributedAsOf(points, p.date),
  }));
}
