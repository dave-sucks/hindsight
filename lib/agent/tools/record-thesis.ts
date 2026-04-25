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
  // ── Decision-framework scoring (added 2026-04-25) ────────────────────────
  // Six dimensions, 0-10 each, with a one-sentence note per dimension. These
  // make the decision auditable: was the agent's PASS/LONG/SHORT call grounded
  // in actual analysis or just vibes? The composite (avg of the six) drives
  // Step 4's portfolio comparison — a candidate must score ≥ 7 composite to
  // be ADD/ROTATE eligible. Optional during the rollout window so existing
  // call sites don't break; will become required once analysts are migrated.
  scoring: z
    .object({
      trendMomentum: z.object({
        score: z.number().min(0).max(10),
        note: z.string().describe("One sentence on trend strength + structure (e.g. 'multi-week uptrend with rising 50d, no major distribution')"),
      }),
      relativeStrength: z.object({
        score: z.number().min(0).max(10),
        note: z.string().describe("Leader vs laggard call within the cohort (e.g. 'leader in AI semis, outperforming AMD/INTC YTD')"),
      }),
      entryQuality: z.object({
        score: z.number().min(0).max(10),
        note: z.string().describe("Defined setup vs late-stage chase (e.g. 'pullback to 20d in trend, NOT a chase' or 'extended +14% intraday, late-stage')"),
      }),
      catalystFreshness: z.object({
        score: z.number().min(0).max(10),
        note: z.string().describe("Catalyst still ahead vs already played (e.g. 'earnings next Tuesday' vs 'reported yesterday, gap already faded')"),
      }),
      riskReward: z.object({
        score: z.number().min(0).max(10),
        note: z.string().describe("R/R ratio with concrete numbers (e.g. 'target $X, stop $Y, 2.4:1')"),
      }),
      portfolioFit: z.object({
        score: z.number().min(0).max(10),
        note: z.string().describe("Concentration / correlation impact (e.g. 'diversifies away from concentrated AI semis exposure' or 'doubles down on existing semi cluster')"),
      }),
    })
    .optional()
    .describe(
      "Decision-framework scoring: six dimensions, 0-10 each with a one-sentence note. Required for Decision Framework v1 — record this on every record_thesis call so the run's decision logic is auditable. Composite (average of six) drives portfolio comparison: composite ≥ 7 is ADD/ROTATE-eligible; below 7 must be PASS or WATCH."
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
      const sourceRationale = args.source_rationale?.trim() ?? "";

      // Provenance gate: every thesis must declare WHERE the idea came from.
      // Today 11 of 19 theses landed with null sourceSignalIds because the
      // agent passed neither signal IDs nor rationale and the old inference
      // fallback silently saved with empty provenance. The "don't tank the
      // run" argument doesn't apply anymore — we have a retry path in
      // morning-research.ts that recovers FAILED theses. Reject here and
      // make the agent fix the call.
      if (!args.source_kind && sourceSignalIds.length === 0 && sourceRationale.length === 0) {
        console.warn(
          `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} REJECTED — no provenance provided (no source_kind, no source_signal_ids, no source_rationale).`
        );
        return {
          summary: `Thesis rejected for ${args.ticker}: no provenance provided.`,
          data: {
            thesis_id: null,
            status: "FAILED" as const,
            note: "Every record_thesis call MUST declare provenance. Add EITHER source_signal_ids (non-empty array of IDs from today's read_signals output) with source_kind=ROUTED_SIGNAL, OR source_rationale (one-line explanation like 'Reviewed position after price alert' or 'Identified via 52-week-high discovery monitor') with source_kind=WEB_SEARCH / WATCHLIST_REVIEW / POSITION_REVIEW. Retry with the correct shape.",
          },
          sources: [],
        };
      }

      // Researched-before-thesis gate. Every record_thesis call MUST have
      // a matching get_stock_data call for the same ticker earlier in the
      // run. Without this gate, the agent could narrate a thesis on a
      // ticker it never looked at — we saw this on Apr 24 runs where the
      // agent wrote LONG theses on held tickers after only pulling live
      // snapshots on unrelated discovery names.
      //
      // Exception: if ctx.calledTickers is undefined (older call paths that
      // don't initialize the tracker, e.g. builder/editor modes), fall
      // through without gating. The research-run path always sets it.
      if (ctx.calledTickers) {
        const tickerKey = args.ticker.toUpperCase();
        const callsForTicker = ctx.calledTickers.get(tickerKey);
        const researched = callsForTicker?.has("get_stock_data") ?? false;
        if (!researched) {
          console.warn(
            `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} REJECTED — get_stock_data was not called for this ticker in this run.`
          );
          return {
            summary: `Thesis rejected for ${args.ticker}: no get_stock_data call in this run.`,
            data: {
              thesis_id: null,
              status: "FAILED" as const,
              note: `Every thesis must be grounded in live research. Call get_stock_data for ${args.ticker} first, then retry record_thesis. A thesis without an underlying data pull is not valid — the tool's UI cards, fence check, and downstream analytics all depend on it.`,
            },
            sources: [],
          };
        }
      }

      // Inference fallback (only fires when agent provided at least SOME
      // provenance but missed source_kind). Infers from what's present:
      //   - signal_ids present → ROUTED_SIGNAL
      //   - rationale present → WEB_SEARCH (conservative default)
      const inferredSourceKind =
        args.source_kind ??
        (sourceSignalIds.length > 0 ? "ROUTED_SIGNAL" : "WEB_SEARCH");

      if (!args.source_kind) {
        console.warn(
          `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} — source_kind missing, inferred=${inferredSourceKind} from signal_ids=${sourceSignalIds.length} rationale_len=${sourceRationale.length}. Agent prompt compliance issue.`
        );
      }

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

      // Compute composite score for the decision-framework scoring object,
      // if the agent provided one. Stored alongside the raw scoring in
      // fullResearch so downstream analytics can query average composite
      // per analyst, per run, etc., without parsing the six sub-fields each
      // time. No DB migration needed — fullResearch is an existing Json
      // column.
      const scoringComposite = args.scoring
        ? Math.round(
            ((args.scoring.trendMomentum.score +
              args.scoring.relativeStrength.score +
              args.scoring.entryQuality.score +
              args.scoring.catalystFreshness.score +
              args.scoring.riskReward.score +
              args.scoring.portfolioFit.score) /
              6) *
              10
          ) / 10
        : null;

      const fullResearch = {
        ...(args.fundamentals ? { fundamentals: args.fundamentals } : {}),
        ...(args.scoring
          ? { scoring: args.scoring, scoringComposite }
          : {}),
      };

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
        sourceKind: inferredSourceKind,
        sourceRationale: sourceRationale.length > 0 ? sourceRationale : null,
        fullResearch: Object.keys(fullResearch).length > 0 ? fullResearch : undefined,
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
        // Narrow fallback: only trigger when the error is specifically about an
        // unknown column/argument from the V2/V3 schema additions. The previous
        // catch matched errMsg.includes("status") which matched almost ANY
        // Prisma error (most error messages contain the word "status"), silently
        // stripping sourceSignalIds / sourceKind / sourceRationale from every
        // thesis regardless of the real error cause. That's why 100% of theses
        // Apr 23-24 showed sourceKind=null — the fallback was eating real
        // errors.
        const isUnknownArgError =
          errMsg.includes("Unknown arg") ||
          errMsg.includes("Unknown argument") ||
          // Prisma validation-error shapes vary across versions; catch the
          // variants that name a specific new column:
          (errMsg.includes("parentThesisId") && errMsg.includes("does not exist")) ||
          (errMsg.includes("sourceSignalIds") && errMsg.includes("does not exist")) ||
          (errMsg.includes("sourceKind") && errMsg.includes("does not exist")) ||
          (errMsg.includes("sourceRationale") && errMsg.includes("does not exist"));

        if (isUnknownArgError) {
          // LOUD log — we want to see this in Vercel if it ever happens.
          console.error(
            `[tool] record_thesis V2/V3 FALLBACK TRIGGERED for ${args.ticker}. ` +
              `Prisma client appears out of sync with schema. Dropping new columns. ` +
              `Full error: ${errMsg}`
          );
          const {
            sourceSignalIds: _ids,
            sourceKind: _kind,
            sourceRationale: _rationale,
            ...fallbackData
          } = coreData;
          void _ids;
          void _kind;
          void _rationale;
          thesis = await prisma.thesis.create({ data: fallbackData });
          resolvedParentId = null;
        } else {
          // Any other error is a real failure — log with full context and throw.
          console.error(
            `[tool] record_thesis create() FAILED for ${args.ticker}: ${errMsg}`
          );
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
