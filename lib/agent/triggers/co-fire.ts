/**
 * co-fire.ts — two protective triggers on one thesis firing on the same
 * pass become ONE run (DAV-254).
 *
 * MU 2026-09-14 09:35: the $969 stop and the 8% trail fired in the same
 * minute and started two paid tactical runs deciding the same sale; the
 * second was only folded by the "close already queued" check after the
 * first had proposed. SRRK did the same on 09-10 and 09-11. Here the fold
 * happens before any run is spawned: the first protective fire carries the
 * others as `coFired`, the tactical run lists them all as fired, and each
 * still gets its own audit row.
 *
 * Only EXIT and TRIM fold — they answer one question ("sell some or all?").
 * A buy, an add or a review firing alongside a stop is a different decision
 * and keeps its own event.
 */

export interface CoFired {
  triggerId: string;
  predicateKind: string;
  /** The fire in words, for the kickoff and the audit row. */
  sentence: string;
}

interface Foldable {
  thesisId: string;
  triggerId: string;
  action: string;
  predicateKind: string;
  firedContext?: string | null;
  coFired?: CoFired[];
}

const PROTECTIVE = new Set(["EXIT", "TRIM"]);

export function collapseProtectiveFires<T extends Foldable>(
  events: T[],
  sentenceFor: (e: T) => string = (e) => `${e.predicateKind} (${e.action})`,
): T[] {
  const out: T[] = [];
  const primaryByThesis = new Map<string, T>();
  for (const e of events) {
    if (!PROTECTIVE.has(e.action)) {
      out.push(e);
      continue;
    }
    const primary = primaryByThesis.get(e.thesisId);
    if (!primary) {
      primaryByThesis.set(e.thesisId, e);
      out.push(e);
      continue;
    }
    primary.coFired = [
      ...(primary.coFired ?? []),
      { triggerId: e.triggerId, predicateKind: e.predicateKind, sentence: sentenceFor(e) },
    ];
  }
  return out;
}
