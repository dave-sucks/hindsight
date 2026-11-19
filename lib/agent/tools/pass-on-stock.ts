/**
 * pass_on_stock — the chat's "we looked, and we pass": the stock and the
 * reason. It saves through record_thesis's own PASS path, so the researched
 * decline lands as it always has: a PASSED thesis on the pinned analyst, no
 * triggers, never woken, kept so the stock isn't pitched again without a
 * reason. A stock we hold is refused there (a pass can't sit on a position).
 * The chat with no analyst pinned names the analyst, as watch_stock does, and
 * the pass goes on that analyst's manual run (mintWatch's anchor); before it
 * could, the chat sent P to the Writer only to record a pass (2026-11-19).
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { defineTool } from "@/lib/agent/define-tool";
import type { ToolContext } from "@/lib/agent/tool-context";
import { recordThesis } from "@/lib/agent/tools/record-thesis";
import { forTheStock } from "@/lib/agent/analyst-scope";
import { getOrCreateManualRun } from "@/lib/agent/manual-run-anchor";
import type { ToolResult } from "@/lib/agent/tool-result";

const namesAnalyst = (ctx: ToolContext) => !ctx.analystId;

export const passOnStock = defineTool({
  description: "For a stock we don't cover: records that we researched it and pass, with the reason; it is saved as Passed and never woken. A stock we watch is dropped with stop_watching.",
  schema: z.object({
    ticker: z.string().describe("The stock we pass on."),
    reason: z.string().min(20).describe("Why we pass, in your own words by How you write: what you found and why it doesn't fit."),
    analyst_id: z.string().describe("The analyst the pass is for, by its id (list_analysts)."),
  }),
  // Pinned, it is the pinned analyst's; the chat with no analyst pinned names one.
  schemaFor: (ctx, schema) => (namesAnalyst(ctx) ? schema : schema.omit({ analyst_id: true })),
  ui: "thesis-card" as const,
  progressLabel: (args) => `Passing on ${args.ticker?.toUpperCase() ?? "the stock"}`,
  execute: async (args, ctx) => {
    let saveCtx = ctx;
    if (namesAnalyst(ctx)) {
      const analyst = await prisma.agentConfig.findFirst({ where: { id: args.analyst_id ?? "", accountId: ctx.accountId }, select: { id: true } });
      if (!analyst) {
        return { summary: `Not passed: no analyst ${args.analyst_id ?? ""} on this account.`, data: { status: "FAILED" as const, note: "Name the analyst the pass is for by its id (list_analysts)." }, sources: [] };
      }
      const runId = await getOrCreateManualRun({ analystId: analyst.id, userId: ctx.userId, accountId: ctx.accountId ?? "" });
      saveCtx = { ...(await forTheStock(ctx, analyst.id)), runId };
    }
    const save = recordThesis(saveCtx) as unknown as { execute: (a: Record<string, unknown>, o: Record<string, unknown>) => Promise<ToolResult<unknown>> };
    const saved = await save.execute(
      { ticker: args.ticker.toUpperCase(), direction: "PASS", reasoning_summary: args.reason, source_rationale: "Researched in the chat" },
      { toolCallId: "pass-on-stock", messages: [] },
    );
    if (!saved.ok) throw new Error(saved.error);
    return { summary: saved.summary, data: saved.data, sources: saved.sources };
  },
});
