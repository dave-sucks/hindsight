/**
 * Thesis shape validation — relative ordering of entry / target / stop
 * given the trade direction.
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
 *   PASS  — no shape rule (the prices are reference levels, not a plan
 *           to trade)
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
 */

export interface ThesisShapeArgs {
  direction: "LONG" | "SHORT" | "PASS" | "PENDING";
  entryPrice?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
}

export type ThesisShapeResult =
  | { ok: true }
  | { ok: false; reason: string; note: string };

export function validateThesisShape(
  args: ThesisShapeArgs,
): ThesisShapeResult {
  // PASS + PENDING theses are reference-only / pre-research; no shape rule.
  if (args.direction === "PASS" || args.direction === "PENDING") {
    return { ok: true };
  }

  const entry = args.entryPrice ?? null;
  const target = args.targetPrice ?? null;
  const stop = args.stopLoss ?? null;

  const isLong = args.direction === "LONG";

  // Pair-by-pair checks. Each check runs only when both members are
  // non-null. The fail messages name the specific inverted pair so
  // the agent's retry can fix it without guessing.
  if (entry != null && target != null) {
    if (isLong && target <= entry) {
      return {
        ok: false,
        reason: "LONG-target-not-above-entry",
        note:
          `LONG thesis requires target_price > entry_price. ` +
          `You passed entry=$${entry}, target=$${target}. ` +
          `Set a NEW target_price ABOVE entry_price (R/R ≥ 2:1 vs the stop). ` +
          `If this is a WATCHING thesis where price has crossed the old target, ` +
          `the OLD target was the ENTER trigger level — it's no longer valid as a take-profit. ` +
          `Recompute target relative to current price.`,
      };
    }
    if (!isLong && target >= entry) {
      return {
        ok: false,
        reason: "SHORT-target-not-below-entry",
        note:
          `SHORT thesis requires target_price < entry_price. ` +
          `You passed entry=$${entry}, target=$${target}. ` +
          `Set a NEW target_price BELOW entry_price.`,
      };
    }
  }

  if (entry != null && stop != null) {
    if (isLong && stop >= entry) {
      return {
        ok: false,
        reason: "LONG-stop-not-below-entry",
        note:
          `LONG thesis requires stop_loss < entry_price. ` +
          `You passed entry=$${entry}, stop=$${stop}. ` +
          `Set a NEW stop_loss BELOW entry_price (typically 5-10% below for swing, tighter for TRADE horizon).`,
      };
    }
    if (!isLong && stop <= entry) {
      return {
        ok: false,
        reason: "SHORT-stop-not-above-entry",
        note:
          `SHORT thesis requires stop_loss > entry_price. ` +
          `You passed entry=$${entry}, stop=$${stop}. ` +
          `Set a NEW stop_loss ABOVE entry_price.`,
      };
    }
  }

  if (target != null && stop != null) {
    if (isLong && target <= stop) {
      return {
        ok: false,
        reason: "LONG-target-not-above-stop",
        note:
          `LONG thesis requires target_price > stop_loss. ` +
          `You passed target=$${target}, stop=$${stop}. ` +
          `Either lower stop_loss or raise target_price so target > stop (R/R ≥ 2:1 ideally).`,
      };
    }
    if (!isLong && target >= stop) {
      return {
        ok: false,
        reason: "SHORT-target-not-below-stop",
        note:
          `SHORT thesis requires target_price < stop_loss. ` +
          `You passed target=$${target}, stop=$${stop}. ` +
          `Either raise stop_loss or lower target_price so target < stop (R/R ≥ 2:1 ideally).`,
      };
    }
  }

  return { ok: true };
}
