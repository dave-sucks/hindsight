/**
 * The fields the model has always read on a stock's row, filled from its
 * situations. Their names and bytes stay as they were (QB ruling,
 * 2026-10-07) until the read changes what the model sees, with that change's
 * cases; get_theses builds the row from these, and the live-book test pins
 * them against what the read sent before the list existed.
 */
import type { ResolvedEnvelope } from "@/lib/agent/resolved-thesis";
import type { FloorRisk } from "@/lib/agent/floor-risk";
import { planChecksIn, workFlagOf } from "./flag-line";
import type { WorkFlag } from "./work-flag";
import type { PlanCheck } from "./plan-checks";
import type { NameTheSetup } from "./no-setup-named";
import type { Situation } from "./types";

const find = <C extends Situation["code"]>(list: readonly Situation[], code: C) =>
  list.find((s): s is Extract<Situation, { code: C }> => s.code === code);

/** `needsAction`: the lead's flag. */
export function needsActionOf(list: readonly Situation[]): WorkFlag | null {
  return workFlagOf(list);
}

/** `nameTheSetup`: the ask and the seat's choices, when no setup is named. */
export function nameTheSetupOf(list: readonly Situation[]): NameTheSetup | null {
  const s = find(list, "NO_SETUP_NAMED");
  return s ? { ask: s.data.ask, choose: s.data.choose } : null;
}

/** `buyBlockedByFull`: the portfolio decision's words, when a buy fired into a full analyst. */
export function buyBlockedByFullOf(list: readonly Situation[]): string | null {
  return find(list, "BUY_BLOCKED_FULL")?.data.blocked.text ?? null;
}

/**
 * `heldThroughFloor`: a declined protective sale while the breach is live and
 * provable. The declined sale already holds only while the price is past the
 * line when the floor and the price are known; with either unknown it still
 * holds (it owes an answer), but this field asserts nothing it cannot see.
 */
export function heldThroughFloorOf(
  list: readonly Situation[],
  currentPrice: number | null,
): { floorPrice: number; heldThroughCount: number; rejectMessage: string | null; recentLow: number | null } | null {
  const flag = find(list, "PROTECTIVE_SALE")?.data.flag;
  if (flag?.kind !== "SALE_DECLINED") return null;
  if (flag.floorPrice == null || currentPrice == null || currentPrice <= 0) return null;
  return {
    floorPrice: flag.floorPrice,
    heldThroughCount: flag.declineCount,
    rejectMessage: flag.rejectMessage,
    recentLow: flag.recentLow,
  };
}

/** The row's `resolved`, with the plan checks and the floor risk back in the two places they always sat. */
export function resolvedForRow(
  envelope: ResolvedEnvelope,
  list: readonly Situation[],
): ResolvedEnvelope & { planSanity: PlanCheck[] | null; floorRisk: FloorRisk | null } {
  const { currentPrice, entryQualityScore, unrealizedGainPct, progressToTarget, ladderHealth, ...rest } = envelope;
  const checks = planChecksIn(list);
  return {
    currentPrice,
    entryQualityScore,
    unrealizedGainPct,
    progressToTarget,
    ladderHealth,
    planSanity: checks.length > 0 ? checks : null,
    floorRisk: find(list, "PROTECTION")?.data.floorRisk ?? null,
    ...rest,
  };
}
