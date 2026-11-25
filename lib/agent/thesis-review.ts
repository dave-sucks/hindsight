/**
 * How a review of a thesis ends (roadmap 21). A look by the stock's analyst
 * ends with one note and one verdict: what the evidence since the last look
 * did to the belief as written. Outlook and conviction are the thesis's
 * state; they change only in that note's save, and nothing adds verdicts up.
 *
 * Six things send a look's note back whole, each with what to send:
 * 1. no verdict;
 * 2. a verdict other than UNCHANGED that doesn't say what happened;
 * 3. conviction rising without STRONGER, or falling without WEAKER or BROKEN;
 * 4. a new conviction with no reason, or a new outlook with no rewritten opinion;
 * 5. a stock with a view and no outlook yet, when the note sets none (once a
 *    stock: after that it has one);
 * 6. a BROKEN verdict with no rewritten opinion: the opinion is the stock's
 *    current view, the next run starts from it, and a broken case always
 *    changes it. On STRONGER or WEAKER the opinion is rewritten when the look
 *    changed what the analyst thinks or would do; that is the analyst's
 *    judgment (how-a-look-ends.md), never refused, so a small piece of news
 *    neither forces a rewrite nor gets called UNCHANGED to dodge one.
 *
 * Outlook is otherwise a soft value: nothing here ties it to a verdict or to
 * a trade, and no tool reads it to allow or refuse anything. What a broken
 * belief usually means for conviction, the outlook and a holding is said in
 * the analysts' instructions (how-a-look-ends.md), not enforced.
 *
 * Pure: write_note reads the row and calls it before the save.
 */
import { CONVICTIONS, VERDICTS, type Verdict } from "@/lib/agent/tools/thesis-fields";

export interface Review {
  verdict: string | undefined;
  verdictLine: string | undefined;
  convictionFrom: string | null;
  convictionTo: string | undefined;
  convictionReason: string | undefined;
  outlookFrom: string | null;
  outlookTo: string | undefined;
  /** The opinion sent with this note (its column is outlookReason). */
  outlookReason: string | undefined;
  /** The stock has a view (LONG or SHORT); a seed has none to rate. */
  hasView: boolean;
}

/** A level's rank, lowest first; the old top level reads as HIGH. */
const rank = (c: string | null | undefined): number | null => {
  if (!c) return null;
  const i = (CONVICTIONS as readonly string[]).indexOf(c === "STRONG" ? "HIGH" : c);
  return i < 0 ? null : i;
};

/** The verdict as one of the four, or undefined. */
export function verdictOf(v: string | undefined): Verdict | undefined {
  const up = v?.trim().toUpperCase();
  return (VERDICTS as readonly string[]).includes(up ?? "") ? (up as Verdict) : undefined;
}

/** What stops this review's note from saving, as the sentence that says what to send; null when nothing does. */
export function reviewProblem(r: Review): string | null {
  const verdict = verdictOf(r.verdict);
  if (!verdict) return "End the note with its verdict: STRONGER, UNCHANGED, WEAKER or BROKEN. A move in the price alone is UNCHANGED.";
  if (verdict !== "UNCHANGED" && !r.verdictLine?.trim()) {
    return `Send verdict_line with ${verdict}: one sentence on what happened and which KPI it touched.`;
  }
  const outlookMoves = r.outlookTo !== undefined && r.outlookTo !== r.outlookFrom;
  if (r.hasView && !r.outlookFrom && !r.outlookTo) {
    return "This stock has no outlook yet: send outlook (BULLISH, NEUTRAL or BEARISH) with your opinion, your full view of the stock at today's price.";
  }
  if (outlookMoves && !r.outlookReason?.trim()) return `Send your rewritten opinion with outlook ${r.outlookTo}: the new outlook changes your view of the stock at today's price.`;
  // A broken case always changes the view, and the next run starts from the opinion.
  if (r.hasView && verdict === "BROKEN" && !r.outlookReason?.trim()) {
    return "Send your rewritten opinion with BROKEN: a broken case changes your view of the stock, and the next run starts from it.";
  }
  const from = rank(r.convictionFrom);
  const to = rank(r.convictionTo);
  if (to != null && to !== from && !r.convictionReason?.trim()) return `Send conviction_rationale with conviction ${r.convictionTo}: a sentence or two on why you are this confident now.`;
  if (from != null && to != null && to !== from) {
    if (to > from && verdict !== "STRONGER") return `Conviction rises only on a STRONGER verdict, and this one is ${verdict}. Leave conviction as it is, or send the verdict the evidence supports.`;
    if (to < from && verdict !== "WEAKER" && verdict !== "BROKEN") return `Conviction falls only on a WEAKER or BROKEN verdict, and this one is ${verdict}. Leave conviction as it is, or send the verdict the evidence supports.`;
  }
  return null;
}
