/**
 * playbooks.ts — an account's playbooks: per setup, the stored list of
 * trigger templates Settings → Playbook shows. Unseeded, an account has the
 * catalog's (./playbook-templates); seeded (`Account.playbooksSeededAt`), its
 * own list is the whole truth, an empty one included. The loader is
 * ./load-playbook (prisma); this file is pure.
 */

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { triggerSchema } from "@/lib/agent/triggers/schema";
import { actionProblem, refusalOf, sentenceOf, shapeOf } from "@/lib/agent/triggers/condition";
import { triggerSlot } from "@/lib/agent/triggers/condition/slot";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { TriggerOp } from "@/lib/agent/triggers/ops";
import { WRITTEN_ON, type Template } from "./playbook-templates";
import { PLACEHOLDERS, SETUPS, fillTemplate, templatePlaceholders, type TemplatePredicate } from "./setups";

/** A template: a stored trigger's own fields, a condition that may name a chart level, and when it is written. */
export const templateSchema = triggerSchema
  .pick({ action: true, rationale: true, fireMode: true, trimPct: true, cooldownDays: true })
  .extend({ predicate: z.unknown(), writtenOn: z.enum(WRITTEN_ON) })
  .superRefine((t, ctx) => {
    const refuse = (message: string) => ctx.addIssue({ code: "custom", message });
    if (!shapeOf(t.predicate)) return refuse(refusalOf(t.predicate) ?? "Not a condition.");
    const marks = templatePlaceholders(t.predicate as TemplatePredicate);
    const unknown = marks.find((m) => !Object.hasOwn(PLACEHOLDERS, m));
    if (unknown) return refuse(`${unknown} isn't a chart level a template can name: ${Object.keys(PLACEHOLDERS).join(", ")}.`);
    if (t.writtenOn === "FILL" && marks.length) return refuse("A fill template is written as listed. A number that depends on the chart or the buy is filled by the run with the buy proposal.");
    const problem = refusalOf(fillTemplate(t.predicate as TemplatePredicate, () => 1)) ?? actionProblem(t.action, { held: t.writtenOn !== "WATCH" });
    if (problem) refuse(problem);
  });

/** One playbook's stored list, keeping the templates that still parse. */
function parseList(raw: unknown): Template[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((t) => {
    const one = templateSchema.safeParse(t);
    return one.success ? [one.data as Template] : [];
  });
}

/** A playbook's templates for an account: its own list once seeded, else the catalog's. */
export function playbookTemplates(account: { playbooks: unknown; playbooksSeededAt: Date | null } | null, setupId: string): Template[] {
  const catalog = SETUPS.find((s) => s.id === setupId)?.triggers ?? [];
  if (!account?.playbooksSeededAt) return catalog;
  const stored = account.playbooks && typeof account.playbooks === "object" ? (account.playbooks as Record<string, unknown>)[setupId] : undefined;
  return parseList(stored);
}

/**
 * A fill's lines from the playbook: each fill template as an ordinary stock
 * trigger, except where the stock already has a line of the same kind. That
 * one is left as it is, and `kept` says which template wasn't written.
 */
export function fillTemplateOps(templates: Template[], stored: Trigger[], mintId: () => string = randomUUID): { ops: TriggerOp[]; kept: Array<{ op: "kept"; id: string; text: string }> } {
  const taken = new Map(stored.map((t) => [triggerSlot(t), t]));
  const ops: TriggerOp[] = [];
  const kept: Array<{ op: "kept"; id: string; text: string }> = [];
  for (const { writtenOn, predicate, ...rest } of templates) {
    if (writtenOn !== "FILL") continue;
    const trigger: Trigger = { ...rest, id: mintId(), predicate: predicate as Trigger["predicate"], source: "DEFAULT" };
    const there = taken.get(triggerSlot(trigger));
    if (there) kept.push({ op: "kept", id: there.id, text: `Kept ${sentenceOf(there)}; the playbook's ${sentenceOf(trigger)} not written` });
    else ops.push({ op: "add", trigger });
  }
  return { ops, kept };
}
