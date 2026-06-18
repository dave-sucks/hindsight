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
 * Settlement-lag alignment. Alpaca records a deposit's CSD activity on its
 * transaction date, but the portfolio-history `equity` series only reflects the
 * cash once it settles (typically +1 business day). Because depositAdjustedPnlCurve
 * subtracts contributed-as-of-date from equity-as-of-date, on that one boundary
 * day the deposit is already in `contributed` but not yet in `equity` — producing
 * a spurious one-day dip of ~the deposit amount (the homepage chart's −$40k spike
 * that wrecks the auto-scale; see contributions.test.ts).
 *
 * This snaps each DEPOSIT forward to the equity-curve date where the cash actually
 * lands: the first date on or after the event date whose equity jumps by at least
 * half the deposit amount (deposits dwarf daily trading P&L, so a half-amount jump
 * is an unambiguous signal). A deposit already reflected on its own date matches
 * immediately and doesn't move; a deposit with no detectable jump (e.g. it settled
 * before the curve begins) keeps its original date. Withdrawals are left untouched.
 *
 * Net contributed total is UNCHANGED — only the per-date timing shifts — so the
 * `netContributedTotal` denominator and the curve's endpoints are unaffected.
 */
/** Deposits settle within a few business days; only look that far forward for
 *  the equity jump so a deposit can't be matched to a much-later, unrelated one. */
const MAX_SETTLEMENT_DAYS = 4;

function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export function alignFundingToEquity(
  equityCurve: { date: string; equity: number }[],
  events: FundingEvent[],
): FundingEvent[] {
  if (events.length === 0 || equityCurve.length === 0) return events;
  const curve = [...equityCurve].sort((a, b) => (a.date < b.date ? -1 : 1));
  return events.map((e) => {
    if (e.amount <= 0) return e; // withdrawals / zero — not the lag case
    const threshold = e.amount * 0.5;
    for (let i = 0; i < curve.length; i++) {
      if (curve[i].date < e.date) continue;
      // Stop once we're past the settlement window: a deposit dated before the
      // curve begins (already baked into the opening equity) or otherwise far
      // from any jump keeps its original date instead of snapping onto a later
      // deposit's jump.
      if (calendarDaysBetween(e.date, curve[i].date) > MAX_SETTLEMENT_DAYS) break;
      // prev defaults to the same point at i=0 so the curve's first positive
      // equity reading isn't mistaken for a jump from nothing.
      const prev = i > 0 ? curve[i - 1].equity : curve[i].equity;
      if (curve[i].equity - prev >= threshold) {
        return { ...e, date: curve[i].date };
      }
    }
    return e; // no settlement jump within the window → keep the original date
  });
}

/**
 * Deposit-adjusted P&L curve. For each equity point, subtract the capital
 * contributed on or before that date. The result is cumulative trading P&L
 * over time — it does NOT jump when money is deposited, because a deposit
 * raises both `equity` and `contributed` by the same amount on the same day.
 *
 * Funding events are first aligned to the equity curve (see
 * `alignFundingToEquity`) so a settlement lag between a deposit's transaction
 * date and the day Alpaca reflects it in equity can't produce a one-day spike.
 *
 * With no funding events the curve equals the raw equity curve (nothing to
 * strip) — which keeps paper accounts (no real transfers) unchanged.
 */
export function depositAdjustedPnlCurve(
  equityCurve: { date: string; equity: number }[],
  events: FundingEvent[],
): { date: string; value: number }[] {
  const points = cumulativeContributions(alignFundingToEquity(equityCurve, events));
  return equityCurve.map((p) => ({
    date: p.date,
    value: p.equity - contributedAsOf(points, p.date),
  }));
}
