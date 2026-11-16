/**
 * co-fire.ts — one trigger run per stock per pass (DAV-254, widened 2026-11-16).
 *
 * MU 2026-09-14: the stop and the 8% trail fired in the same minute and started
 * two paid runs deciding the same sale. That fold covered a sale and a trim
 * only, so it missed the rest: on 2026-11-16 at 09:30 GEV's review and its
 * sales became two runs one second apart, both editing GEV's triggers (the
 * second's removal came back "not on this thesis" because the first had made
 * it), and PRAX's two filing reviews became two runs fourteen seconds apart.
 *
 * The rule now: everything that fires on one stock in one pass is ONE run. The
 * highest-ranked fire is the run's; the others ride in it as `coFired`, each
 * still getting its own Activity line, and the run's kickoff lists them all.
 *
 * Two things never ride along, and both wait for the next pass instead:
 *   - A fire that makes its own trade with no agent (an Auto buy, add, trim or
 *     sale) can't be done by another fire's run, so it asks again after.
 *   - While the stock's last run is still going, a sale or a buy can't start a
 *     second one beside it (it asks again once that run ends), and a review is
 *     written down for the next look, never run.
 * A fire that waits is not stamped (no cooldown, no fired-filing memory): it
 * fires again on the next pass, so nothing is lost.
 */

export interface CoFired {
  triggerId: string;
  /** What it means now, for the proposal a same-side co-fire is answered by. Absent on an event sent before 2026-11-16: a sale. */
  action?: string;
  /** The fire in words, for the kickoff and the audit row. */
  sentence: string;
  /** The facts behind it (the filing it fired on, the figures), for the kickoff. */
  firedContext?: string | null;
}

export interface Fire {
  thesisId: string;
  triggerId: string;
  /** What the fire means for the stock now (`effectiveTriggerAction`). */
  action: string;
  /** The trigger in words ("Sell if below $969"). */
  sentence: string;
  firedContext?: string | null;
  /** It makes its own trade with no agent (`doItTrade`): the run can't make it for it. */
  ownTrade?: boolean;
  coFired?: CoFired[];
}

/** What a run decides first: a sale before a trim before an add before a buy before a look. */
const RANK: Readonly<Record<string, number>> = { EXIT: 0, TRIM: 1, ADD: 2, ENTER: 3, REVIEW: 4 };
const rankOf = (action: string) => RANK[action] ?? 5;

export interface StockPlan<T extends Fire> {
  /** The one run this pass makes on the stock, carrying the fires that ride in it; none when the stock is busy. */
  run: T | null;
  /** Fires left as a line for the next look: a review that landed while the stock's run was going. */
  writtenDown: T[];
  /** Fires that ask again on the next pass, unstamped. */
  waiting: T[];
}

/**
 * Decide what one stock's run-bound fires become this pass. `fires` are all on
 * one stock; `busy` says its last run is still going. Pure.
 */
export function oneRunPerStock<T extends Fire>(fires: T[], opts: { busy: boolean }): StockPlan<T> {
  if (fires.length === 0) return { run: null, writtenDown: [], waiting: [] };

  if (opts.busy) {
    return {
      run: null,
      writtenDown: fires.filter((f) => f.action === "REVIEW"),
      waiting: fires.filter((f) => f.action !== "REVIEW"),
    };
  }

  // The first fire at the highest rank is the run's; an Auto trade goes first within a rank,
  // so a standing Auto-sell is made, not folded under an agent's sale.
  const ordered = fires
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rankOf(a.f.action) - rankOf(b.f.action) || Number(!a.f.ownTrade) - Number(!b.f.ownTrade) || a.i - b.i)
    .map((x) => x.f);
  const [primary, ...rest] = ordered;
  const riding = rest.filter((f) => !f.ownTrade);
  const run: T = riding.length
    ? {
        ...primary,
        coFired: [
          ...(primary.coFired ?? []),
          ...riding.map((f) => ({ triggerId: f.triggerId, action: f.action, sentence: f.sentence, ...(f.firedContext ? { firedContext: f.firedContext } : {}) })),
        ],
      }
    : primary;
  return { run, writtenDown: [], waiting: rest.filter((f) => f.ownTrade) };
}
