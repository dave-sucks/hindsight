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
import { MEASURES, actionProblem, refusalOf, sentenceOf, shapeOf } from "@/lib/agent/triggers/condition";
import { triggerSlot } from "@/lib/agent/triggers/condition/slot";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { TriggerOp } from "@/lib/agent/triggers/ops";
import { fireModeLabel } from "@/lib/agent/triggers/fire-mode";
import { TRIGGER_LIST_NAME, WRITTEN_ON, type Template, type WrittenOn } from "./playbook-templates";
import { PLACEHOLDERS, SETUPS, fillTemplate, templatePlaceholders, type Placeholder, type TemplatePredicate } from "./setups";

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

export const PLAYBOOK_UNREAD = "The playbook couldn't be read, so none of its triggers were written";

/** A template's condition as an agent writes it: an average or a high a measure reads in place of a number goes in `value`. */
function asWritten(p: TemplatePredicate): unknown {
  if ("match" in p) return { match: p.match, conditions: p.conditions.map(asWritten) };
  const { variable, ...rest } = p;
  return variable && MEASURES[p.watch]?.variables?.mode === "replace" ? { ...rest, value: variable } : p;
}

/**
 * One of a playbook's lists of triggers, for an agent's prompt: each as the
 * trigger sentence Settings → Playbook shows, the trigger as the agent writes
 * it, and its reason; then where each {chart number} it names comes from.
 * The agent fills every price.
 */
export function playbookTriggerText(templates: Template[] | null, on: WrittenOn): string[] {
  if (templates == null) return ["The playbook couldn't be read: write no trigger from it."];
  const mine = templates.filter((t) => t.writtenOn === on);
  if (!mine.length) return [`${TRIGGER_LIST_NAME[on]}: none.`];
  const marks = [...new Set(mine.flatMap((t) => templatePlaceholders(t.predicate)))] as Placeholder[];
  return [
    `${TRIGGER_LIST_NAME[on]}:`,
    ...mine.map((t) => {
      const written = { action: t.action, predicate: asWritten(t.predicate), ...(t.fireMode ? { fireMode: t.fireMode } : {}) };
      return `- ${sentenceOf(t as unknown as Trigger)}${t.fireMode ? ` (${fireModeLabel(t.fireMode, t.action)})` : ""}: ${JSON.stringify(written)} — ${t.rationale}`;
    }),
    ...(marks.length ? [`Where each chart number comes from: ${marks.map((m) => `${m} ${PLACEHOLDERS[m]}`).join("; ")}.`] : []),
  ];
}

/**
 * A fill's lines from the playbook: each fill template as an ordinary stock
 * trigger, except where the stock already has a line of the same kind. That
 * one is left as it is, and `notWritten` says which template wasn't written.
 * A playbook that couldn't be read (null) writes nothing and says so.
 */
export function fillTemplateOps(templates: Template[] | null, stored: Trigger[], mintId: () => string = randomUUID): { ops: TriggerOp[]; notWritten: Array<{ op: "kept"; id: string; text: string }> } {
  if (templates == null) return { ops: [], notWritten: [{ op: "kept", id: "", text: PLAYBOOK_UNREAD }] };
  const taken = new Map(stored.map((t) => [triggerSlot(t), t]));
  const ops: TriggerOp[] = [];
  const notWritten: Array<{ op: "kept"; id: string; text: string }> = [];
  for (const { writtenOn, predicate, ...rest } of templates) {
    if (writtenOn !== "FILL") continue;
    const trigger: Trigger = { ...rest, id: mintId(), predicate: predicate as Trigger["predicate"], source: "DEFAULT", playbook: "FILL" };
    const there = taken.get(triggerSlot(trigger));
    if (there) notWritten.push({ op: "kept", id: there.id, text: `Kept ${sentenceOf(there)}; the playbook's ${sentenceOf(trigger)} not written` });
    else ops.push({ op: "add", trigger });
  }
  return { ops, notWritten };
}
