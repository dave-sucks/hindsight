/**
 * What a watched (or passed) name is measured from: the price on the day the
 * watch started.
 *
 * The coverage table's last column answers "how has this done since I started
 * watching it" — the missed-opportunity column. It was reading `entryPrice`,
 * which is the PLANNED BUY LEVEL (a cache of the ENTER trigger), not a price
 * anyone observed. 22 of 28 watched names had none, because 21 of them carry
 * only REVIEW triggers — the analyst never named a buy — so the column was
 * blank on three-quarters of the watchlist.
 *
 * The real figure is already recorded: every `ThesisUpdate` stamps
 * `priceAtTime`, the price when that event happened. The Passed rows have
 * always used it. This is the same rule for the other two tabs.
 *
 * ONE rule, two sources, in this order:
 *
 *   1. The price stamped on the watch's FIRST DAY. That is a live quote
 *      someone actually saw, so it beats a daily bar.
 *   2. That day's close. Used when the ledger has no stamp from that day —
 *      either nothing was stamped at all (the soft-watch mint wrote a CREATED
 *      row with no price until this was fixed), or the first stamp came days
 *      later (EXEL: watched 2026-09-25, first priced event 2026-10-05, so its
 *      own ledger would anchor ten days late and understate the move).
 *
 * Deliberately NOT a stored column. The price is already on the ledger; a
 * second copy would need a backfill that reads the ledger anyway, and it would
 * freeze — a June price stored raw goes wrong after a split, while a daily bar
 * read back is split-adjusted and stays consistent with the price beside it.
 */
export function watchAnchorPrice(input: {
  /** The day the watch started, `YYYY-MM-DD`. */
  startedOn: string;
  /** The earliest ledger event carrying a price, if any. */
  stamped?: { on: string; price: number } | null;
  /** The daily close on `startedOn`, if the bar is available. */
  closeOnStart?: number | null;
}): number | null {
  const { startedOn, stamped, closeOnStart } = input;

  // 1 — stamped on the first day: what we actually saw.
  if (stamped && stamped.on.slice(0, 10) === startedOn.slice(0, 10) && isPrice(stamped.price)) {
    return stamped.price;
  }
  // 2 — that day's close.
  if (isPrice(closeOnStart)) return closeOnStart;
  // Nothing from the right day and no bar: a later stamp is still better than
  // an empty cell, and it is the only number on the ledger that is a price.
  if (stamped && isPrice(stamped.price)) return stamped.price;
  return null;
}

function isPrice(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n) && n > 0;
}
