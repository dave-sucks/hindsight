/**
 * How a review of a thesis ends (roadmap 21). A look by the stock's analyst
 * ends with one note and one verdict: what the evidence since the last look
 * did to the thesis. Outlook and conviction are the thesis's state; they
 * change only in that note's save, and nothing adds verdicts up.
 *
 * - Conviction rises only on STRONGER and falls only on WEAKER or BROKEN.
 * - Outlook may change on any verdict (a rally can turn it NEUTRAL with the
 *   thesis unchanged), but BROKEN can't leave it BULLISH.
 * - BROKEN on a stock we hold comes with a sale: proposed, waiting or declined.
 *
 * Pure: write_note reads the row and calls it before the save.
 */
import { CONVICTIONS, VERDICTS, type Verdict } from "@/lib/agent/tools/thesis-fields";

export interface Review {
  verdict: string | undefined;
  verdictLine: string | undefined;
  convictionFrom: string | null;
  convictionTo: string | undefined;
  outlookFrom: string | null;
  outlookTo: string | undefined;
  holding: boolean;
  /** A sale of this holding was proposed, is waiting, or was declined by the owner. */
  saleOnRecord: boolean;
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
    return `Send verdict_line with ${verdict}: one sentence on what happened and which assumption or 'would prove it wrong' line it touched.`;
  }
  const from = rank(r.convictionFrom);
  const to = rank(r.convictionTo);
  if (from != null && to != null && to !== from) {
    if (to > from && verdict !== "STRONGER") return `Conviction rises only on a STRONGER verdict, and this one is ${verdict}. Leave conviction as it is, or send the verdict the evidence supports.`;
    if (to < from && verdict !== "WEAKER" && verdict !== "BROKEN") return `Conviction falls only on a WEAKER or BROKEN verdict, and this one is ${verdict}. Leave conviction as it is, or send the verdict the evidence supports.`;
  }
  if (verdict === "BROKEN") {
    if ((r.outlookTo ?? r.outlookFrom) === "BULLISH") return "A broken thesis can't stay BULLISH: send outlook NEUTRAL or BEARISH with outlook_reason.";
    if (r.holding && !r.saleOnRecord) return "BROKEN on a stock we hold comes with its sale: propose it with sell first, then write this note, which becomes its reason.";
  }
  return null;
}
