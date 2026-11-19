/**
 * edit_triggers — a stock's triggers, one at a time: add, edit by id, remove
 * by id, and the playbook they are written on. The one place the trigger
 * shape lives among the action tools; every rule (the owner's hand edit wins,
 * only the owner lowers a sale's price, a seed is the Writer's) is the save's
 * (`saveThesis`, update-thesis.ts) through lib/agent/triggers/ops.ts.
 *
 * An add is one of the stock's playbook triggers by its reference (W1, H2), or
 * a trigger of the agent's own, where a number may be a chart key ({gapDayHigh}).
 * Code writes today's number for both from the chart (`pricedTemplate`,
 * lib/agent/knowledge/playbooks.ts) before the save.
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { defineTool } from "@/lib/agent/define-tool";
import type { ToolContext } from "@/lib/agent/tool-context";
import { saveThesis } from "@/lib/agent/tools/update-thesis";
import { TRIGGER_EDITS } from "@/lib/agent/tools/thesis-fields";
import { CHART_KEY, editTriggerOpSchema, isChartKey, predicateInputSchema, triggerInputSchema, triggerPredicateSchema, triggersInputArraySchema } from "@/lib/agent/triggers/schema";
import { NO_SETUP_FITS, PLACEHOLDERS, SETUP_IDS, fillTemplate, getSetup, isNamedSetup, type Placeholder, type TemplatePredicate } from "@/lib/agent/knowledge/setups";
import { PLAYBOOK_UNREAD, fillValue, missingKeys, playbookRefs, pricedTemplate, templateSentence, type FillPrices } from "@/lib/agent/knowledge/playbooks";
import { loadPlaybook } from "@/lib/agent/knowledge/load-playbook";
import { loadFillChart } from "@/lib/proposals/fill-chart";
import { parseTriggersResilient } from "@/lib/agent/triggers/schema";
import { levelSlotOf, typedPriceOf } from "@/lib/agent/triggers/price-levels";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { isManagerRun } from "@/lib/agent/portfolio-manager/limits";
import type { Trigger } from "@/lib/agent/triggers/types";
import { collision, type TriggerOpResult } from "@/lib/agent/triggers/ops";
import type { Template } from "@/lib/agent/knowledge/playbook-templates";

/** One of the stock's playbook triggers, by its reference as the playbook lists it. */
const playbookTrigger = z.object({
  playbook_trigger: z.string().describe("A trigger of the stock's playbook by its reference as the playbook lists it (W1, H2). Code prices it from today's chart."),
  rationale: z.string().optional().describe("Your note on it, when the playbook's reason isn't the one you'd give."),
});

/** A trigger of the agent's own: a price or a move may be a chart key, whose number code writes. */
const ownTrigger = triggerInputSchema.omit({ playbook: true }).extend({ predicate: predicateInputSchema({ keys: true }) });

const schema = z.object({
  thesis_id: z.string().describe("The stock's thesis id."),
  add: z
    .array(z.union([playbookTrigger, ownTrigger]))
    .max(20)
    .optional()
    .describe(
      `${TRIGGER_EDITS.add} Each is one of the stock's playbook triggers by its reference, or one of your own with its reason, ` +
        `where a price may be a chart key code fills with today's number: ${Object.keys(PLACEHOLDERS).join(", ")}.`,
    ),
  edit: z.array(editTriggerOpSchema).optional().describe(TRIGGER_EDITS.edit),
  // Each op is an object with its reason, so a later field (a playbook reference, a key's value) is an addition, not a rename.
  remove: z
    .array(
      z.object({
        id: z.string().describe("The trigger's id, as shown on the thesis."),
        // Read by saveThesis onto the removal's Activity record (fieldChanges.triggerOps).
        reason: z.string().optional().describe("Why it comes off, in a sentence."),
      }),
    )
    .optional()
    .describe("Triggers to remove, each by its id, with why it comes off."),
  setup_id: z
    .enum([...SETUP_IDS, NO_SETUP_FITS])
    .optional()
    .describe("The playbook these triggers are written on, or NONE when none fits; on a stock we hold, naming one writes its triggers written at the fill."),
});

/** The Portfolio Manager's triggers take each action's default On fire (a sale or trim asks an agent): its trades always wait for the owner. */
const managerSchema = schema.omit({ setup_id: true }).extend({
  add: z.array(z.union([playbookTrigger, ownTrigger.omit({ fireMode: true })])).max(20).optional().describe(schema.shape.add.description ?? TRIGGER_EDITS.add),
  edit: z.array(editTriggerOpSchema.omit({ fire_mode: true })).optional().describe(TRIGGER_EDITS.edit),
});

