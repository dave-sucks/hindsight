/**
 * Stop when buying — a broker's "stop on buy" as a setting.
 *
 * On: when a buy makes a new long holding, its sale floor is this % under the
 * buy price — "Sell if below $X", sold right away, marked as the owner's, so
 * no agent can lower it. A tighter floor an analyst or a template set stays
 * as a review line above it ("Review if below $Y", asking the analyst); a
 * tighter floor the owner set stays as it is. The account holds the setting;
 * an analyst may hold its own (null = the account's). Written by
 * armHeldLadderOnFill (lib/proposals/thesis-flips.ts) at the price when the
 * buy is approved, and moved to the line under what was paid when the fill
 * lands (reconcile-orders.ts); a buy is sized off the wider line (sizingStop,
 * lib/agent/position-sizing.ts).
 */

import { prisma } from "@/lib/prisma";
import { addedTriggerRationale, type TriggerOp } from "@/lib/agent/triggers/ops";
import { levelSlotOf } from "@/lib/agent/triggers/price-levels";
import { levelOf, shapeOf, type Condition } from "@/lib/agent/triggers/condition";
import { triggerSlot } from "@/lib/agent/triggers/condition/slot";
import { autoStopPrice } from "@/lib/agent/position-sizing";
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

/**
 * The ops that put a new long holding's sale floor on the line; [] when the
 * setting is off or the owner's own floor is already at or above it.
 *   - no floor: one is added;
 *   - a floor at or below the line: moved to it in place (same id);
 *   - a tighter floor not the owner's: the sale floor moves to the line, and
 *     that price stays as a review line, one per slot, the higher kept.
 */
export function autoStopOps(input: { triggers: Trigger[]; direction: string | null; buyPrice: number; setting: AutoStop }): TriggerOp[] {
  if (!input.setting.on || input.direction !== "LONG" || !(input.buyPrice > 0)) return [];
  const price = autoStopPrice(input.buyPrice, input.setting.pct);
  const valueOf = (t: Trigger) => levelOf(shapeOf(t.predicate) as Condition)?.value ?? 0;
  const highest = (ts: Trigger[]) => ts.reduce<Trigger | null>((best, t) => (best == null || valueOf(t) > valueOf(best) ? t : best), null);
  const floor = highest(input.triggers.filter((t) => levelSlotOf(t, "LONG") === "FLOOR"));
  if (floor?.source === "PRINCIPAL" && valueOf(floor) >= price) return [];
  const sale = (predicate: Condition): Trigger => ({
    id: floor?.id ?? "",
    predicate,
    action: "EXIT",
    fireMode: "DO_IT",
    rationale: addedTriggerRationale("EXIT", predicate),
    source: "PRINCIPAL",
  });
  if (!floor) return [{ op: "add", trigger: sale({ watch: "price", is: "below", value: price }) }];
  const at = shapeOf(floor.predicate) as Condition;
  const ops: TriggerOp[] = [{ op: "replace", id: floor.id, trigger: sale({ ...at, value: price }) }];
  if (valueOf(floor) <= price) return ops;
  const review: Trigger = { id: "", predicate: at, action: "REVIEW", fireMode: "ASK_NOW", rationale: floor.rationale, ...(floor.source ? { source: floor.source } : {}) };
  const there = highest(input.triggers.filter((t) => triggerSlot(t) === triggerSlot(review)));
  if (!there) ops.push({ op: "add", trigger: review });
  else if (valueOf(there) < valueOf(floor)) ops.push({ op: "replace", id: there.id, trigger: { ...review, id: there.id } });
  return ops;
}

/**
 * When the buy fills: the sale floor this setting put on the line under the
 * price it was bought at moves to the line under what was paid. [] when no
 * floor sits on that line (an owner's floor above it, or the setting off).
 */
export function autoStopFillOps(input: { triggers: Trigger[]; direction: string | null; boughtAt: number; paid: number; setting: AutoStop }): TriggerOp[] {
  if (!input.setting.on || input.direction !== "LONG" || !(input.boughtAt > 0) || !(input.paid > 0)) return [];
  const was = autoStopPrice(input.boughtAt, input.setting.pct);
  const now = autoStopPrice(input.paid, input.setting.pct);
  const floor = input.triggers.find(
    (t) => t.action === "EXIT" && t.fireMode === "DO_IT" && levelSlotOf(t, "LONG") === "FLOOR" && levelOf(shapeOf(t.predicate) as Condition)?.value === was,
  );
  if (!floor || was === now) return [];
  const predicate: Condition = { ...(shapeOf(floor.predicate) as Condition), value: now };
  return [{ op: "replace", id: floor.id, trigger: { ...floor, predicate, rationale: addedTriggerRationale("EXIT", predicate) } }];
}
