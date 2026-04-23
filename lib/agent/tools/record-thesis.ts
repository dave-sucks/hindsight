/**
 * record_thesis — migrated to defineTool().
 *
 * Persists a thesis (LONG/SHORT/PASS) to the DB and returns all args
 * so the UI can render the full thesis card.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { etTradingDayDate } from "@/lib/market-hours";

const thesisFields = z.object({
  ticker: z.string(),
  company_name: z.string().optional().describe("Company name from get_stock_data"),
  exchange: z.string().optional().describe("Exchange from get_stock_data, e.g. NASDAQ"),
  direction: z.enum(["LONG", "SHORT", "PASS"]),
  confidence_score: z.number().min(0).max(100),
  reasoning_summary: z
    .string()
    .describe("2-3 sentence summary of your thesis. For PASS: explain what you found AND why it doesn't fit your strategy right now."),
  thesis_bullets: z
    .array(z.string())
    .describe("3-5 key points supporting the thesis. For PASS: include what you learned, why it doesn't fit, and what would change your mind."),
  risk_flags: z.array(z.string()).describe("2-4 key risks. For PASS: note the risks that made you pass."),
  entry_price: z.number().optional().describe("Current price for entry. REQUIRED for LONG/SHORT — use the price from get_stock_data. Also include for PASS to enable shadow tracking."),
  target_price: z.number().optional().describe("Price target. REQUIRED for LONG/SHORT."),
  stop_loss: z.number().optional().describe("Stop-loss price. REQUIRED for LONG/SHORT."),
  hold_duration: z.enum(["DAY", "SWING", "POSITION"]),
  signal_types: z.array(z.string()).describe("Signal types: MOMENTUM, EARNINGS_BEAT, BREAKOUT, etc."),
  sources_used: z
    .array(z.object({ provider: z.string(), title: z.string(), url: z.string().optional() }))
    .optional()
    .describe("Key sources that informed this thesis (optional, for record-keeping)"),
  fundamentals: z
    .object({
      market_cap: z.number().optional(),
      pe_ratio: z.number().optional(),
      beta: z.number().optional(),
      avg_volume: z.number().optional(),
      high_52w: z.number().optional(),
      low_52w: z.number().optional(),
      sector: z.string().optional(),
      analyst_consensus: z.object({ buy: z.number(), hold: z.number(), sell: z.number() }).optional(),
    })
    .optional()
    .describe("Key fundamentals from get_stock_data — populates the Data tab in the thesis card."),
  parent_thesis_id: z.string().optional()
    .describe("ID of the prior thesis being updated or invalidated. Links thesis chain."),
  // V3 Session 3 — forcing-function trio.
  // source_kind is optional at the Zod layer so the agent can't tank an
  // entire run by forgetting the field — execute() infers a fallback
  // from context. When the agent DOES pass it, the cross-field rule in
  // superRefine below still enforces the per-kind shape, and the
  // execute()-level existence check still verifies ROUTED_SIGNAL IDs
  // against AnalystSignalRoute for this analyst.
  source_kind: z
    .enum(["ROUTED_SIGNAL", "WEB_SEARCH", "WATCHLIST_REVIEW", "POSITION_REVIEW"])
    .optional()
    .describe(
      "Where this thesis came from. ROUTED_SIGNAL = informed by a signal from read_signals (requires non-empty source_signal_ids). WEB_SEARCH = came from a live web_search call only. WATCHLIST_REVIEW = triggered by reviewing your own watchlist. POSITION_REVIEW = triggered by reviewing an open position."
    ),
  source_signal_ids: z
    .array(z.string())
    .default([])
    .describe(
      "signalId values from read_signals that informed this thesis. MUST be non-empty when source_kind is ROUTED_SIGNAL. Persisted so trade-evaluator can credit the originating monitors when the position closes."
    ),
  source_rationale: z
    .string()
    .optional()
    .describe(
      "One-line explanation of how you got to this ticker. REQUIRED when source_kind is WEB_SEARCH, WATCHLIST_REVIEW, or POSITION_REVIEW."
    ),
});

const thesisSchema = thesisFields.superRefine((val, ctx) => {
  // If source_kind is absent the inference fallback in execute()
  // handles it — don't reject here.
  if (val.source_kind === "ROUTED_SIGNAL") {
    if (!val.source_signal_ids || val.source_signal_ids.length === 0) {
      ctx.addIssue({
        code: "custom",
        message:
          "source_signal_ids must be non-empty when source_kind is ROUTED_SIGNAL. Cite the signalId values from read_signals that informed this thesis — or change source_kind to WEB_SEARCH / WATCHLIST_REVIEW / POSITION_REVIEW if no routed signal was involved.",
        path: ["source_signal_ids"],
      });
    }
  } else if (val.source_kind) {
    // Explicit non-ROUTED_SIGNAL kind: rationale required.
    if (!val.source_rationale || val.source_rationale.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `source_rationale is required when source_kind is ${val.source_kind}. Provide a one-line rationale for the thesis origin.`,
        path: ["source_rationale"],
      });
    }
  }
});

export const recordThesis = defineTool({
  description:
    "STAGE 3 ONLY. Write a thesis for every ticker you researched in Stage 2, back to back, in one batch. Direction must be LONG, SHORT, or PASS — PASS theses are mandatory for tickers you researched but won't trade, they document the decision. Never call this in Stage 2 (research) or Stage 4 (execution). Never write a verdict as narration text instead of calling this tool.",
  schema: thesisSchema,
  ui: "thesis-card" as const,

  progressLabel: (args) => {
    const t = args.ticker.toUpperCase();
    if (args.direction === "PASS") return `Passing on ${t}`;
    if (args.direction === "LONG") return `Writing a LONG thesis on ${t}`;
    return `Writing a SHORT thesis on ${t}`;
  },

  execute: async (args, ctx) => {
    try {
      const sourceSignalIds = Array.from(new Set(args.source_signal_ids ?? []));

      // Inference fallback: GPT-4o occasionally drops required fields, and
      // hard-rejecting the whole call would tank the whole run (zero theses
      // => route.ts onFinish marks FAILED because hasWork = thesisCount > 0
      // || tradeCount > 0). Infer a best-effort source_kind from context
      // and log loudly so the compliance miss shows up in toolStats.
      const inferredSourceKind =
        args.source_kind ??
        (sourceSignalIds.length > 0 ? "ROUTED_SIGNAL" : "WEB_SEARCH");

      const inferredSourceRationale =
        args.source_rationale ??
        (inferredSourceKind === "ROUTED_SIGNAL"
          ? undefined
          : `Source: ${inferredSourceKind.toLowerCase().replace(/_/g, " ")}; rationale unspecified (agent did not provide).`);

      if (!args.source_kind) {
        console.warn(
          `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} — source_kind missing, inferred=${inferredSourceKind}. Agent prompt compliance issue; investigate via toolStats.`,
        );
      }
      void inferredSourceRationale;

      // Forcing function: when the call claims (or infers) ROUTED_SIGNAL
      // provenance, every signalId must belong to this analyst's routed
      // inbox for today (ET trading day). Rejecting out-of-pool IDs prevents
      // the agent from satisfying the Zod non-empty check by fabricating
      // strings.
      if (inferredSourceKind === "ROUTED_SIGNAL" && sourceSignalIds.length > 0) {
        if (!ctx.analystId) {
          return {
            summary: `Thesis rejected for ${args.ticker}: source_kind=ROUTED_SIGNAL requires an analyst context, which is missing for this run.`,
            data: {
              thesis_id: null,
              status: "FAILED" as const,
              note: "Cannot validate source_signal_ids without an analystId. Use source_kind=WEB_SEARCH / WATCHLIST_REVIEW / POSITION_REVIEW with a source_rationale instead, or retry from an analyst-scoped run.",
            },
            sources: [],
          };
        }
        const todayStart = etTradingDayDate();
        const validRoutes = await prisma.analystSignalRoute.findMany({
          where: {
            analystId: ctx.analystId,
            signalId: { in: sourceSignalIds },
            routedAt: { gte: todayStart },
          },
          select: { signalId: true },
        });
        const validIds = new Set(validRoutes.map((r) => r.signalId));
        const missing = sourceSignalIds.filter((id) => !validIds.has(id));
        if (missing.length > 0) {
          return {
            summary: `Thesis rejected for ${args.ticker}: ${missing.length} source_signal_ids not in today's routed inbox.`,
            data: {
              thesis_id: null,
              status: "FAILED" as const,
              note: `Invalid signalIds for ROUTED_SIGNAL: ${missing.join(", ")}. Every id must come from today's read_signals output for this analyst. Call read_signals and cite IDs from its result, or change source_kind to WEB_SEARCH / WATCHLIST_REVIEW / POSITION_REVIEW with a source_rationale if this thesis did not actually rely on a routed signal.`,
            },
            sources: [],
          };
        }
      }

      const coreData = {
        researchRunId: ctx.runId,
        userId: ctx.userId,
        ticker: args.ticker,
        direction: args.direction,
        confidenceScore: args.confidence_score,
        reasoningSummary: args.reasoning_summary,
        thesisBullets: args.thesis_bullets,
        riskFlags: args.risk_flags,
        entryPrice: args.entry_price ?? null,
        targetPrice: args.target_price ?? null,
        stopLoss: args.stop_loss ?? null,
        holdDuration: args.hold_duration,
        signalTypes: args.signal_types,
        sourcesUsed: args.sources_used ?? [],
        sourceSignalIds,
        source: "AGENT",
        modelUsed: "gpt-4o",
      };

      // Auto-SUPERSEDE: find any existing ACTIVE thesis for this ticker+analyst.
      // This fires even when parent_thesis_id wasn't passed — e.g. agent re-researches a holding.
      let resolvedParentId = args.parent_thesis_id ?? null;
      if (!resolvedParentId && args.direction !== "PASS" && ctx.analystId) {
        try {
          const existingThesis = await prisma.thesis.findFirst({
            where: {
              ticker: args.ticker,
              status: "ACTIVE",
              direction: { not: "PASS" },
              researchRun: { agentConfigId: ctx.analystId },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (existingThesis) {
            resolvedParentId = existingThesis.id;
          }
        } catch { /* non-fatal */ }
      }

      let thesis;
      try {
        thesis = await prisma.thesis.create({
          data: { ...coreData, status: "ACTIVE", parentThesisId: resolvedParentId },
        });
      } catch (v2Err: unknown) {
        const errMsg = v2Err instanceof Error ? v2Err.message : String(v2Err);
        if (errMsg.includes("status") || errMsg.includes("parentThesisId") || errMsg.includes("sourceSignalIds") || errMsg.includes("Unknown arg")) {
          console.warn("[tool] record_thesis: V2 columns not available, falling back to core schema");
          const { sourceSignalIds: _dropped, ...fallbackData } = coreData;
          void _dropped;
          thesis = await prisma.thesis.create({ data: fallbackData });
          resolvedParentId = null; // can't update parent if schema doesn't support it
        } else {
          throw v2Err;
        }
      }

      // Transition parent thesis lifecycle
      if (resolvedParentId) {
        try {
          if (args.direction === "PASS") {
            await prisma.thesis.update({
              where: { id: resolvedParentId },
              data: { status: "INVALIDATED", invalidatedAt: new Date(), invalidReason: args.reasoning_summary?.slice(0, 500) || "Thesis invalidated by follow-up research" },
            });
          } else {
            await prisma.thesis.update({ where: { id: resolvedParentId }, data: { status: "SUPERSEDED" } });
          }
        } catch (parentErr) {
          console.warn(`[tool] record_thesis: parent thesis update skipped:`, parentErr);
        }
      }

      // V2: Update watchlist item's lastThesisId (non-fatal)
      if (ctx.analystId) {
        try {
          await prisma.analystWatchlistItem.updateMany({
            where: { analystId: ctx.analystId, symbol: args.ticker, status: "ACTIVE" },
            data: { lastThesisId: thesis.id },
          });
        } catch { /* Non-fatal */ }
      }

      // V3 Session 3 — flip any cited routes to ACTED_ON. Scoped by analystId
      // so one analyst citing a signal doesn't close out a peer's inbox entry.
      // Non-fatal: if this fails the thesis is still saved, we just lose the
      // status flip for that run.
      if (ctx.analystId && sourceSignalIds.length > 0) {
        try {
          await prisma.analystSignalRoute.updateMany({
            where: {
              analystId: ctx.analystId,
              signalId: { in: sourceSignalIds },
            },
            data: { status: "ACTED_ON" },
          });
        } catch (routeErr) {
          console.warn("[tool] record_thesis: ACTED_ON route flip failed:", routeErr);
        }
      }

      // Persist RunEvent
      if (ctx.runId) {
        const evType = args.direction === "PASS" ? "skip" : "thesis_complete";
        await prisma.runEvent.create({
          data: {
            runId: ctx.runId,
            type: evType,
            title: evType === "skip" ? `Passing on ${args.ticker}` : `Thesis complete for ${args.ticker}`,
            message: args.reasoning_summary,
            payload: {
              ticker: args.ticker,
              thesis: {
                ticker: args.ticker,
                direction: args.direction,
                confidence_score: args.confidence_score,
                reasoning_summary: args.reasoning_summary,
                thesis_bullets: args.thesis_bullets,
                risk_flags: args.risk_flags,
                entry_price: args.entry_price,
                target_price: args.target_price,
                stop_loss: args.stop_loss,
                hold_duration: args.hold_duration,
                signal_types: args.signal_types,
              },
              ...(evType === "skip" ? { reason: args.reasoning_summary, confidence: args.confidence_score } : {}),
            } as object,
          },
        });
      }

      // Record PASS decision in TradeDecision
      if (args.direction === "PASS" && ctx.runId) {
        const analystId = ctx.analystId || "unknown";
        try {
          await prisma.tradeDecision.create({
            data: {
              runId: ctx.runId,
              analystId,
              userId: ctx.userId,
              symbol: args.ticker,
              decision: "PASS",
              reasoning: args.reasoning_summary,
              thesisId: thesis.id,
            },
          });
        } catch (passErr) {
          console.error("[tool] record_thesis PASS decision creation FAILED:", passErr);
        }
      }

      return {
        summary: `Thesis recorded: ${args.direction} ${args.ticker} (confidence: ${args.confidence_score})`,
        data: {
          thesis_id: thesis.id,
          status: "ACTIVE" as const,
        },
        sources: [],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Thesis save failed";
      console.error(`[tool] record_thesis FAILED for ${args.ticker}: ${msg}`);
      return {
        summary: `Thesis save failed for ${args.ticker}: ${msg}`,
        data: {
          thesis_id: null,
          status: "FAILED" as const,
          note: "Thesis could not be saved to DB. place_trade requires a thesis_id — do NOT attempt to trade this ticker.",
        },
        sources: [],
      };
    }
  },
});
