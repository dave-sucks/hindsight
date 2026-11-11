/**
 * sale-queue.ts — each sale waiting for the principal's approval, as one line
 * written by code: how many times a sale has been proposed since the position
 * opened, the first time, the move since then, and the verdict on the thesis
 * in the note the run wrote with this proposal.
 *
 * Why: a floor that has been crossed proposes a sale every day it stays
 * crossed, and most of those proposals expire unanswered (NVDA: 27 proposed
 * from Sep 14 to Nov 10, 23 expired). While a sale waits the stock is quiet on
 * its analyst's list, so this queue is the one place the whole of it shows.
 * Every agent reads it in the Market and portfolio block, and the Portfolio
 * Reviewer's digest opens with it.
 *
 * The note's stance on the sale is not stored, so it is not guessed. The
 * thesis verdict the run saved with the note is (STRONGER, UNCHANGED, WEAKER,
 * BROKEN), and the line prints that.
 *
 * Pure. The loader is load-sale-queue.ts.
 */

export interface WaitingSale {
  ticker: string;
  /** A sale (CLOSE) or a trim (PARTIAL_CLOSE). */
  kind: "sell" | "trim";
  /** Sales of this kind proposed on the position since it opened, this one included. */
  times: number;
  /** When the first was proposed (ISO). */
  firstAt: string;
  /** The move since the first proposal, in %, when both prices are known. */
  movePct: number | null;
  /** The thesis verdict in the note on this proposal, when it has one. */
  verdict: string | null;
  /**
   * What the owner decides on, loaded for the Portfolio Reviewer only: the
   * floor that fired (the EXIT trigger's fire just before this proposal), its
   * level when it is a price, when and at what price it fired, and the note
   * the run wrote with this proposal, in full.
   */
  decision?: { floor: string | null; level: number | null; firedAt: string; firedPrice: number | null; note: string | null } | null;
}

const VERDICT_WORDS: Record<string, string> = { STRONGER: "case stronger", UNCHANGED: "case unchanged", WEAKER: "case weaker", BROKEN: "case broken" };
const MINUS = "−";
const monthDay = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(iso));

/** "proposed 27 times since Sep 14, −19.5% since; its note: case broken". */
export function saleHistory(s: WaitingSale): string {
  const times = s.times > 1 ? `proposed ${s.times} times since ${monthDay(s.firstAt)}` : `proposed once, on ${monthDay(s.firstAt)}`;
  const move = s.movePct != null ? `, ${s.movePct < 0 ? MINUS : "+"}${Math.abs(s.movePct).toFixed(1)}% since` : "";
  const note = s.verdict && VERDICT_WORDS[s.verdict] ? `; its note: ${VERDICT_WORDS[s.verdict]}` : "";
  return `${times}${move}${note}`;
}

/** "NVDA: proposed 27 times since Sep 14, −19.5% since; its note: case broken". */
export function waitingSaleLine(s: WaitingSale): string {
  return `${s.kind === "trim" ? `${s.ticker} (trim)` : s.ticker}: ${saleHistory(s)}`;
}

/** The queue under its heading, oldest first, or nothing when no sale waits. */
export function saleQueueLines(sales: readonly WaitingSale[]): string[] {
  return sales.length ? ["Sales waiting for approval:", ...sales.map((s) => `- ${waitingSaleLine(s)}`)] : [];
}
