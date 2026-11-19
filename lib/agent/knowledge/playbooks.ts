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
import { CHASE_LIMIT_PCT, PLACEHOLDERS, PLACEHOLDER_NAMES, SETUPS, fillTemplate, templatePlaceholders, type Placeholder, type Setup, type TemplatePredicate } from "./setups";
import type { When } from "@/lib/agent/triggers/condition";
import type { PriceStructure } from "@/lib/market-data/price-structure";
import { playbookChecks } from "@/lib/agent/analyst-brief";
import { saleRuleProblem } from "@/lib/agent/position-sizing";

/** A template: a stored trigger's own fields, a condition that may name a chart level, and when it is written. */
export const templateSchema = triggerSchema
  .pick({ action: true, rationale: true, fireMode: true, trimPct: true })
  .extend({ predicate: z.unknown(), writtenOn: z.enum(WRITTEN_ON) })
  .superRefine((t, ctx) => {
    const refuse = (message: string) => ctx.addIssue({ code: "custom", message });
    if (!shapeOf(t.predicate)) return refuse(refusalOf(t.predicate) ?? "Not a condition.");
    const marks = templatePlaceholders(t.predicate as TemplatePredicate);
    const unknown = marks.find((m) => !Object.hasOwn(PLACEHOLDERS, m));
    if (unknown) return refuse(`${unknown} isn't a chart level a template can name: ${Object.keys(PLACEHOLDERS).join(", ")}.`);
    if (t.writtenOn === "FILL" && marks.length) return refuse("A fill template is written as listed. A number that depends on the chart or the buy belongs on a trigger that comes with the buy.");
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
export function asWritten(p: TemplatePredicate | When): unknown {
  if ("match" in p) return { match: p.match, conditions: p.conditions.map(asWritten) };
  const { variable, ...rest } = p;
  return variable && MEASURES[p.watch]?.variables?.mode === "replace" ? { ...rest, value: variable } : p;
}

/** A playbook's triggers by reference: W1, W2… its watch triggers; H1, H2… a holding's (those that come with the buy, then those written at the fill). */
export function playbookRefs(templates: Template[]): Array<{ ref: string; template: Template }> {
  const watch = templates.filter((t) => t.writtenOn === "WATCH").map((template, i) => ({ ref: `W${i + 1}`, template }));
  const held = [...templates.filter((t) => t.writtenOn === "PROPOSAL"), ...templates.filter((t) => t.writtenOn === "FILL")];
  return [...watch, ...held.map((template, i) => ({ ref: `H${i + 1}`, template }))];
}

/** A template's trigger as one sentence, each key followed by its name ("Buy if above {pivot} (the base's high) · only on the close"). */
export function templateSentence(t: Template): string {
  return sentenceOf(t as unknown as Trigger).replace(/\{[A-Za-z0-9]+\}/g, (m) => (PLACEHOLDER_NAMES[m as Placeholder] ? `${m} (${PLACEHOLDER_NAMES[m as Placeholder]})` : m));
}

/**
 * One of a playbook's lists of triggers, for an agent's prompt: one line each,
 * its reference, its sentence with each key, and its reason; then where each
 * key comes from. Code prices a key from the chart when the trigger is written.
 */
export function playbookTriggerText(templates: Template[] | null, on: WrittenOn): string[] {
  if (templates == null) return ["The playbook couldn't be read: write no trigger from it."];
  const mine = playbookRefs(templates).filter((r) => r.template.writtenOn === on);
  if (!mine.length) return [`${TRIGGER_LIST_NAME[on]}: none.`];
  const marks = [...new Set(mine.flatMap((r) => templatePlaceholders(r.template.predicate)))] as Placeholder[];
  return [
    `${TRIGGER_LIST_NAME[on]}:`,
    ...mine.map(({ ref, template: t }) => `- ${ref} · ${templateSentence(t)}${t.fireMode ? ` (${fireModeLabel(t.fireMode, t.action)})` : ""} — ${t.rationale}`),
    ...(marks.length ? [`Where each key comes from: ${marks.map((m) => `${m} is ${PLACEHOLDERS[m]}`).join("; ")}.`] : []),
  ];
}

/**
 * The playbooks an analyst writes a stock's triggers from, each with its words
 * and its watch triggers as Settings → Playbook lists them. The Writer and the
 * trigger run that answers a watch's review read this one block.
 */
export function playbooksBlock(setups: readonly Setup[], playbooks: ((setupId: string) => Template[]) | null): string {
  if (!setups.length) return "";
  return `
═══════════════════════════════════════════════════════════════════
YOUR PLAYBOOKS — the ones you write a stock's triggers from
═══════════════════════════════════════════════════════════════════
${setups.map((s) => [...playbookChecks(s), ...playbookTriggerText(playbooks ? playbooks(s.id) : null, "WATCH")].join("\n  ")).join("\n\n")}
`;
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

/** What a key reads its number from: the chart, the buy (null on a stock we only watch) and its sale price. */
export interface FillPrices {
  chart: PriceStructure | null;
  buy: number | null;
  sale: number | null;
}

/**
 * The number a key stands for, read as PLACEHOLDERS says. Undefined where
 * there is none: no base, no gap, no prior high above the buy, no buy, no chart.
 */
export function fillValue(name: Placeholder, at: FillPrices): number | undefined {
  const c = at.chart;
  const buy = at.buy;
  const above = c?.swings.lastHigh && buy != null && c.swings.lastHigh.price > buy ? c.swings.lastHigh.price : null;
  const values: Record<string, number | null | undefined> = {
    "{pivot}": c?.base?.pivot,
    "{pivotChase}": c?.base ? c.base.pivot * (1 + CHASE_LIMIT_PCT / 100) : null,
    "{flagHigh}": c?.range.high20,
    "{gapDayHigh}": c?.gaps[0]?.high,
    "{gapDayMid}": c?.gaps[0]?.mid,
    "{gapDayLow}": c?.gaps[0]?.low,
    "{swingLow}": c?.swings.lastLow?.price,
    "{high20}": c?.range.high20,
    "{baseLow}": c?.base?.low,
    "{priorHigh}": above,
    // With no chart, whether a prior high is above the buy is unknown: no number.
    "{priorHighOrTwiceRisk}": !c || buy == null ? null : above ?? (at.sale != null && at.sale < buy ? buy + 2 * (buy - at.sale) : null),
    "{low52}": c?.range.low52w,
    "{flagLow}": c?.range.low20,
    "{price}": c?.price,
    "{sellPrice}": at.sale,
    "{riskPct}": at.sale != null && buy != null && buy > 0 ? ((buy - at.sale) / buy) * 100 : null,
  };
  const v = values[name];
  return v != null && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined;
}

/** Why a key has no number today, in a few words. */
export function noNumberWhy(name: Placeholder, at: FillPrices): string {
  if (["{sellPrice}", "{riskPct}", "{priorHigh}", "{priorHighOrTwiceRisk}"].includes(name) && at.buy == null) return "it is measured from our buy, and we don't own the stock";
  if (!at.chart && name !== "{sellPrice}") return "the chart couldn't be read";
  if (["{pivot}", "{pivotChase}", "{baseLow}"].includes(name)) return "the chart has no base";
  if (name.startsWith("{gapDay")) return "the chart has no gap of 3% or more in the last 10 sessions";
  if (name === "{swingLow}") return "the chart has no confirmed swing low";
  if (name === "{priorHigh}" || name === "{priorHighOrTwiceRisk}") return "the chart has no swing high above our buy";
  if (name === "{sellPrice}" || name === "{riskPct}") return "the stock has no sell price";
  return "the chart has no number for it today";
}

/** A template priced from `at`, marked with the list it is on; or the keys with no number today. */
export function pricedTemplate(t: Template, at: FillPrices): { trigger: Omit<Trigger, "id"> } | { missing: Placeholder[] } {
  const { writtenOn, predicate, ...rest } = t;
  const missing = (templatePlaceholders(predicate) as Placeholder[]).filter((m) => fillValue(m, at) == null);
  if (missing.length) return { missing };
  return { trigger: { ...rest, predicate: fillTemplate(predicate, (m) => fillValue(m, at)!) as Trigger["predicate"], playbook: writtenOn } };
}

/** Each key with no number today and why, in one clause ("{gapDayHigh}: the chart has no gap…"). */
export function missingKeys(missing: Placeholder[], at: FillPrices): string {
  return missing.map((m) => `${m}: ${noNumberWhy(m, at)}`).join("; ");
}

/**
 * A playbook's watch triggers, priced from the chart, as an agent's save takes
 * them (`asWritten`), each marked `playbook: "WATCH"`. One whose key the chart
 * doesn't have today is not written, and `notWritten` says which and why.
 */
export function playbookWatchTriggers(templates: Template[], chart: PriceStructure | null): { triggers: Array<Record<string, unknown>>; notWritten: Array<{ ref: string; sentence: string; why: string }> } {
  const at: FillPrices = { chart, buy: null, sale: null };
  const triggers: Array<Record<string, unknown>> = [];
  const notWritten: Array<{ ref: string; sentence: string; why: string }> = [];
  for (const { ref, template } of playbookRefs(templates)) {
    if (template.writtenOn !== "WATCH") continue;
    const priced = pricedTemplate(template, at);
    if ("missing" in priced) notWritten.push({ ref, sentence: sentenceOf(template as unknown as Trigger), why: missingKeys(priced.missing, at) });
    else triggers.push({ ...priced.trigger, predicate: asWritten(priced.trigger.predicate as When) });
  }
  return { triggers, notWritten };
}

/**
 * The floor a buy gets when it names none: the number of the key its
 * playbook's floor words name (`sale.under`, ./setups.ts) on today's chart,
 * held to the playbook's sale rules (saleRuleProblem). Otherwise why not, so
 * the run names the floor itself. Pure.
 */
export function playbookFloor(p: { setup: Setup; horizon: string | null; entry: number; chart: PriceStructure | null; atr: number | null }): { price: number; key: Placeholder } | { refused: string } {
  const key = p.setup.sale.under;
  if (!key) return { refused: "The playbook's floor names no chart key." };
  const at: FillPrices = { chart: p.chart, buy: p.entry, sale: null };
  const price = fillValue(key, at);
  if (price == null) return { refused: `The playbook's floor is ${key} (${PLACEHOLDER_NAMES[key] ?? key}), and ${noNumberWhy(key, at)}.` };
  if (price >= p.entry) return { refused: `The playbook's floor ${key} is $${price.toFixed(2)}, not under the $${p.entry.toFixed(2)} buy.` };
  const bad = saleRuleProblem({ setup: p.setup, horizon: p.horizon, entry: p.entry, stop: price, atr: p.atr });
  return bad ? { refused: `The playbook's floor ${key} at $${price.toFixed(2)} fails its rule: ${bad}.` } : { price, key };
}
