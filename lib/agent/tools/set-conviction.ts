/**
 * set_conviction — the owner's own change to a stock's conviction or outlook,
 * from the chat, with the reason. An analyst's run changes them only in the
 * note that ends a review, with that review's verdict (write_note,
 * lib/agent/thesis-review.ts), so this tool is on no run's list.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { saveThesis } from "@/lib/agent/tools/update-thesis";
import { thesisFields } from "@/lib/agent/tools/thesis-fields";

const F = thesisFields();

export const setConviction = defineTool({
  description: "Changes a stock's conviction or its outlook, each with its reason; one line in its Activity.",
  schema: z.object({
    thesis_id: z.string().describe("The stock's thesis id."),
    conviction: F.conviction.optional(),
    conviction_rationale: F.conviction_rationale.optional(),
    outlook: F.outlook.optional(),
    opinion: F.opinion.optional(),
  }),
  ui: "thesis-card" as const,
  gateLog: "set_conviction",
  progressLabel: (args) => (args.conviction ? `Setting conviction ${args.conviction}` : `Setting outlook ${args.outlook ?? ""}`),
  execute: (args, ctx) =>
    saveThesis({ thesis_id: args.thesis_id, conviction: args.conviction, conviction_rationale: args.conviction_rationale, outlook: args.outlook, opinion: args.opinion }, ctx),
});
