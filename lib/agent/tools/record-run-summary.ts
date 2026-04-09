/**
 * record_run_summary — migrated to defineTool().
 *
 * Fires after all execution tools (Stage 6), before complete_run.
 * Writes the run_summary RunEvent that the briefing agent reads.
 * Reads synthesis + risk_notes from the stored decision plan.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";

export const recordRunSummary = defineTool({
  description:
    "STAGE 6. Fires after all execution tools (Stage 5), before complete_run. Pass the ranked picks and exposure breakdown — pure data. The synthesis paragraph from your record_decision_plan call is automatically attached for the briefing agent. Your IMMEDIATE next step after this is Stage 7 — call complete_run.",
  schema: z.object({
    ranked_picks: z
      .array(
        z.object({
          rank: z.number(),
          ticker: z.string(),
          direction: z.enum(["LONG", "SHORT", "PASS"]),
          confidence: z.number(),
          reasoning: z.string().describe("One-line rationale (<= 80 chars)"),
          action: z.enum(["INITIATE", "ADD", "HOLD", "REDUCE", "EXIT", "WATCH", "REMOVE_WATCH", "PASS", "FAILED"]),
        }),
      )
      .describe(
        "Every ticker you researched in Stage 2, ranked by conviction, with the action that ACTUALLY happened in Stage 5. Use FAILED for tickers where place_trade returned success: false.",
      ),
    exposure_breakdown: z
      .object({
        long_exposure: z.number().describe("Total $ in long positions"),
        short_exposure: z.number().describe("Total $ in short positions"),
        net_exposure: z.number().describe("Net $ exposure (long - short)"),
      })
      .optional(),
  }),
  ui: "decision-summary" as const,

  execute: async (args, ctx) => {
    try {
      // Read the decision plan stored in Stage 4
      let synthesis = "";
      let riskNotes: string[] = [];
      if (ctx.runId) {
        const run = await prisma.researchRun.findFirst({
          where: { id: ctx.runId },
          select: { parameters: true },
        });
        const params = (run?.parameters && typeof run.parameters === "object")
          ? (run.parameters as Record<string, unknown>)
          : {};
        const plan = params.decisionPlan as { synthesis?: string; risk_notes?: string[] } | undefined;
        if (plan?.synthesis) synthesis = plan.synthesis;
        if (Array.isArray(plan?.risk_notes)) riskNotes = plan.risk_notes;
      }

      const traded = args.ranked_picks.filter((p) => {
        const a = p.action.toUpperCase();
        return a === "INITIATE" || a === "ADD";
      }).length;

      // Write run_summary RunEvent (shape the briefing agent reads)
      if (ctx.runId) {
        try {
          await prisma.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "run_summary",
              title: "Run Summary",
              message: synthesis,
              payload: {
                summary: synthesis,
                ranked_picks: args.ranked_picks,
                risk_notes: riskNotes,
                overall_assessment: synthesis,
                portfolio_review: synthesis,
              } as object,
            },
          });
        } catch (evtErr) {
          console.error(`[tool] record_run_summary RunEvent write failed:`, evtErr instanceof Error ? evtErr.message : evtErr);
        }
      }

      // Record HOLD decisions (non-fatal)
      const holdPicks = args.ranked_picks.filter((p) => p.action.toUpperCase() === "HOLD");
      if (holdPicks.length > 0 && ctx.analystId && ctx.runId) {
        for (const pick of holdPicks) {
          try {
            const position = await prisma.position.findFirst({
              where: { analystId: ctx.analystId, symbol: pick.ticker.toUpperCase(), status: "OPEN" },
              select: { id: true },
            });
            await prisma.tradeDecision.create({
              data: {
                runId: ctx.runId,
                analystId: ctx.analystId,
                userId: ctx.userId,
                symbol: pick.ticker.toUpperCase(),
                decision: "HOLD",
                reasoning: pick.reasoning?.slice(0, 500) ?? null,
                positionId: position?.id ?? null,
              },
            });
          } catch (holdErr) {
            console.warn(`[tool] record_run_summary HOLD decision failed for ${pick.ticker}:`, holdErr instanceof Error ? holdErr.message : holdErr);
          }
        }
      }

      const eb = args.exposure_breakdown;
      return {
        summary: `Run summary recorded: ${args.ranked_picks.length} picks, ${traded} traded.`,
        data: {
          success: true,
          rankedPicks: args.ranked_picks,
          exposureBreakdown: eb
            ? { longExposure: eb.long_exposure, shortExposure: eb.short_exposure, netExposure: eb.net_exposure }
            : undefined,
          traded,
          analyzed: args.ranked_picks.length,
        },
        sources: [],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Run summary persistence failed";
      console.error(`[tool] record_run_summary FAILED: ${msg}`);
      return {
        summary: `Run summary failed: ${msg}`,
        data: {
          success: false,
          rankedPicks: args.ranked_picks,
          exposureBreakdown: undefined,
          traded: 0,
          analyzed: args.ranked_picks.length,
          error: msg,
        },
        sources: [],
      };
    }
  },
});
