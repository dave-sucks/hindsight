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
import { triggersInputArraySchema, editTriggerOpSchema } from "@/lib/agent/triggers/schema";
import { NO_SETUP_FITS, SETUP_IDS } from "@/lib/agent/knowledge/setups";
import { isManagerRun } from "@/lib/agent/portfolio-manager/limits";

const schema = z.object({
  thesis_id: z.string().describe("The stock's thesis id."),
  add: triggersInputArraySchema.optional().describe(TRIGGER_EDITS.add),
  edit: z.array(editTriggerOpSchema).optional().describe(TRIGGER_EDITS.edit),
  remove: z.array(z.string()).optional().describe(TRIGGER_EDITS.remove),
  setup_id: z
    .enum([...SETUP_IDS, NO_SETUP_FITS])
    .optional()
    .describe("The playbook these triggers are written on, or NONE when none fits; on a stock we hold, naming one writes its triggers written at the fill."),
});

export const editTriggers = defineTool({
  description:
    "Adds, edits or removes a stock's triggers, one at a time by id; each edit comes back in `trigger_ops`, accepted or refused with the reason, and a refused one leaves the rest in place. " +
    "On a stock we hold only the owner moves a sale's price down: if you think one is wrong, keep it and give the price you'd suggest in your note.",
  schema,
  // A trigger run edits its own stock (tactical-run.ts). The playbook is named by the morning run and the chat, as update_thesis's setup_id was.
  schemaFor: (ctx) => (ctx.runStock ? schema.omit({ thesis_id: true, setup_id: true }) : isManagerRun(ctx) ? schema.omit({ setup_id: true }) : schema),
  fromRun: (ctx) => (ctx.runStock ? { thesis_id: ctx.runStock.thesisId } : null),
  ui: "thesis-card" as const,
  gateLog: "edit_triggers",
  progressLabel: () => "Editing triggers",
  // On a trigger run the fire's price stands in when the quote fails (a buy's side is read off it).
  execute: (args, ctx) =>
    saveThesis(
      { thesis_id: args.thesis_id, trigger_id: ctx.runStock?.triggerId, add_triggers: args.add, edit_triggers: args.edit, remove_trigger_ids: args.remove, setup_id: args.setup_id },
      ctx,
    ),
});
