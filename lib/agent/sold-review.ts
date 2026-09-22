/**
 * sold-review.ts — a stock we sold gets looked at once more (DAV-240).
 *
 * Dave's shape, 2026-09-22: *"post-selling, the stock should be reviewed in
 * the following daily run to decide what to do with it — keep watching, keep
 * watching with some triggers, etc."*
 *
 * So: a sale joins the next daily run's work list with the sale's own facts,
 * and the run answers with the verbs it already has. Keep watching with a
 * re-entry level; keep watching on a review cadence; keep watching with
 * nothing (legal, and it costs nothing); or let it go. Every one of those is
 * an ordinary `update_thesis` — no new predicate, no new quoting job, no
 * account-level "since sale" rules, and nothing here refuses anything.
 *
 * Why it is needed at all: a close only recycles a thesis back to WATCHING on
 * a TARGET exit or when the closing agent attested the belief survived
 * (`shouldRecycleToWatching`). Everything else goes terminal and is never
 * looked at again. 163 stocks have been sold; 9 have ever come back.
 *
 * SMMT is the case. Sold 2026-09-21 at $16.92 for +$1,157.94 (+17.9%) on a
 * protective stop, eight weeks before the November 14 PDUFA it was bought
 * for. Its catalyst is still ahead. Nothing watches it.
 *
 * Pure: the sale's own numbers, no DB, no clock beyond `now`.
 */

/**
 * How recently a sale has to be to still be this run's question. Also the
 * window `record_thesis` uses to chain a re-mint to its prior exit — one
 * definition of "recently sold", not two.
 */
export const RECENTLY_SOLD_WINDOW_DAYS = 14;

export interface SoldReview {
  /** Plain-language statement of the sale and the decision it owes. */
  text: string;
  /** YYYY-MM-DD of the exit. */
  soldOn: string;
  daysAgo: number;
}

const fmt = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const money = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function soldReview(input: {
  ticker: string;
  status: string;
  retiredReason: string | null;
  closedAt: Date | null;
  /** Why the sale happened — STOP, TARGET, MANUAL, … */
  closeReason: string | null;
  exitPrice: number | null;
  realizedPnl: number | null;
  realizedPnlPct: number | null;
  /** Did the closing agent attest the belief survived the exit? */
  beliefSurvived: boolean | null;
  /** The event the thesis was bought for, when it had one. */
  catalystDate: Date | null;
  /**
   * True once a run has answered — any UPDATED / REVIEWED / STATUS_CHANGED
   * row after the close. The close's own bookkeeping (CLOSED,
   * PROPOSAL_APPROVED) lands in the same second and is not an answer.
   */
  answered: boolean;
  now: Date;
  windowDays?: number;
}): SoldReview | null {
  if (input.status !== "RETIRED" || input.retiredReason !== "SOLD") return null;
  if (!input.closedAt || input.answered) return null;

  const ms = input.now.getTime() - input.closedAt.getTime();
  if (ms < 0) return null;
  const daysAgo = Math.floor(ms / 86_400_000);
  if (daysAgo > (input.windowDays ?? RECENTLY_SOLD_WINDOW_DAYS)) return null;

  const when = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
  const at = input.exitPrice != null ? ` at ${fmt(input.exitPrice)}` : "";
  const pnl =
    input.realizedPnl != null
      ? ` for ${money(input.realizedPnl)}${input.realizedPnlPct != null ? ` (${input.realizedPnlPct >= 0 ? "+" : "−"}${Math.abs(input.realizedPnlPct).toFixed(1)}%)` : ""}`
      : "";
  const why = input.closeReason ? ` on a ${input.closeReason.toLowerCase()}` : "";
  const belief =
    input.beliefSurvived === true
      ? " The closing agent said the belief survived the exit."
      : input.beliefSurvived === false
        ? " The closing agent said the belief was broken."
        : " Nobody said whether the belief survived the exit.";
  const catalyst =
    input.catalystDate && input.catalystDate.getTime() > input.now.getTime()
      ? ` Its catalyst is still ahead — ${input.catalystDate.toISOString().slice(0, 10)}.`
      : "";

  return {
    soldOn: input.closedAt.toISOString().slice(0, 10),
    daysAgo,
    text:
      `Sold ${when}${at}${pnl}${why}.${belief}${catalyst} ` +
      `This is the one look a sold stock gets, and it is yours: keep watching with a re-entry level priced off today's chart, ` +
      `keep watching on a review cadence, keep watching with nothing set (legal, and it costs nothing), or let it go. ` +
      `Put it back on watch with update_thesis(change_status: "WATCHING") plus whatever wakes it; ` +
      `say in one line why, either way. Answering it in any of those ways clears it.`,
  };
}
