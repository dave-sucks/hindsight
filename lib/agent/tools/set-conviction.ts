/**
 * set_conviction — the analyst's conviction on a stock, with the reason. What
 * is left for a deciding agent of the thesis's own fields (the rest is the
 * Writer's): in the 30 days to 2026-11-18 the morning runs changed the tier 14
 * times. The rules are the save's (`saveThesis`, update-thesis.ts).
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { saveThesis } from "@/lib/agent/tools/update-thesis";
import { thesisFields } from "@/lib/agent/tools/thesis-fields";

const F = thesisFields();

export const setConviction = defineTool({
  description: "Changes your conviction on a stock, with the reason; one line in its Activity.",
  schema: z.object({
    thesis_id: z.string().describe("The stock's thesis id."),
    conviction: F.conviction,
    conviction_rationale: F.conviction_rationale,
  }),
  ui: "thesis-card" as const,
  gateLog: "set_conviction",
  progressLabel: (args) => `Setting conviction ${args.conviction}`,
  execute: (args, ctx) => saveThesis({ thesis_id: args.thesis_id, conviction: args.conviction, conviction_rationale: args.conviction_rationale }, ctx),
});
