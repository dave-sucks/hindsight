/**
 * record_decision_plan — migrated to defineTool().
 *
 * Fires ONCE after all theses are written (Stage 4). Persists the synthesis
 * paragraph and planned actions to run.parameters.decisionPlan so
 * record_run_summary can read them back for the briefing agent.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";

export const recordDecisionPlan = defineTool({
  description:
    "STAGE 4 ONLY. Fires ONCE after all theses are written, before any execution tool. Pass a single synthesis paragraph explaining your overall decision (the 'I reviewed everything and decided X' moment — required even if you decide not to trade) plus your planned actions for every researched ticker. Your IMMEDIATE next step after this is Stage 5 — execute the planned actions in order. Do not stop.",
  schema: z.object({
    synthesis: z
      .string()
      .min(1)
      .describe(
        "ONE paragraph (3-6 sentences) reviewing all your theses against the portfolio. Always required, even if you're not trading.",
      ),
    planned_actions: z
      .array(
        z.object({
          ticker: z.string(),
          action: z.enum(["INITIATE", "ADD", "HOLD", "REDUCE", "EXIT", "WATCH", "REMOVE_WATCH", "PASS"]),
          reasoning: z.string().describe("One-line rationale for this specific action"),
        }),
      )
      .describe(
        "Every ticker you researched in Stage 2, with the action you intend to take.",
      ),
    risk_notes: z
      .array(z.string())
      .optional()
      .describe("Optional portfolio-level risk observations."),
  }),
  ui: "ticker" as const,
  groupId: "execution",

  execute: async (args, ctx) => {
    try {
      if (ctx.runId) {
        const existing = await prisma.researchRun.findFirst({
          where: { id: ctx.runId },
          select: { parameters: true },
        });
        const params = (existing?.parameters && typeof existing.parameters === "object")
          ? (existing.parameters as Record<string, unknown>)
          : {};
        await prisma.researchRun.update({
          where: { id: ctx.runId },
          data: {
            parameters: {
              ...params,
              decisionPlan: {
                synthesis: args.synthesis,
                planned_actions: args.planned_actions,
                risk_notes: args.risk_notes ?? [],
                recorded_at: new Date().toISOString(),
              },
            } as object,
          },
        });
      }

      const tickers = args.planned_actions.map((p) => ({
        ticker: p.ticker,
        tag: p.action,
        summary: p.reasoning,
        actionIcon: planActionIcon(p.action),
      }));

      return {
        summary: `Decision plan recorded: ${args.planned_actions.length} actions`,
        data: {
          success: true,
          synthesis: args.synthesis,
          planned_actions: args.planned_actions,
          risk_notes: args.risk_notes ?? [],
          action_count: args.planned_actions.filter((p) => p.action !== "HOLD" && p.action !== "PASS").length,
          tickers,
        },
        sources: [],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Decision plan persistence failed";
      console.error(`[tool] record_decision_plan FAILED: ${msg}`);
      return {
        summary: `Decision plan persistence failed: ${msg}`,
        data: {
          success: false,
          synthesis: args.synthesis,
          planned_actions: args.planned_actions,
          risk_notes: args.risk_notes ?? [],
          action_count: 0,
          error: msg,
          tickers: [],
        },
        sources: [],
      };
    }
  },
});

function planActionIcon(action: string): string | undefined {
  const a = action.toUpperCase();
  if (a === "INITIATE" || a === "ADD") return "buy";
  if (a === "EXIT" || a === "REDUCE") return "sell";
  if (a === "WATCH") return "watch";
  if (a === "REMOVE_WATCH") return "unwatch";
  return undefined;
}
