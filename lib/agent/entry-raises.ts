/**
 * entry-raises.ts — a buy level moved away from the price is a decision
 * nobody made (DAV-253, playbook E6).
 *
 * MSFT's buy fired on 07-31, 08-03, 08-04, 08-05, 08-10 and 08-28; six
 * "triggers updated", zero buys, the level raised each time. A fired buy
 * has two honest answers — buy it, or set the plan down with the reason.
 * "Retune" survives only as a re-priced condition that cites structure from
 * the chart (a new pivot, a new pullback level). A raise with no structure
 * cited is not refused anywhere; it arrives the next morning as the
 * ENTRY_RAISED_AWAY plan-sanity flag with the count, so the pattern is loud.
 *
 * Pure: reads the thesis's own audit rows (fieldChanges.entryPrice with the
 * price at the time and the rationale). No DB, no clock beyond `now`.
 */

export interface EntryRaiseAway {
  /** YYYY-MM-DD of the edit. */
  date: string;
  from: number | null;
  to: number;
  /** The live price when the level was moved. */
  price: number;
}

export const ENTRY_RAISE_WINDOW_DAYS = 30;

/**
 * Words that mean the new level was priced off the chart rather than moved
 * to avoid the buy. Deliberately the chart's own vocabulary; "structurally
 * higher" does not count — that is a story, not a level.
 */
const STRUCTURE_WORDS =
  /\b(pivot|base|breakout|swing|handle|resistance|support|prior[- ]day high|prior high|52-week|\d{1,3}-day|moving average|sma|ema|atr|gap-day|retracement|fib)\b/i;

export function citesStructure(rationale: string | null | undefined): boolean {
  return !!rationale && STRUCTURE_WORDS.test(rationale);
}

export function entryRaisesAway(input: {
  direction: string | null;
  updates: Array<{
    type: string;
    timestamp: Date;
    priceAtTime: number | null;
    rationale: string | null;
    fieldChanges: unknown;
  }>;
  now: Date;
  windowDays?: number;
}): EntryRaiseAway[] {
  const isLong = input.direction !== "SHORT";
  const since = input.now.getTime() - (input.windowDays ?? ENTRY_RAISE_WINDOW_DAYS) * 86_400_000;
  const out: EntryRaiseAway[] = [];
  for (const u of input.updates) {
    if (u.type !== "UPDATED" || u.timestamp.getTime() < since) continue;
    const fc = u.fieldChanges as { entryPrice?: { from?: unknown; to?: unknown } } | null | undefined;
    const to = fc?.entryPrice?.to;
    const from = fc?.entryPrice?.from;
    if (typeof to !== "number" || to <= 0) continue;
    const price = u.priceAtTime;
    if (typeof price !== "number" || price <= 0) continue;
    // Moved AWAY from the price: a LONG level raised above the tape, a SHORT
    // level lowered below it. A level moved toward the price is the opposite
    // of avoiding the buy.
    const away = isLong ? to > price && (typeof from !== "number" || to > from) : to < price && (typeof from !== "number" || to < from);
    if (!away) continue;
    if (citesStructure(u.rationale)) continue;
    out.push({
      date: u.timestamp.toISOString().slice(0, 10),
      from: typeof from === "number" ? from : null,
      to,
      price,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
