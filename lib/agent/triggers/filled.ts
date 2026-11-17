/**
 * A trade a trigger led to uses it up, like a filled order: when the trim or
 * add its proposal answered fills, the trigger comes off the stock, with one
 * Activity line. A buy's triggers come off at its fill (armHeldLadderOnFill);
 * a sale closes the position. A declined, expired or withdrawn proposal uses
 * nothing up: the trigger stays, and fires again after a close finds it false.
 * A rule inherited from the analyst or the account isn't the stock's to take off.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { sentenceOf } from "./condition/describe";
import { acceptedOps, applyTriggerOps } from "./ops";
import { parseTriggersResilient } from "./schema";
import type { Trigger } from "./types";

/** Take the triggers a filled order answered off the stock. Returns how many came off. */
export async function takeOffFilled(args: { thesisId: string; triggerIds: readonly string[]; priceAtTime?: number | null }): Promise<number> {
  const thesis = await prisma.thesis.findUnique({ where: { id: args.thesisId }, select: { id: true, direction: true, status: true, triggers: true } });
  if (!thesis) return 0;
  const stored = parseTriggersResilient(thesis.triggers).triggers as Trigger[];
  const used = stored.filter((t) => args.triggerIds.includes(t.id));
  if (!used.length) return 0;
  const applied = applyTriggerOps({ stored, ops: used.map((t) => ({ op: "remove" as const, id: t.id })), direction: thesis.direction, status: thesis.status, actor: "SYSTEM", mintId: () => randomUUID() });
  const off = applied.results.filter((r) => r.ok);
  if (!off.length) return 0;
  await prisma.thesis.update({ where: { id: thesis.id }, data: { triggers: applied.triggers as unknown as object[] } });
  await writeThesisUpdate({
    thesisId: thesis.id,
    type: "UPDATED",
    summary: `Its order filled, so it came off: ${used.map((t) => sentenceOf(t)).join("; ")}`,
    fieldChanges: { triggerOps: { from: null, to: acceptedOps(applied.results) } },
    triggerId: used[0].id,
    runId: null,
    priceAtTime: args.priceAtTime ?? null,
  });
  return off.length;
}
