/**
 * capacity.ts — "this analyst is full", as an input (DAV-292, DAV-286).
 *
 * The position limit is enforced where it always was, in place_trade. What
 * was missing is anyone being TOLD. 2026-09-18: the Secular Compounder held
 * 4 of 4. ETN's buy fired at 09:45, the tactical run confirmed it by its
 * setup, called place_trade and was blocked — a whole run to learn one
 * number. ISRG's buy had fired into the same wall on 09-16 and 09-17, and
 * the only trace was a sentence inside an update's rationale. The same
 * analyst carried six more priced buy plans it could not buy.
 *
 * Pure: no DB, no clock of its own. Nothing here refuses anything.
 */

export interface AnalystCapacity {
  /** Open positions plus buys waiting for approval — what place_trade counts. */
  open: number;
  /** The analyst's position limit; null = none set. */
  max: number | null;
  /** The stocks it holds, for "which one would it replace". */
  held: string[];
}

export function isFull(c: AnalystCapacity | null | undefined): boolean {
  return !!c && c.max != null && c.open >= c.max;
}

/** One line for the book section and the tactical kickoff. Null when no limit is set. */
export function capacityLine(c: AnalystCapacity | null | undefined): string | null {
  if (!c || c.max == null) return null;
  const free = Math.max(0, c.max - c.open);
  const held = c.held.length ? ` It holds ${c.held.map((t) => `$${t}`).join(", ")}.` : "";
  return isFull(c)
    ? `Positions: ${c.open} of ${c.max} — this analyst is FULL. place_trade will refuse any new buy until one closes.${held}`
    : `Positions: ${c.open} of ${c.max} — ${free} free.${held}`;
}

export interface BuyBlockedByFull {
  /** Plain words for the row: the limit, when the buy fired, and the question. */
  text: string;
  firedAt: string | null;
}

/** How long a fired buy stays "wants in" on a full analyst. */
export const FIRED_BUY_WANTS_IN_DAYS = 7;

/**
 * A watched stock whose buy fired recently (or is live now) while its
 * analyst is full. That is a portfolio decision — is this better than what
 * we hold? — and it belongs on the row, not buried in a rationale.
 */
export function buyBlockedByFull(
  row: {
    ticker: string;
    status: string | null;
    /** The stock's own buy trigger's last fire, ISO. */
    enterLastFiredAt?: string | null;
    /** True when the buy condition is true on the live price right now. */
    enterLiveNow?: boolean;
  },
  capacity: AnalystCapacity | null | undefined,
  now: Date,
): BuyBlockedByFull | null {
  if (row.status !== "WATCHING" || !isFull(capacity)) return null;
  const fired = row.enterLastFiredAt ? new Date(row.enterLastFiredAt) : null;
  const recent = fired != null && (now.getTime() - fired.getTime()) / 86_400_000 <= FIRED_BUY_WANTS_IN_DAYS;
  if (!recent && !row.enterLiveNow) return null;
  const c = capacity!;
  const when = recent ? `fired ${fired!.toISOString().slice(0, 10)}` : "is live now";
  return {
    firedAt: recent ? fired!.toISOString() : null,
    text: `$${row.ticker}'s buy ${when} and this analyst is full (${c.open} of ${c.max}${c.held.length ? `: ${c.held.map((t) => `$${t}`).join(", ")}` : ""}). This is a portfolio decision, not a quiet day: name which held stock $${row.ticker} would replace and why it is better, or write "full — waiting" on this row with the reason. Do not call place_trade for it while the analyst is full.`,
  };
}
