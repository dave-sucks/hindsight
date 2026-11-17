/**
 * A trade a trigger led to uses it up, like a filled order: when a trim fills,
 * the stock's trim triggers behind it come off (an add's add triggers), with
 * one Activity line. Behind it: the ones its proposal answered, and any of the
 * stock's own of that action that fired and haven't been found false at a
 * close since (a trim the morning run or the chat made answers those too).
 * Never another action: a trim answering a floor's fire leaves the floor. A
 * buy's triggers come off at its fill (armHeldLadderOnFill); a sale closes the
 * position. A declined, expired or withdrawn proposal uses nothing up. A rule
 * inherited from the analyst or the account isn't the stock's to take off.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { firedSinceFalseClose, sentenceOf } from "./condition/describe";
import { acceptedOps, applyTriggerOps } from "./ops";
import { parseTriggersResilient } from "./schema";
import type { Trigger } from "./types";

/** Take the triggers a filled trim or add used up off the stock. Returns how many came off. */
export async function takeOffFilled(args: { thesisId: string; intent: "PARTIAL_CLOSE" | "ADD"; triggerIds: readonly string[]; priceAtTime?: number | null }): Promise<number> {
  const action = args.intent === "ADD" ? "ADD" : "TRIM";
  // The row is locked before it is read: the close pass writes the same list.
  const done = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Thesis" WHERE id = ${args.thesisId} FOR UPDATE`;
    const thesis = await tx.thesis.findUnique({ where: { id: args.thesisId }, select: { id: true, direction: true, status: true, triggers: true } });
    if (!thesis) return null;
    const stored = parseTriggersResilient(thesis.triggers).triggers as Trigger[];
    const used = stored.filter((t) => t.action === action && (args.triggerIds.includes(t.id) || firedSinceFalseClose(t)));
    if (!used.length) return null;
    const applied = applyTriggerOps({ stored, ops: used.map((t) => ({ op: "remove" as const, id: t.id })), direction: thesis.direction, status: thesis.status, actor: "SYSTEM", mintId: () => randomUUID() });
    if (!applied.results.some((r) => r.ok)) return null;
    await tx.thesis.update({ where: { id: thesis.id }, data: { triggers: applied.triggers as unknown as object[] } });
    return { thesisId: thesis.id, used, applied };
  });
  if (!done) return 0;
  await writeThesisUpdate({
    thesisId: done.thesisId,
    type: "UPDATED",
    summary: `Its order filled, so it came off: ${done.used.map((t) => sentenceOf(t)).join("; ")}`,
    fieldChanges: { triggerOps: { from: null, to: acceptedOps(done.applied.results) } },
    triggerId: done.used[0].id,
    runId: null,
    priceAtTime: args.priceAtTime ?? null,
  });
  return done.applied.results.filter((r) => r.ok).length;
}
