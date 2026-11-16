/**
 * Thesis shape validation — relative ordering of a stock's buy, floor and
 * upside line (read off its triggers) given the trade direction.
 *
 * Used by `record_thesis` and `update_thesis` as the upstream cure for
 * the inverted-target class of bugs that PR #227 catches downstream at
 * `place_trade`. A WATCHING thesis minted with target ≤ entry on a
 * LONG (or target ≥ entry on a SHORT) is broken at birth — once an
 * ENTER trigger fires and the agent promotes via update_thesis, the
 * stale numbers carry forward into place_trade and trip #227's gate.
 * Catching the shape problem at thesis-write time prevents the rotten
 * data from ever entering DB.
 *
 * 2026-05-07 audit found 3 currently-open WATCHING theses with broken
 * shape (Earnings Drift MU stop>entry, Secular Theme MRVL stop>entry,
 * Secular Theme MU target<entry). All three were minted in late April
 * by record_thesis without this gate.
 *
 * Rules per direction (when the relevant prices are all non-null):
 *   LONG  — target > entry > stop
 *   SHORT — target < entry < stop
 *   PASS  — no shape rule (the prices are reference levels, not a trade)
 *
 * Partial sets (one of the three null) check only the pairs that ARE
 * present:
 *   LONG with target+entry only       → target > entry
 *   LONG with entry+stop only         → entry > stop
 *   LONG with target+stop only        → target > stop
 *   (and SHORT mirrors)
 *
 * Equal values fail — a target equal to entry has zero R/R and is
 * functionally the same bug as target < entry.
 *
 * The reward/risk ratio is reported on legal levels, never enforced: the
 * house sets no target of its own (a stock has triggers and nothing else;
 * "target" is Wall Street's number), so a reward/risk floor had nothing of
 * ours to measure. The refusal that lived here from 2026-09-02 to 2026-11-04 is
 * gone; under twice the floor's distance the agent says why in its note.
 */

export interface ThesisShapeArgs {
  // P1-24 B4: `null` is the unresearched-seed sentinel (legacy 'PENDING'
  // kept for the dual-read window). Both have no shape rule.
  direction: "LONG" | "SHORT" | "PASS" | "PENDING" | null;
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  /**
   * The row is a live position. `entry` is then the fill, a historical
   * fact, and the stop is meant to ratchet up past it — a breakeven stop is
   * the whole point of protecting a winner. So the stop-vs-entry pair is
   * skipped; target-vs-entry and target-vs-stop still apply. (SMMT
   * 2026-09-03/07: "move the stop to the $14.35 fill" refused three times by
   * a rule written for plans we haven't bought — DAV-233.)
   */
  held?: boolean;
}

export type ThesisShapeResult =
  | { ok: true; riskReward?: number }
  | { ok: false; reason: string; note: string };

/** Reward per unit of risk for a priced buy, or null when either side is ≤ 0. */
export function riskReward(
  direction: "LONG" | "SHORT",
  entry: number,
  target: number,
  stop: number,
): number | null {
  const risk = direction === "LONG" ? entry - stop : stop - entry;
  const reward = direction === "LONG" ? target - entry : entry - target;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

export function validateThesisShape(
  args: ThesisShapeArgs,
): ThesisShapeResult {
  // PASS + unresearched-seed theses are reference-only / pre-research; no
  // shape rule. P1-24 B4: seed = direction null (new) or 'PENDING' (legacy).
  if (
    args.direction === "PASS" ||
    args.direction === "PENDING" ||
    args.direction == null
  ) {
    return { ok: true };
  }

  const entry = args.entryPrice ?? null;
  const target = args.targetPrice ?? null;
  const stop = args.stopLoss ?? null;

  const isLong = args.direction === "LONG";

  // Pair-by-pair checks. Each check runs only when both members are
  // non-null. The fail messages name the inverted pair and the fix in
  // trigger words, so the agent's retry can fix it without guessing.
  const fail = (reason: string, note: string): ThesisShapeResult => ({ ok: false, reason, note: `${note} Move one of them with edit_triggers, by its id.` });
  if (entry != null && target != null) {
    if (isLong && target <= entry) return fail("LONG-target-not-above-entry", `On a LONG the upside line sits above the buy: the buy is $${entry}, the upside line $${target}.`);
    if (!isLong && target >= entry) return fail("SHORT-target-not-below-entry", `On a SHORT the upside line sits below the entry: the entry is $${entry}, the upside line $${target}.`);
  }
  if (entry != null && stop != null && !args.held) {
    if (isLong && stop >= entry) return fail("LONG-stop-not-below-entry", `On a LONG the floor sits below the buy: the buy is $${entry}, the floor $${stop}.`);
    if (!isLong && stop <= entry) return fail("SHORT-stop-not-above-entry", `On a SHORT the stop sits above the entry: the entry is $${entry}, the stop $${stop}.`);
  }
  if (target != null && stop != null) {
    if (isLong && target <= stop) return fail("LONG-target-not-above-stop", `On a LONG the upside line sits above the floor: the floor is $${stop}, the upside line $${target}.`);
    if (!isLong && target >= stop) return fail("SHORT-target-not-below-stop", `On a SHORT the upside line sits below the stop: the stop is $${stop}, the upside line $${target}.`);
  }

  if (entry == null || target == null || stop == null) return { ok: true };
  const rr = riskReward(args.direction, entry, target, stop) ?? undefined;
  return { ok: true, riskReward: rr };
}
