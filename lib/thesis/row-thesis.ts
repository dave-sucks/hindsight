/**
 * Which thesis a trade row opens.
 *
 * A ticker can carry several theses — a PASSED one from the analyst who looked
 * and declined, a HOLDING one from the analyst who bought it, an older RETIRED
 * one. Picking "the most recently updated" gets this wrong whenever the
 * declining analyst wrote last, which on 2026-10-01 was five of the twenty
 * open positions:
 *
 *   GEV  — bought today; the row opened a PASSED thesis the PEAD Specialist
 *          wrote on Jun 15, three days AFTER the Secular Compounder's HOLDING
 *          one. No chart, no position, a stock we had declined.
 *   ASML, NVDA, MU, IOT — same shape.
 *
 * Two rules, in order:
 *   1. The position's own TradeDecision wins. It names the thesis the buy was
 *      actually made on, and it is right even when that thesis sits in the
 *      other environment — which was CEG, where the by-ticker lookup found
 *      nothing at all because the thesis was PAPER under a LIVE position.
 *   2. Otherwise the ticker's theses, live before terminal. The clock only
 *      breaks ties inside those two groups, so the caller passes them already
 *      ordered newest-first.
 */

/** Statuses a run can still act on — these outrank a declined or closed one. */
const LIVE = new Set(["HOLDING", "WATCHING", "PROMOTED"]);

export function thesisForTradeRow(input: {
  /** thesisId off the position's newest TradeDecision, when it has one. */
  decisionThesisId: string | null | undefined;
  /** Every thesis on this ticker in this environment, newest-updated first. */
  tickerTheses: ReadonlyArray<{ id: string; status: string }>;
}): string | null {
  if (input.decisionThesisId) return input.decisionThesisId;
  const live = input.tickerTheses.find((t) => LIVE.has(t.status));
  return live?.id ?? input.tickerTheses[0]?.id ?? null;
}
