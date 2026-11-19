/**
 * set_catalyst_date — the day a stock's dated event lands, as the company
 * announced it. The pre-catalyst playbook's triggers count the days to it.
 * Agents sent it 7 times in the 90 days to 2026-11-18. The rules are the
 * save's (`saveThesis`, update-thesis.ts).
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { saveThesis } from "@/lib/agent/tools/update-thesis";
import { thesisFields } from "@/lib/agent/tools/thesis-fields";

const F = thesisFields();

export const setCatalystDate = defineTool({
  description: "Sets the day a stock's dated event lands (an earnings date, a trial readout), as the company announced it; the pre-catalyst triggers count the days to it.",
  schema: z.object({
    thesis_id: z.string().describe("The stock's thesis id."),
    catalyst_date: F.catalyst_date,
  }),
  ui: "thesis-card" as const,
  gateLog: "set_catalyst_date",
  progressLabel: () => "Setting the catalyst date",
  execute: (args, ctx) => saveThesis({ thesis_id: args.thesis_id, catalyst_date: args.catalyst_date }, ctx),
});
