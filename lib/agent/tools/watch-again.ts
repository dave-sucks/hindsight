/**
 * watch_again — a stock back on watch: one we sold, or one promoted and not
 * bought again. Its sale triggers come off; its buy goes on with
 * edit_triggers. The rules are the save's (`saveThesis`, update-thesis.ts).
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { saveThesis } from "@/lib/agent/tools/update-thesis";

export const watchAgain = defineTool({
  description: "For a stock we sold, or one promoted and not bought again: puts it back on watch. Its sale triggers come off; give it a buy or a review with edit_triggers.",
  schema: z.object({ thesis_id: z.string().describe("The stock's thesis id.") }),
  ui: "thesis-card" as const,
  gateLog: "watch_again",
  progressLabel: () => "Watching it again",
  execute: (args, ctx) => saveThesis({ thesis_id: args.thesis_id, change_status: "WATCHING" }, ctx),
});
