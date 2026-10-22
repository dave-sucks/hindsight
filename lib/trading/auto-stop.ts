/**
 * Stop when buying — a broker's "stop on buy" as a setting.
 *
 * On: when a buy makes a new holding, its floor is set this % under the buy
 * price, unless the stock already has its own floor at or above that. The
 * account holds the setting; an analyst may hold its own (null = the
 * account's). The floor is an ordinary trigger, "Sell if below $X",
 * proposed straight away, marked as the owner's, so no agent can lower it.
 * Written by armHeldLadderOnFill (lib/proposals/thesis-flips.ts).
 */

import { prisma } from "@/lib/prisma";
import { addedTriggerRationale, type TriggerOp } from "@/lib/agent/triggers/ops";
import { levelSlotOf } from "@/lib/agent/triggers/price-levels";
import { levelOf, shapeOf, type Condition } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";

export const AUTO_STOP_PCT_MIN = 0.5;
export const AUTO_STOP_PCT_MAX = 50;

export interface AutoStop {
  on: boolean;
  pct: number;
}

/** Why a percent can't be saved, or null. */
export function autoStopPctProblem(pct: unknown): string | null {
  return typeof pct === "number" && Number.isFinite(pct) && pct >= AUTO_STOP_PCT_MIN && pct <= AUTO_STOP_PCT_MAX
    ? null
    : `The stop must be between ${AUTO_STOP_PCT_MIN}% and ${AUTO_STOP_PCT_MAX}% under the buy price.`;
}

/** The analyst's own value where it has one, else the account's. */
export function effectiveAutoStop(
  account: { autoStopOnBuy: boolean; autoStopPct: number } | null,
  analyst: { autoStopOnBuy: boolean | null; autoStopPct: number | null } | null,
): AutoStop {
  return {
    on: analyst?.autoStopOnBuy ?? account?.autoStopOnBuy ?? false,
    pct: analyst?.autoStopPct ?? account?.autoStopPct ?? 8,
  };
}

/** The setting in force for one analyst's buys. */
export async function loadAutoStop(analystId: string): Promise<AutoStop> {
  const analyst = await prisma.agentConfig.findUnique({
    where: { id: analystId },
    select: { accountId: true, autoStopOnBuy: true, autoStopPct: true },
  });
  const account = analyst
    ? await prisma.account.findUnique({ where: { id: analyst.accountId }, select: { autoStopOnBuy: true, autoStopPct: true } })
    : null;
  return effectiveAutoStop(account, analyst);
}

/** The buy price less the percent, in cents. */
export function autoStopPrice(buyPrice: number, pct: number): number {
  return Math.round(buyPrice * (1 - pct / 100) * 100) / 100;
}

/**
 * The one op that sets the floor on a new long holding, or null when the
 * setting is off or the stock's own floor is already at or above the line.
 * A lower floor is raised in place (same id); with none, one is added.
 */
export function autoStopOp(input: { triggers: Trigger[]; direction: string | null; buyPrice: number; setting: AutoStop }): TriggerOp | null {
  if (!input.setting.on || input.direction !== "LONG" || !(input.buyPrice > 0)) return null;
  const price = autoStopPrice(input.buyPrice, input.setting.pct);
  const floorAt = (t: Trigger) => levelOf(shapeOf(t.predicate) as Condition)?.value ?? 0;
  const floor = input.triggers
    .filter((t) => levelSlotOf(t, "LONG") === "FLOOR")
    .reduce<Trigger | null>((best, t) => (best == null || floorAt(t) > floorAt(best) ? t : best), null);
  if (floor && floorAt(floor) >= price) return null;
  const predicate: Condition = floor ? { ...(shapeOf(floor.predicate) as Condition), value: price } : { watch: "price", is: "below", value: price };
  const trigger: Trigger = {
    id: floor?.id ?? "",
    predicate,
    action: "EXIT",
    fireMode: "DIRECT",
    rationale: addedTriggerRationale("EXIT", predicate),
    source: "PRINCIPAL",
  };
  return floor ? { op: "replace", id: floor.id, trigger } : { op: "add", trigger };
}
