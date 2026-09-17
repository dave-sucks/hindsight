/**
 * seed-analyst.ts — a new analyst starts with its seat's rules on its
 * Triggers tab; an existing one can be re-seeded, shown as a diff first
 * (DAV-280).
 *
 * The same shape as seed-account.ts: the playbook's rules are DATA the
 * template writes once, then ordinary editable rules. Re-seeding never
 * removes or rewrites a rule the analyst already has — a rule in the same
 * bucket is the analyst's own choice and stays; a rule the template doesn't
 * know is kept and listed as such. Adds go through the same write path the
 * Triggers tab uses, so the eligibility rules hold.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { seatStandingTriggers } from "@/lib/agent/knowledge/seat-rules";
import { parseLevelTriggers } from "./load-levels";
import { triggerBucket } from "./bucket";
import { predicateSentence, actionLabel } from "./format";
import type { Trigger } from "./types";

export interface ReseedDiff {
  seatName: string;
  /** The template has a rule this analyst lacks (by bucket). */
  toAdd: Trigger[];
  /** The analyst already has a rule in this bucket — kept as is, even if its number differs. */
  present: Array<{ template: Trigger; existing: Trigger }>;
  /** Rules on the analyst the template doesn't know — kept. */
  foreign: Trigger[];
}

/** Pure: the diff between the seat's template and what the analyst carries. */
export function reseedDiff(seatName: string, existing: Trigger[], mintId: () => string = randomUUID): ReseedDiff {
  const template = seatStandingTriggers(seatName, mintId);
  const byBucket = new Map(existing.map((t) => [triggerBucket(t), t] as const));
  const templateBuckets = new Set(template.map(triggerBucket));
  const toAdd: Trigger[] = [];
  const present: ReseedDiff["present"] = [];
  for (const t of template) {
    const hit = byBucket.get(triggerBucket(t));
    if (hit) present.push({ template: t, existing: hit });
    else toAdd.push(t);
  }
  const foreign = existing.filter((t) => !templateBuckets.has(triggerBucket(t)));
  return { seatName, toAdd, present, foreign };
}

/** One line per rule, for the dialog and the audit log. */
export function describeSeatRule(t: Trigger): string {
  return `${predicateSentence(t.predicate)} — ${actionLabel(t.action, true)}`;
}

/**
 * Seed a freshly created analyst. Writes only when the analyst has no rules
 * of its own yet and its seat has a template; a blank tab on an unknown
 * seat stays blank rather than guessing. Fail-soft: creation never fails
 * because seeding did.
 */
export async function seedAnalystTriggers(analystId: string): Promise<number> {
  try {
    const analyst = await prisma.agentConfig.findUnique({
      where: { id: analystId },
      select: { id: true, name: true, triggers: true },
    });
    if (!analyst) return 0;
    const existing = parseLevelTriggers(analyst.triggers, `analyst=${analystId}`);
    if (existing.length > 0) return 0;
    const seeded = seatStandingTriggers(analyst.name, randomUUID);
    if (seeded.length === 0) return 0;
    await prisma.agentConfig.update({
      where: { id: analystId },
      data: { triggers: seeded as unknown as object },
    });
    return seeded.length;
  } catch (err) {
    console.warn(`[seedAnalystTriggers] ${analystId}:`, err instanceof Error ? err.message : err);
    return 0;
  }
}
