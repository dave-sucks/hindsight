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
  /**
   * Open positions PLUS buys awaiting approval — the same rows place_trade
   * counts (`status: { in: ["OPEN", "PENDING_APPROVAL"] }`). A queued buy has
   * committed its slot: counting only the open ones told the run there was
   * room for a name the tool would then refuse.
   */
  open: number;
  /** The analyst's position limit; null = none set. */
  max: number | null;
  /** The stocks it holds, for "which one would it replace". */
  held: string[];
  /** How many of `open` are buys still awaiting approval rather than held. */
  awaitingApproval?: number;
}

export function isFull(c: AnalystCapacity | null | undefined): boolean {
  return !!c && c.max != null && c.open >= c.max;
}

/** One line for the book section and the tactical kickoff. Null when no limit is set. */
export function capacityLine(c: AnalystCapacity | null | undefined): string | null {
  if (!c || c.max == null) return null;
  const free = Math.max(0, c.max - c.open);
  const queued = c.awaitingApproval ?? 0;
  const held = c.held.length ? ` It holds ${c.held.map((t) => `$${t}`).join(", ")}.` : "";
  // A queued buy has taken its slot even though nothing is held yet; say so,
  // or the line reads as though a slot is free that place_trade will refuse.
  const waiting = queued > 0 ? ` ${queued} buy${queued === 1 ? "" : "s"} awaiting your approval already took ${queued === 1 ? "a slot" : "slots"}.` : "";
  return isFull(c)
    ? `Positions: ${c.open} of ${c.max} — this analyst is FULL. place_trade will refuse any new buy until one closes.${held}${waiting}`
    : `Positions: ${c.open} of ${c.max} — ${free} free.${held}${waiting}`;
}
