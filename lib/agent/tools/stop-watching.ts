/**
 * stop_watching — a stock we watch, dropped: the thesis retires as DROPPED with
 * the reason as its last line, as a fired Stop watching trigger retires it
 * (lib/agent/triggers/stop-watching.ts). A stock we never covered is passed on
 * with pass_on_stock; a stock we hold is sold. The rules are the save's
 * (`saveThesis`, update-thesis.ts).
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { inOwnWords, saveThesis } from "@/lib/agent/tools/update-thesis";

const schema = z.object({
  thesis_id: z.string().describe("The stock's thesis id."),
  reason: z.string().min(10).describe("Why we stop watching it, by How you write: what changed with the company or the stock."),
});

export const stopWatching = defineTool({
  description: "For a stock we watch: stops watching it, and its thesis is retired as dropped with your reason as its last line. A stock we hold is sold with sell.",
  schema,
  // A one-stock run stops watching its own stock.
  schemaFor: (ctx) => (ctx.runStock ? schema.omit({ thesis_id: true }) : schema),
  fromRun: (ctx) => (ctx.runStock ? { thesis_id: ctx.runStock.thesisId } : null),
  ui: "thesis-card" as const,
  gateLog: "stop_watching",
  progressLabel: () => "Stopping the watch",
  execute: async (args, ctx) => inOwnWords(await saveThesis({ thesis_id: args.thesis_id, change_status: "ARCHIVED", rationale: args.reason }, ctx), "stop_watching"),
});
