/**
 * An Auto buy, add or trim is a one-time order: once it fires and its trade is tried (proposed, sent or refused),
 * the trigger comes off the stock, with one Activity line. An Auto-sell stays a standing order.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { usedOnceLine } from "./fire-mode";
import { acceptedOps, applyTriggerOps } from "./ops";
import { parseTriggersResilient } from "./schema";
import type { Trigger } from "./types";

/** Take the fired trigger off the stock. False when it is not on it (a buy's fill already took it off). */
export async function useOnce(args: { thesisId: string; triggerId: string; runId: string | null; priceAtTime?: number | null }): Promise<boolean> {
  const thesis = await prisma.thesis.findUnique({ where: { id: args.thesisId }, select: { id: true, direction: true, status: true, triggers: true } });
  if (!thesis) return false;
  const stored = parseTriggersResilient(thesis.triggers).triggers as Trigger[];
  const used = stored.find((t) => t.id === args.triggerId);
  if (!used) return false;
  const applied = applyTriggerOps({ stored, ops: [{ op: "remove", id: used.id }], direction: thesis.direction, status: thesis.status, actor: "SYSTEM", mintId: () => randomUUID() });
  if (!applied.results[0]?.ok) return false;
  await prisma.thesis.update({ where: { id: thesis.id }, data: { triggers: applied.triggers as unknown as object[] } });
  const line = usedOnceLine(used);
  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "UPDATED",
    summary: line,
    fieldChanges: { triggerOps: { from: null, to: acceptedOps(applied.results) } },
    triggerId: used.id,
    runId: args.runId,
    priceAtTime: args.priceAtTime ?? null,
  });
  return true;
}
