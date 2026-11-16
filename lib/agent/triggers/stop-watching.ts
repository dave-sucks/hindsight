/**
 * Stop watching — what a sale line does on a stock we only watch.
 *
 * On a WATCHING thesis a sell trigger reads "Stop watching if below $X" (or
 * whatever its condition is). When it fires, on the close (watchedFloorOnClose),
 * the thesis retires as dropped: status RETIRED, reason DROPPED, one Activity
 * line naming the trigger. No run starts and nothing waits for approval: no
 * money moves, and a buy still waiting for approval is withdrawn with it. On a
 * stock we hold, the same trigger is a sale.
 *
 * It replaced setting "the plan" down (removing the buy, floor and target and
 * leaving the stock on watch): a stock has its triggers and nothing else, so a
 * line that says the setup is wrong ends the watch.
 */

import { prisma } from "@/lib/prisma";
import { sentenceOf } from "./condition";
import { ruleOnTheLine, writeThesisUpdate } from "@/lib/agent/thesis-updates";
import type { Trigger } from "./types";

/**
 * Retire a WATCHING thesis because one of its sale lines fired. Anything not
 * WATCHING (a holding, a promoted row, one already retired) is left alone and
 * comes back `retired: false`, so the caller writes the fire down instead.
 */
export async function stopWatching(args: {
  thesisId: string;
  trigger: Pick<Trigger, "id" | "action" | "predicate">;
  priceAtTime?: number | null;
}): Promise<{ retired: boolean }> {
  const thesis = await prisma.thesis.findUnique({ where: { id: args.thesisId }, select: { id: true, status: true } });
  if (thesis?.status !== "WATCHING") return { retired: false };
  const line = sentenceOf(args.trigger, false);
  const now = new Date();
  const count = await prisma.$transaction(async (tx) => {
    const { count: n } = await tx.thesis.updateMany({
      where: { id: thesis.id, status: "WATCHING" },
      data: { status: "RETIRED", retiredReason: "DROPPED", closedAt: now, closeReason: line },
    });
    // A buy waiting for approval goes with the watch, withdrawn as the close pass withdraws one (trigger-proposals.ts).
    const waiting = n > 0 ? await tx.order.findMany({ where: { thesisId: thesis.id, intent: "OPEN", status: "AWAITING_APPROVAL" }, select: { id: true, positionId: true } }) : [];
    for (const o of waiting) {
      await tx.order.updateMany({ where: { id: o.id, status: "AWAITING_APPROVAL" }, data: { status: "WITHDRAWN", withdrawnReason: line } });
      await tx.position.updateMany({ where: { id: o.positionId, status: "PENDING_APPROVAL" }, data: { status: "CANCELLED", closedAt: now, closeReason: "MANUAL" } });
    }
    return n;
  });
  if (count === 0) return { retired: false };
  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "TRIGGER_FIRED",
    summary: line,
    triggerId: args.trigger.id,
    ...ruleOnTheLine(args.trigger),
    signalIds: [],
    runId: null,
    priceAtTime: args.priceAtTime ?? null,
    fieldChanges: { status: { from: "WATCHING", to: "RETIRED" }, retiredReason: { from: null, to: "DROPPED" } },
  });
  return { retired: true };
}
