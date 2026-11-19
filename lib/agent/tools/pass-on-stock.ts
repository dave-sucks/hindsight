/**
 * pass_on_stock — the chat's "we looked, and we pass": the stock and the
 * reason. It saves through record_thesis's own PASS path, so the researched
 * decline lands as it always has: a PASSED thesis on the pinned analyst, no
 * triggers, never woken, kept so the stock isn't pitched again without a
 * reason. A stock we hold is refused there (a pass can't sit on a position).
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { recordThesis } from "@/lib/agent/tools/record-thesis";
import type { ToolResult } from "@/lib/agent/tool-result";

export const passOnStock = defineTool({
  description: "Records that we researched a stock and pass on it, with the reason; it is saved as Passed and never woken.",
  schema: z.object({
    ticker: z.string().describe("The stock we pass on."),
    reason: z.string().min(20).describe("Why we pass, in your own words by How you write: what you found and why it doesn't fit."),
  }),
  ui: "thesis-card" as const,
  progressLabel: (args) => `Passing on ${args.ticker?.toUpperCase() ?? "the stock"}`,
  execute: async (args, ctx) => {
    const save = recordThesis(ctx) as unknown as { execute: (a: Record<string, unknown>, o: Record<string, unknown>) => Promise<ToolResult<unknown>> };
    const saved = await save.execute(
      { ticker: args.ticker.toUpperCase(), direction: "PASS", reasoning_summary: args.reason, source_rationale: "Researched in the chat" },
      { toolCallId: "pass-on-stock", messages: [] },
    );
    if (!saved.ok) throw new Error(saved.error);
    return { summary: saved.summary, data: saved.data, sources: saved.sources };
  },
});