/** The Writer, the Holding refresh and After the buy price from the chart: a price is a key or a line, never a typed number; any other number stays one. */
const writerOwnTrigger = triggerInputSchema.omit({ playbook: true }).extend({ predicate: predicateInputSchema({ keys: true, noTypedPrices: true }) });
const writerEdit = z.object(editTriggerOpSchema.shape).extend({
  value: z.number().optional().describe("The new number when the trigger is not a price: a %, a day count, a volume multiple."),
  price: z.string().regex(CHART_KEY).optional().describe("A price trigger's new price, as a chart key ({swingLow}): code writes today's number. To put a price on a line (the 50-day average), remove it and add one."),
});
const writerSchema = schema.omit({ thesis_id: true, setup_id: true }).extend({
  add: z
    .array(z.union([playbookTrigger, writerOwnTrigger]))
    .max(20)
    .optional()
    .describe(
      `${TRIGGER_EDITS.add} Each is one of the stock's playbook triggers by its reference, or one of your own with its reason, ` +
        `where a price is a line (the 50-day average) or a chart key code fills with today's number: ${Object.keys(PLACEHOLDERS).join(", ")}. Never a typed price.`,
    ),
  edit: z.array(writerEdit).optional().describe(`${TRIGGER_EDITS.edit} A price moves to a chart key, in \`price\`.`),
});
/** The Writer's and the Holding refresh's call after the save, and After the buy's (lib/proposals/after-buy.ts). */
const pricesFromTheChart = (ctx: ToolContext) => (ctx.runMode === "THESIS_WRITER" || ctx.runMode === "AFTER_BUY") && !!ctx.runStock;

/** The chat's: its own triggers as #1050 sent them. It writes triggers from the owner's words, so it takes no playbook reference and no chart key. */
const chatSchema = schema.extend({ add: triggersInputArraySchema.optional().describe(TRIGGER_EDITS.add) });

export type Add = z.infer<typeof schema>["add"] extends Array<infer A> | undefined ? A : never;
export type Edit = z.infer<typeof writerEdit>;
type Ref = z.infer<typeof playbookTrigger>;
const isRef = (a: Add): a is Ref => typeof (a as Ref).playbook_trigger === "string";

/** Every key a condition names. */
function keysIn(p: unknown): string[] {
  if (!p || typeof p !== "object") return [];
  const c = p as { match?: string; conditions?: unknown[]; value?: unknown };
  return c.match === "all" && Array.isArray(c.conditions) ? c.conditions.flatMap(keysIn) : isChartKey(c.value) ? [c.value] : [];
}

/** What pricing an add reads: the stock, its playbook's templates (null when unread or none), and the chart, buy and sell price. */
export interface AddPricing {
  ticker: string;
  held: boolean;
  setupId: string | null;
  templates: Template[] | null;
  at: FillPrices;
  /** The triggers the principal wrote on the stock, and its direction: a playbook trigger never replaces one of them (#1003). */
  owners?: Trigger[];
  direction?: string | null;
}

/** True when an add names a playbook trigger or a key, so pricing has something to read. */
export const needsPricing = (adds: Add[]) => adds.some((a) => isRef(a) || keysIn((a as { predicate?: unknown }).predicate).length > 0);

/** The stock, its playbook, its position and (when a key or a reference needs it) the chart, read for priceAddsWith and priceEditsWith. */
async function loadPricing(args: { thesis_id: string; setup_id?: string }, ctx: ToolContext, needChart: boolean): Promise<{ p: AddPricing; stored: Trigger[] } | null> {
  const thesis = await prisma.thesis.findUnique({ where: { id: args.thesis_id }, select: { ticker: true, status: true, setupId: true, direction: true, triggers: true, userId: true } });
  // A thesis the save can't find or doesn't own refuses the call itself.
  if (!thesis || thesis.userId !== ctx.userId) return null;
  const held = thesis.status === "HOLDING";
  const setupId = isNamedSetup(args.setup_id) ? args.setup_id : thesis.setupId;
  const stored = parseTriggersResilient(thesis.triggers).triggers as Trigger[];
  const floor = stored.find((t) => levelSlotOf(t, thesis.direction) === "FLOOR" && t.action === "EXIT");
  const position = held && ctx.analystId
    ? await prisma.position.findFirst({ where: { analystId: ctx.analystId, symbol: thesis.ticker, status: "OPEN" }, select: { avgCost: true }, orderBy: { openedAt: "desc" } }).catch(() => null)
    : null;
  const at: FillPrices = { chart: needChart ? await loadFillChart(thesis.ticker) : null, buy: position?.avgCost != null ? Number(position.avgCost) : null, sale: floor ? typedPriceOf(floor) : null };
  const templates = isNamedSetup(setupId) ? await loadPlaybook(ctx.accountId, setupId) : null;
  return { p: { ticker: thesis.ticker, held, setupId, templates, at, owners: stored.filter((t) => t.source === "PRINCIPAL"), direction: thesis.direction }, stored };
}

