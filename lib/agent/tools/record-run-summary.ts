/**
 * record_run_summary — migrated to defineTool().
 *
 * Fires after all execution tools (Stage 5), before complete_run.
 * Writes the run_summary RunEvent that the briefing agent reads.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";

export const recordRunSummary = defineTool({
  description:
    "STAGE 5. Fires after all execution tools, before complete_run. Pass every ticker you researched (ranked by conviction) with the action that ACTUALLY happened. Your IMMEDIATE next step after this is Stage 6 — call complete_run.",
  schema: z.object({
    // Decision-framework v1 — required field. The agent's overall capital
    // allocation decision for this run. Persisted in ResearchRun.parameters
    // and on the run_summary RunEvent payload. Drives day-over-day analytics:
    // are runs producing HOLD when there's no edge, or busywork-trading
    // because of compliance pressure?
    primary_decision: z
      .enum(["HOLD", "ADJUST", "ROTATE", "ADD", "WATCH"])
      .describe(
        "The run's primary capital allocation decision: HOLD (current portfolio is optimal, no changes), ADJUST (modify existing positions only), ROTATE (close a current position to fund a clearly better entry), ADD (open a new position that beats existing options AND cash), WATCH (log a candidate for later, no trade today). HOLD is a successful run; do not force a trade to fill a quota.",
      ),
    decision_rationale: z
      .string()
      .min(120)
      .describe(
        "STRUCTURED rationale. Required content depends on primary_decision: " +
        "HOLD → must cite (a) weakest holding's composite score with dimension breakdown, (b) best candidate's composite, (c) why each evaluated candidate failed (composite < 7, quality-bar gate, didn't beat weakest by ≥+2, leader extended). " +
        "ADD/ROTATE → must cite (a) candidate's composite breakdown by dimension (3+3+2+2), (b) which holding it beats (or whether it's an addition not rotation), (c) why leader-first isn't blocking, (d) R/R ratio. " +
        "ADJUST → must cite which holding(s) and what changed in the score that triggered the adjustment. " +
        "WATCH → must cite what's promising AND what's missing. " +
        "Vague rationales like 'holdings still working' or 'no good setups today' are INSUFFICIENT — every score and every PASS reason must be explicit and auditable. " +
        "Example HOLD: 'Weakest holding NVDA 8/10 (3+3+1+1, entryQuality dinged for extended intraday). Best candidate INTC 5/10 (2+1+1+1) — fails leader-first (NVDA leads), fails entryQuality (post-earnings gap already faded). ON Semi 6/10 — fails extended-chase gate at +12% intraday. No candidate clears bar; HOLD.'",
      ),
    ranked_picks: z
      .array(
        z.object({
          rank: z.number(),
          ticker: z.string(),
          direction: z.enum(["LONG", "SHORT", "PASS"]),
          confidence: z.number(),
          reasoning: z.string().describe("One-line rationale (<= 80 chars)"),
          action: z.enum(["INITIATE", "ADD", "HOLD", "REDUCE", "EXIT", "WATCH", "REMOVE_WATCH", "PASS", "FAILED"]),
          composite_score: z
            .number()
            .min(0)
            .max(10)
            .optional()
            .describe(
              "Composite of the six decision-framework dimensions from record_thesis.scoring (avg, 0-10). Required when scoring was provided to record_thesis.",
            ),
        }),
      )
      .describe(
        "Every ticker you researched in Step 3, ranked by composite_score (or by conviction if composite unavailable), with the action that ACTUALLY happened in Step 5. Use FAILED for tickers where place_trade returned success: false.",
      ),
    exposure_breakdown: z
      .object({
        long_exposure: z.number().describe("Total $ in long positions"),
        short_exposure: z.number().describe("Total $ in short positions"),
        net_exposure: z.number().describe("Net $ exposure (long - short)"),
      })
      .optional(),
  }),
  ui: "run-summary" as const,

  progressLabel: () => "Recording the run summary",

  execute: async (args, ctx) => {
    try {
      const traded = args.ranked_picks.filter((p) => {
        const a = p.action.toUpperCase();
        return a === "INITIATE" || a === "ADD";
      }).length;

      // Compute actual deployed amount from DB — only INITIATE decisions for this run.
      // The model-provided exposure_breakdown reflects total portfolio exposure (including
      // pre-existing positions), not what was deployed this session, so we ignore it.
      let actualDeployedLong = 0;
      let actualDeployedShort = 0;
      if (ctx.runId) {
        try {
          const initiateDecisions = await prisma.tradeDecision.findMany({
            where: { runId: ctx.runId, decision: "INITIATE" },
            include: { position: { select: { quantity: true, avgCost: true, direction: true } } },
          });
          for (const d of initiateDecisions) {
            if (!d.position) continue;
            const notional = d.position.avgCost * d.position.quantity;
            if (d.position.direction === "LONG") actualDeployedLong += notional;
            else actualDeployedShort += notional;
          }
        } catch (dbErr) {
          console.warn("[tool] record_run_summary: deployed capital DB lookup failed:", dbErr instanceof Error ? dbErr.message : dbErr);
        }
      }

      // Write run_summary RunEvent (shape the briefing agent reads)
      if (ctx.runId) {
        try {
          await prisma.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "run_summary",
              title: `Run Summary — ${args.primary_decision}`,
              message: `${args.primary_decision}: ${args.ranked_picks.length} tickers analyzed, ${traded} traded`,
              payload: {
                primary_decision: args.primary_decision,
                decision_rationale: args.decision_rationale,
                ranked_picks: args.ranked_picks,
              } as object,
            },
          });
        } catch (evtErr) {
          console.error(`[tool] record_run_summary RunEvent write failed:`, evtErr instanceof Error ? evtErr.message : evtErr);
        }

        // Persist primary_decision + rationale into ResearchRun.parameters
        // so day-over-day analytics can SQL-query them directly without
        // joining to RunEvent. Merge with existing params (toolStats, etc.).
        try {
          const existing = await prisma.researchRun.findUnique({
            where: { id: ctx.runId },
            select: { parameters: true },
          });
          const existingParams =
            existing?.parameters && typeof existing.parameters === "object"
              ? (existing.parameters as Record<string, unknown>)
              : {};
          await prisma.researchRun.update({
            where: { id: ctx.runId },
            data: {
              parameters: {
                ...existingParams,
                primaryDecision: args.primary_decision,
                decisionRationale: args.decision_rationale,
              } as object,
            },
          });
        } catch (paramErr) {
          console.warn(
            `[tool] record_run_summary parameter write failed:`,
            paramErr instanceof Error ? paramErr.message : paramErr
          );
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

      const deployedThisRun = actualDeployedLong + actualDeployedShort;
      return {
        summary: deployedThisRun > 0
          ? `Run summary recorded: ${args.ranked_picks.length} picks, ${traded} traded — $${deployedThisRun.toFixed(0)} deployed.`
          : `Run summary recorded: ${args.ranked_picks.length} picks, ${traded} traded — no new capital deployed.`,
        data: {
          success: true,
          rankedPicks: args.ranked_picks,
          exposureBreakdown: deployedThisRun > 0
            ? { longExposure: actualDeployedLong, shortExposure: actualDeployedShort, netExposure: actualDeployedLong - actualDeployedShort }
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
