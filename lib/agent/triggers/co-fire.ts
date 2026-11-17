/**
 * co-fire.ts — two triggers on one thesis that ask the same question, firing
 * on the same pass, become ONE run (DAV-254).
 *
 * MU 2026-09-14 09:35: the $969 stop and the 8% trail fired in the same
 * minute and started two paid tactical runs deciding the same sale; the
 * second was only folded by the "close already queued" check after the
 * first had proposed. SRRK did the same on 09-10 and 09-11. Here the fold
 * happens before any run is spawned: the first fire carries the others as
 * `coFired`, the tactical run lists them all as fired, and each still gets
 * its own audit row.
 *
 * A sale and a trim fold together ("sell some or all?"); two buys fold
 * together ("buy?": a stock with three ways in, two true on one pass). An
 * add or a review keeps its own event, and so does a buy next to a sale.
 */

export interface CoFired {
  triggerId: string;
  /** The fire in words, for the kickoff and the audit row. */
  sentence: string;
}

interface Foldable {
  thesisId: string;
  triggerId: string;
  action: string;
  /** The trigger in words ("Sell if below $969"). */
  sentence: string;
  firedContext?: string | null;
  coFired?: CoFired[];
}

/** Which question a fire asks; fires asking the same one on one thesis fold. */
const QUESTION: Readonly<Record<string, string>> = { EXIT: "sell", TRIM: "sell", ENTER: "buy" };

export function collapseProtectiveFires<T extends Foldable>(events: T[]): T[] {
  const out: T[] = [];
  const primaryByKey = new Map<string, T>();
  for (const e of events) {
    const question = QUESTION[e.action];
    if (!question) {
      out.push(e);
      continue;
    }
    const key = `${e.thesisId}:${question}`;
    const primary = primaryByKey.get(key);
    if (!primary) {
      primaryByKey.set(key, e);
      out.push(e);
      continue;
    }
    primary.coFired = [
      ...(primary.coFired ?? []),
      { triggerId: e.triggerId, sentence: e.sentence },
    ];
  }
  return out;
}