/**
 * Each edit as the save takes it: a price moved to a key is written as
 * today's number. For the Writer, a typed number on a price trigger comes back
 * with the fix: its schema can't tell a price's id from a %'s. Pure.
 */
export function priceEditsWith(edits: Edit[], p: Pick<AddPricing, "at">, stored: Trigger[], writer: boolean): { edits: Edit[]; refused: TriggerOpResult[] } {
  const out: Edit[] = [];
  const refused: TriggerOpResult[] = [];
  const refuse = (id: string, reason: string) => refused.push({ op: "edit", id, ok: false, text: `Edit trigger ${id}`, reason });
  for (const e of edits) {
    if (typeof e.price === "string") {
      if (!Object.hasOwn(PLACEHOLDERS, e.price)) { refuse(e.id, `${e.price} isn't a key. The keys are ${Object.keys(PLACEHOLDERS).join(", ")}.`); continue; }
      const n = fillValue(e.price as Placeholder, p.at);
      if (n == null) { refuse(e.id, `Not moved: ${missingKeys([e.price as Placeholder], p.at)}. Use another key, or leave it.`); continue; }
      const { price: _price, ...rest } = e;
      void _price;
      out.push({ ...rest, value: n });
      continue;
    }
    const target = stored.find((t) => t.id === e.id);
    if (writer && typeof e.value === "number" && target && typedPriceOf(target) != null) {
      refuse(e.id, "A price is a chart key: send it in `price` ({swingLow}), or remove the trigger and add one on a line.");
      continue;
    }
    out.push(e);
  }
  return { edits: out, refused };
}

/**
 * Each add as the save takes it: a reference priced from the playbook, a key
 * written as today's number. One that can't be written comes back with why
 * and what to do instead; the rest go to the save. Pure.
 */
export function priceAddsWith(adds: Add[], p: AddPricing): { adds: unknown[]; refused: TriggerOpResult[] } {
  const { ticker, held, setupId, templates, at } = p;
  const refs = templates ? playbookRefs(templates) : [];
  const out: unknown[] = [];
  const refused: TriggerOpResult[] = [];
  const refuse = (text: string, reason: string) => refused.push({ op: "add", id: "", ok: false, text, reason });
  for (const a of adds) {
    if (isRef(a)) {
      const ref = a.playbook_trigger.trim().toUpperCase();
      const text = `Added: ${ref}`;
      if (!isNamedSetup(setupId)) { refuse(text, `${ref} names a playbook trigger, and $${ticker} has no playbook. Name one with setup_id, or write the trigger yourself.`); continue; }
      if (!templates) { refuse(text, `${PLAYBOOK_UNREAD}. Write the trigger yourself.`); continue; }
      const found = refs.find((r) => r.ref === ref);
      if (!found) { refuse(text, `$${ticker}'s playbook (${getSetup(setupId)?.name ?? setupId}) has no ${ref}: its triggers are ${refs.map((r) => r.ref).join(", ") || "none"}.`); continue; }
      const watchRef = found.template.writtenOn === "WATCH";
      if (watchRef === held) { refuse(`Added: ${ref} · ${templateSentence(found.template)}`, held ? `${ref} is a watch's trigger, and we own $${ticker}: a holding takes the H triggers.` : `${ref} is a holding's trigger, and we only watch $${ticker}: a watch takes the W triggers.`); continue; }
      const priced = pricedTemplate(found.template, at);
      if ("missing" in priced) { refuse(`Added: ${ref} · ${templateSentence(found.template)}`, `Not written: ${missingKeys(priced.missing, at)}. Write the trigger yourself with a price from the chart, or leave it.`); continue; }
      // A playbook trigger never replaces one the principal wrote (it would land in the same slot as an edit of theirs).
      const his = p.owners?.length ? collision(p.owners, { ...priced.trigger, id: "" } as Trigger, p.direction ?? null) : undefined;
      if (his) { refuse(`Added: ${ref} · ${sentenceOf({ ...priced.trigger, id: "" } as Trigger)}`, `The principal wrote ${sentenceOf(his)} on $${ticker}, and ${ref} would replace it: theirs stays. To change theirs, edit it by id with your reason.`); continue; }
      out.push({ ...priced.trigger, ...(a.rationale?.trim() ? { rationale: a.rationale.trim() } : {}) });
      continue;
    }
    const keys = keysIn(a.predicate);
    if (!keys.length) { out.push(a); continue; }
    const text = `Added: ${sentenceOf(a as unknown as Trigger)}`;
    const unknown = keys.filter((k) => !Object.hasOwn(PLACEHOLDERS, k));
    if (unknown.length) { refuse(text, `${unknown.join(", ")} isn't a key. The keys are ${Object.keys(PLACEHOLDERS).join(", ")}; or write the number.`); continue; }
    const missing = (keys as Placeholder[]).filter((k) => fillValue(k, at) == null);
    if (missing.length) { refuse(text, `Not written: ${missingKeys(missing, at)}. Write the number from the chart instead, or leave it.`); continue; }
    const predicate = triggerPredicateSchema.safeParse(fillTemplate(a.predicate as unknown as TemplatePredicate, (k) => fillValue(k, at)!));
    if (!predicate.success) { refuse(text, predicate.error.issues[0]?.message ?? "The condition can't be read."); continue; }
    out.push({ ...a, predicate: predicate.data });
  }
  return { adds: out, refused };
}

