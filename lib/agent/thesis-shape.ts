/**
 * Thesis shape validation — relative ordering of a stock's buy, floor and
 * upside line (read off its triggers) given the trade direction.
 *
 * Used by `record_thesis` and `update_thesis` as the upstream cure for
 * the inverted-target class of bugs that PR #227 catches downstream at
 * `place_trade`. A WATCHING thesis minted with its upside line ≤ the buy on a
 * LONG (or ≥ the buy on a SHORT) is broken at birth.
 *
 * 2026-05-07 audit found 3 currently-open WATCHING theses with broken
 * shape (Earnings Drift MU stop>entry, Secular Theme MRVL stop>entry,
 * Secular Theme MU target<entry). All three were minted in late April
 * by record_thesis without this gate.
 *
 * Rules per direction (when the relevant prices are all non-null):
 *   LONG  — upside line > buy > floor
 *   SHORT — upside line < buy < floor
 *   PASS  — no shape rule
 *
 * Partial sets (one of the three null) check only the pairs that ARE
 * present. Equal values fail. On a watch the "floor" is its Stop watching
 * line, and the reply calls it that.
 *
 * No reward/risk: the house sets no target of its own (a stock has triggers
 * and nothing else; "target" is Wall Street's number). The refusal that lived
 * here from 2026-09-02 to 2026-11-04 is gone, and so is the ratio it reported.
 */

export interface ThesisShapeArgs {
  // P1-24 B4: `null` is the unresearched-seed sentinel (legacy 'PENDING'
  // kept for the dual-read window). Both have no shape rule.
  direction: "LONG" | "SHORT" | "PASS" | "PENDING" | null;
  /** The buy trigger's price on a watch; what we paid on a holding. */
  buy?: number | null;
  /** The upside line's price. */
  upside?: number | null;
  /** The sale on a holding, the Stop watching line on a watch. */
  floor?: number | null;
  /**
   * The row is a live position. `buy` is then the fill, a historical
   * fact, and the stop is meant to ratchet up past it — a breakeven stop is
   * the whole point of protecting a winner. So the floor-vs-buy pair is
   * skipped; the upside line against the other two still applies. (SMMT
   * 2026-09-03/07: "move the stop to the $14.35 fill" refused three times by
   * a rule written for plans we haven't bought — DAV-233.)
   */
  held?: boolean;
}

export type ThesisShapeResult =
  | { ok: true }
  | { ok: false; reason: string; note: string };

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

  const entry = args.buy ?? null;
  const target = args.upside ?? null;
  const stop = args.floor ?? null;

  const isLong = args.direction === "LONG";
  // On a watch the line under the buy is where we stop watching, never a floor.
  const floorName = args.held ? (isLong ? "floor" : "stop") : "Stop watching line";

  // Pair-by-pair checks. Each check runs only when both members are
  // non-null. The fail messages name the inverted pair and the fix in
  // trigger words, so the agent's retry can fix it without guessing.
  const fail = (reason: string, note: string): ThesisShapeResult => ({ ok: false, reason, note: `${note} Move one of them with edit_triggers, by its id.` });
  if (entry != null && target != null) {
    if (isLong && target <= entry) return fail("LONG-target-not-above-entry", `On a LONG the upside line sits above the buy: the buy is $${entry}, the upside line $${target}.`);
    if (!isLong && target >= entry) return fail("SHORT-target-not-below-entry", `On a SHORT the upside line sits below the entry: the entry is $${entry}, the upside line $${target}.`);
  }
  if (entry != null && stop != null && !args.held) {
    if (isLong && stop >= entry) return fail("LONG-stop-not-below-entry", `On a LONG the ${floorName} sits below the buy: the buy is $${entry}, the ${floorName} $${stop}.`);
    if (!isLong && stop <= entry) return fail("SHORT-stop-not-above-entry", `On a SHORT the ${floorName} sits above the entry: the entry is $${entry}, the ${floorName} $${stop}.`);
  }
  if (target != null && stop != null) {
    if (isLong && target <= stop) return fail("LONG-target-not-above-stop", `On a LONG the upside line sits above the ${floorName}: the ${floorName} is $${stop}, the upside line $${target}.`);
    if (!isLong && target >= stop) return fail("SHORT-target-not-below-stop", `On a SHORT the upside line sits below the ${floorName}: the ${floorName} is $${stop}, the upside line $${target}.`);
  }

  return { ok: true };
}
