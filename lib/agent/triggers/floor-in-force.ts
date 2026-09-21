/**
 * floor-in-force.ts — the stop a held stock is actually protected by.
 *
 * The protective ratchet says a floor on a stock we own only ever tightens;
 * only a person lowers one. For that rule to mean anything, the gate has to
 * read the same number the rule protects — the thesis's own floor trigger,
 * which is what fires — and not a mirror of it.
 *
 * `Position.stopLoss` is that mirror. It is written by the buy, by the fill
 * path and by the thesis popover, but NOT by `update_thesis`, which is the
 * path the agents use to tighten a stop. So every agent tightening drifts the
 * two apart in the loose direction: the thesis floor rises, the mirror stays
 * where it was. A gate reading the mirror then waves through a change that
 * lowers the real floor, which is the one thing it exists to stop (DAV-296;
 * the MU 2026-08-18 violation coming back through a side door).
 *
 * Absolute levels only — the same rule `canonicalLevels` uses for its cached
 * columns. A trail moves with the high, so it is not a number you can ratchet
 * against; `applyLevelArgs` does not write one either, so the gate and the
 * write path are looking at exactly the same thing.
 */

import type { Trigger } from "./types";
import { canonicalLevels } from "./price-levels";
import type { ResolvedTrigger } from "./levels";

/**
 * The typed floor price on a held thesis, or null when it has none.
 *
 * Takes the STORED trigger list — the same list `applyLevelArgs` rewrites —
 * so the gate and the write are reading one thing.
 */
export function thesisFloorStop(input: {
  triggers: Trigger[];
  direction: string | null;
  avgCost?: number | null;
}): number | null {
  if (input.triggers.length === 0) return null;
  const levels = canonicalLevels({
    triggers: input.triggers as ResolvedTrigger[],
    direction: input.direction,
    status: "HOLDING",
    avgCost: input.avgCost ?? null,
  });
  return levels.columns.stopLoss;
}

/**
 * What the ratchet compares against: the thesis's own floor, and only if
 * there is none, the position's mirror column.
 *
 * The fallback is not a hedge — a stock bought before the ladder existed, or
 * one whose thesis this tool can't resolve, still has a stop on the position
 * row and should still be protected by it. What the fallback must never do is
 * win over a real floor, which is the bug.
 */
export function stopToRatchetAgainst(input: {
  thesisFloor: number | null;
  positionStopLoss: number | null;
}): number | null {
  return input.thesisFloor ?? input.positionStopLoss;
}