export const editTriggers = defineTool({
  description:
    "Adds, edits or removes a stock's triggers, one at a time by id; each edit comes back in `trigger_ops`, accepted or refused with the reason, and a refused one leaves the rest in place. " +
    "On a stock we hold, only the principal moves a safety line down. If you think one is wrong, keep it and give the number you'd suggest in your note.",
  schema,
  // A trigger run, the Writer and After the buy edit their own stock (tactical-run.ts, run-thesis-writer.ts, after-buy-run.ts); the Writer and After the buy price from the chart. The playbook is named by the morning run and the chat, as update_thesis's setup_id was.
  schemaFor: (ctx) => (pricesFromTheChart(ctx) ? writerSchema : ctx.runStock ? schema.omit({ thesis_id: true, setup_id: true }) : isManagerRun(ctx) ? managerSchema : ctx.runMode === "PRINCIPAL_CHAT" ? chatSchema : schema),
  fromRun: (ctx) => (ctx.runStock ? { thesis_id: ctx.runStock.thesisId } : null),
  ui: "thesis-card" as const,
  gateLog: "edit_triggers",
  progressLabel: () => "Editing triggers",
  execute: async (args, ctx) => {
    if (!args.add?.length && !args.edit?.length && !args.remove?.length && args.setup_id === undefined) {
      const message = "Nothing to change: send at least one trigger in add, edit (by id) or remove (by id), or the playbook in setup_id.";
      return { summary: message, data: { ok: false, error: "no_trigger_ops", message }, sources: [] };
    }
    const writer = pricesFromTheChart(ctx);
    const edits = (args.edit ?? []) as Edit[];
    const keyedEdit = edits.some((e) => typeof e.price === "string");
    const needChart = needsPricing(args.add ?? []) || keyedEdit;
    const loaded = needChart || (writer && edits.some((e) => typeof e.value === "number")) ? await loadPricing(args, ctx, needChart) : null;
    const addsPriced = loaded ? priceAddsWith(args.add ?? [], loaded.p) : { adds: args.add ?? [], refused: [] };
    const editsPriced = loaded ? priceEditsWith(edits, loaded.p, loaded.stored, writer) : { edits, refused: [] };
    const priced = addsPriced.adds;
    const refused = [...addsPriced.refused, ...editsPriced.refused];
    const nothingElse = !priced.length && !editsPriced.edits.length && !args.remove?.length && args.setup_id === undefined;
    if (refused.length && nothingElse) {
      return { summary: `No trigger change: ${refused.map((r) => r.reason).join(" ")}`, data: { ok: false, error: "not_written", message: refused.map((r) => `${r.text} — ${r.reason}`).join(" "), trigger_ops: refused } };
    }
    // A fire mode the Portfolio Manager sends anyway is dropped here too: the edit items pass unknown keys through.
    const manager = isManagerRun(ctx);
    const adds = manager ? (priced as Array<{ fireMode?: unknown }>).map(({ fireMode: _f, ...t }) => (void _f, t)) : priced;
    const edit = manager ? editsPriced.edits.map(({ fire_mode: _f, ...e }) => (void _f, e)) : editsPriced.edits;
    // On a trigger run the fire's price stands in when the quote fails (a buy's side is read off it).
    const saved = await saveThesis(
      { thesis_id: args.thesis_id, trigger_id: ctx.runStock?.triggerId || undefined, add_triggers: adds as never, edit_triggers: edit, remove_trigger_ids: args.remove?.map((r) => r.id), setup_id: manager ? undefined : args.setup_id },
      ctx,
      { removeReasons: Object.fromEntries((args.remove ?? []).flatMap((r) => (r.reason?.trim() ? [[r.id, r.reason.trim()]] : []))) },
    );
    if (!refused.length) return saved;
    const data = saved.data as Record<string, unknown>;
    return { ...saved, data: { ...data, trigger_ops: [...refused, ...(Array.isArray(data.trigger_ops) ? data.trigger_ops : [])] } };
  },
});
