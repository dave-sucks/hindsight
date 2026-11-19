/**
 * edit_triggers — a stock's triggers, one at a time: add, edit by id, remove
 * by id, and the playbook they are written on. The one place the trigger
 * shape lives among the action tools; every rule (the owner's hand edit wins,
 * only the owner lowers a sale's price, a seed is the Writer's) is the save's
 * (`saveThesis`, update-thesis.ts) through lib/agent/triggers/ops.ts.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { saveThesis } from "@/lib/agent/tools/update-thesis";
import { TRIGGER_EDITS } from "@/lib/agent/tools/thesis-fields";
import { triggerInputSchema, triggersInputArraySchema, editTriggerOpSchema } from "@/lib/agent/triggers/schema";
import { NO_SETUP_FITS, SETUP_IDS } from "@/lib/agent/knowledge/setups";
import { isManagerRun } from "@/lib/agent/portfolio-manager/limits";

const schema = z.object({
  thesis_id: z.string().describe("The stock's thesis id."),
  add: triggersInputArraySchema.optional().describe(TRIGGER_EDITS.add),
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
  add: z.array(triggerInputSchema.omit({ fireMode: true })).max(20).optional().describe(TRIGGER_EDITS.add),
  edit: z.array(editTriggerOpSchema.omit({ fire_mode: true })).optional().describe(TRIGGER_EDITS.edit),
});

export const editTriggers = defineTool({
  description:
    "Adds, edits or removes a stock's triggers, one at a time by id; each edit comes back in `trigger_ops`, accepted or refused with the reason, and a refused one leaves the rest in place. " +
    "On a stock we hold, only the principal moves a safety line down. If you think one is wrong, keep it and give the number you'd suggest in your note.",
  schema,
  // A trigger run edits its own stock (tactical-run.ts). The playbook is named by the morning run and the chat, as update_thesis's setup_id was.
  schemaFor: (ctx) => (ctx.runStock ? schema.omit({ thesis_id: true, setup_id: true }) : isManagerRun(ctx) ? managerSchema : schema),
  fromRun: (ctx) => (ctx.runStock ? { thesis_id: ctx.runStock.thesisId } : null),
  ui: "thesis-card" as const,
  gateLog: "edit_triggers",
  progressLabel: () => "Editing triggers",
  execute: async (args, ctx) => {
    if (!args.add?.length && !args.edit?.length && !args.remove?.length && args.setup_id === undefined) {
      const message = "Nothing to change: send at least one trigger in add, edit (by id) or remove (by id), or the playbook in setup_id.";
      return { summary: message, data: { ok: false, error: "no_trigger_ops", message }, sources: [] };
    }
    // A fire mode the Portfolio Manager sends anyway is dropped here too: the edit items pass unknown keys through.
    const manager = isManagerRun(ctx);
    const add = manager ? args.add?.map(({ fireMode: _f, ...t }) => (void _f, t)) : args.add;
    const edit = manager ? args.edit?.map(({ fire_mode: _f, ...e }) => (void _f, e)) : args.edit;
    // On a trigger run the fire's price stands in when the quote fails (a buy's side is read off it).
    return saveThesis(
      { thesis_id: args.thesis_id, trigger_id: ctx.runStock?.triggerId, add_triggers: add, edit_triggers: edit, remove_trigger_ids: args.remove?.map((r) => r.id), setup_id: manager ? undefined : args.setup_id },
      ctx,
      { removeReasons: Object.fromEntries((args.remove ?? []).flatMap((r) => (r.reason?.trim() ? [[r.id, r.reason.trim()]] : []))) },
    );
  },
});
