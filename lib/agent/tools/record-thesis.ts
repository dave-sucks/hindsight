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
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import {
  defaultTriggersForHorizon,
  mergeTriggers,
  applyTriggerCooldownDefaults,
  type Horizon,
} from "@/lib/agent/triggers/defaults";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import type { Trigger } from "@/lib/agent/triggers/types";
import { validateThesisShape } from "@/lib/agent/thesis-shape";

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
  hold_duration: z
    .enum(["DAY", "SWING", "POSITION"])
    .optional()
    .describe(
      "Optional. If omitted, derived from horizon (TRADE→SWING, TARGET→SWING, CATALYST→SWING, COMPOUNDER→POSITION). Pick from DAY / SWING / POSITION only — do NOT pass horizon values like 'TRADE' here, that field is `horizon`.",
    ),
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
  // Four weighted dimensions summing to 10. Locked structure: don't add
  // freeform "7/10 because vibes" — every score is the SUM of explicit
  // sub-scores with caps that force the agent to allocate attention across
  // the dimensions that actually matter for a setup-grade decision.
  //
  // Dimension caps:
  //   trendStrength      0-3   (1pt = trending; 3pts = clean multi-week trend)
  //   relativeStrength   0-3   (3pts = sector leader; 0 = laggard with leader available)
  //   entryQuality       0-2   (2pts = clean setup; 0 = extended chase / no setup)
  //   catalystFreshness  0-2   (2pts = catalyst still ahead; 0 = already played)
  //
  // R/R and portfolioFit are NOT scoring components — they're QUALITY-BAR
  // gates and PORTFOLIO-COMPARISON rules, applied separately in the
  // workflow. R/R < 2:1 = PASS regardless of composite. Worse than weakest
  // holding = WATCH or PASS regardless of composite.
  //
  // Required for Decision Framework v1 once the prompt lands. Optional for
  // this rollout commit so existing call sites don't break.
  scoring: z
    .object({
      trendStrength: z.object({
        score: z
          .number()
          .min(0)
          .max(3)
          .describe("0-3. Trend strength + structure. 0 = no trend / breaking down. 1 = sideways but constructive. 2 = trending. 3 = clean multi-week uptrend with rising MAs and no distribution."),
        note: z.string().describe("One sentence citing concrete trend evidence (e.g. 'multi-week uptrend, rising 50d, no major distribution candles')"),
      }),
      relativeStrength: z.object({
        score: z
          .number()
          .min(0)
          .max(3)
          .describe("0-3. Leader vs laggard within cohort. 0 = laggard while a leader has the same setup (PASS in favor of leader). 1 = mid-cohort. 2 = strong relative strength. 3 = clear sector leader, outperforming peers."),
        note: z.string().describe("Concrete relative-strength call (e.g. 'NVDA leads AI semis, +28% YTD vs AMD +14%, INTC -3%')"),
      }),
      entryQuality: z.object({
        score: z
          .number()
          .min(0)
          .max(2)
          .describe("0-2. Defined setup vs late-stage chase. 0 = extended >10% intraday / parabolic / no setup. 1 = OK setup with caveats. 2 = clean defined setup (breakout from base on volume, pullback to 20d in trend, post-earnings drift)."),
        note: z.string().describe("Setup name + entry context (e.g. 'pullback to 20d in trend, $185 entry vs $200 prior high — NOT a chase')"),
      }),
      catalystFreshness: z.object({
        score: z
          .number()
          .min(0)
          .max(2)
          .describe("0-2. Catalyst timing. 0 = already played (reported, moved, faded). 1 = mixed (catalyst behind but follow-through pattern visible). 2 = catalyst still ahead (earnings next week, FDA decision pending, upcoming product launch)."),
        note: z.string().describe("Specific catalyst + timing (e.g. 'Q1 earnings 4/29, expecting beat-and-raise on AI demand')"),
      }),
    })
    .optional()
    .describe(
      "Required composite scoring: trendStrength (0-3) + relativeStrength (0-3) + entryQuality (0-2) + catalystFreshness (0-2) = composite /10. Composite ≥ 7 is required for ADD/ROTATE eligibility. Below 7 must be PASS or WATCH. R/R and portfolio fit are separate quality-bar gates, NOT scoring components — apply them in the workflow."
    ),

  // ── Thesis Durable State (PR 1 + cleanup PR) ──────────────────────────
  // REQUIRED on every thesis. Drives the auto-default trigger merge + the
  // housekeeping nextReviewAt cadence + the tactical agent's exit policy.
  // Without horizon, the thesis is "naked" — no triggers, no review schedule,
  // no way for the trigger evaluator to do its job. We're not letting that
  // ship anymore.
  horizon: z
    .enum(["CATALYST", "TARGET", "TRADE", "COMPOUNDER"])
    .describe(
      "REQUIRED. Exit policy + trigger template for this thesis. Pick the kind that matches your reasoning, not just the holding period:\n" +
        "  • CATALYST — trade is built around a binary event (FDA decision, M&A close, court ruling, named earnings catalyst). Hold until the event resolves; ignore inter-event price drift.\n" +
        "  • TARGET — swing trade with a defined upside number from setup/fundamentals. Weeks-to-months. Exit at target, stop, or invalidation.\n" +
        "  • TRADE — momentum/pattern setup with a tight stop. Days-to-weeks. max_hold_days required (default 14).\n" +
        "  • COMPOUNDER — long-term hold based on durable business quality. Months-to-years. Quarterly hygiene only; never time-exits on price alone.\n" +
        "If you can't pick one, you don't have a thesis — write PASS instead.",
    ),
  core_belief: z
    .string()
    .optional()
    .describe(
      "The actual claim, separate from the trade rationale. 1-2 sentences stating what you believe will happen and why. Often overlaps with reasoning_summary on first creation; diverges as the thesis is updated.",
    ),
  key_assumptions: z
    .array(z.string())
    .optional()
    .describe(
      "Premises that must hold for this thesis to work. Each item is a single checkable claim (e.g. 'Datacenter capex stays above $200B/yr through 2027'). The agent re-evaluates these against fresh signals during housekeeping.",
    ),
  invalidation_conditions: z
    .array(z.string())
    .optional()
    .describe(
      "Specific things that would prove this thesis wrong. Used to decide when a signal counts as thesis-breaking. e.g. ['Guidance cut on next print', 'Sector ETF breaks 200d SMA'].",
    ),
  target_size_pct: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "% of portfolio at full position. Captures intent — actual position size may be smaller while scaling in or after a partial trim.",
    ),
  scaling_plan: z
    .array(
      z.object({
        pct: z.number().min(0).max(100),
        atPrice: z.number().optional(),
        atSignal: z.string().optional(),
        rationale: z.string(),
      }),
    )
    .optional()
    .describe(
      "Optional ladder for scaling in/out. e.g. [{pct: 33, rationale: 'starter'}, {pct: 33, atPrice: 175, rationale: 'add on pullback'}, {pct: 34, atSignal: 'earnings beat', rationale: 'full position post-print'}].",
    ),
  triggers: triggersArraySchema.optional(),
  catalyst_date: z
    .string()
    .datetime()
    .optional()
    .describe(
      "ISO timestamp. CATALYST horizon only — when the catalyst event is expected (e.g. earnings date, FDA decision date).",
    ),
  max_hold_days: z
    .number()
    .int()
    .positive()
    .max(365)
    .optional()
    .describe("TRADE horizon only. Default 14 if omitted."),
  next_review_at: z
    .string()
    .datetime()
    .optional()
    .describe(
      "When housekeeping should re-look at this thesis even with no trigger fire. Default derived from horizon: CATALYST = 1 day, TRADE = 1 day, TARGET = 7 days, COMPOUNDER = 30 days.",
    ),
  // Explicit status arg. Daily watchlist-review and weekly discovery both
  // need to write WATCHING; trade-eligible coverage stays ACTIVE. When
  // omitted the effective status is derived from source_kind:
  // WATCHLIST_REVIEW → WATCHING, everything else → ACTIVE. Direction is
  // independent — a WATCHING thesis can be LONG/SHORT (directional view
  // we're tracking) or PASS (we looked, decided no, want to keep eyes on
  // it for change-of-mind). The agent should pass status explicitly when
  // intent matters; the default keeps existing call sites working.
  status: z
    .enum(["ACTIVE", "WATCHING"])
    .optional()
    .describe(
      "Coverage status. ACTIVE = trade-eligible coverage (the agent intends to act now or imminently). WATCHING = on-the-radar coverage (watchlist review, discovery candidate, named-but-not-yet-actionable). Default is derived from source_kind — WATCHLIST_REVIEW → WATCHING, else ACTIVE — pass explicitly when the intent differs.",
    ),
  // Cross-analyst overlap acknowledgement. The tool blocks DAY-only
  // analysts from minting a thesis on a ticker another analyst on the
  // same account already covers ACTIVE/WATCHING in the same direction —
  // the day-trader's edge is the marginal intraday setup, not duplicate
  // coverage. To proceed anyway, pass a one-line rationale explaining
  // what's specifically intraday-distinct about this setup vs the
  // existing coverage. Non-DAY analysts ignore this field.
  acknowledge_cross_analyst_overlap: z
    .string()
    .optional()
    .describe(
      "DAY-only override. When another analyst already covers this ticker + direction, pass a one-line rationale explaining the day-trade-specific setup (e.g. 'opening-range breakout setup distinct from Tech Momentum's multi-week thesis'). Required to proceed in DAY-only configs; ignored otherwise.",
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

      // No-PASS-on-held gate. PASS = "researched, decided not to trade."
      // It is INCOMPATIBLE with an open position — minting PASS on a held
      // ticker is exactly the bug that left CAPR/ON/etc with zombie
      // PASS-ACTIVE rows blocking the trigger evaluator from doing its
      // job (cleanup applied 2026-04-29). If the agent's conviction has
      // dropped below trade-worthy on a name it currently holds, the
      // right tool is update_thesis (lower confidence + tighten stop) or
      // close_position + update_thesis(change_status: "INVALIDATED"),
      // not record_thesis(direction: "PASS").
      if (args.direction === "PASS" && ctx.analystId) {
        try {
          const heldPosition = await prisma.position.findFirst({
            where: {
              analystId: ctx.analystId,
              symbol: args.ticker,
              status: "OPEN",
            },
            select: { id: true, direction: true, quantity: true },
          });
          if (heldPosition) {
            console.warn(
              `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} REJECTED — PASS thesis on held position (${heldPosition.direction} ${heldPosition.quantity} sh).`
            );
            return {
              summary: `PASS thesis rejected for ${args.ticker}: position is currently OPEN.`,
              data: {
                thesis_id: null,
                status: "FAILED" as const,
                note:
                  `You currently hold ${heldPosition.direction} ${heldPosition.quantity} shares of ${args.ticker}. PASS is for tickers you researched and decided NOT to trade — it is incompatible with holding the name. ` +
                  `If your conviction on this position has dropped, the correct tools are:\n` +
                  `  • update_thesis(thesis_id, confidence_score: <lower>, stop_loss: <tighter>, rationale: "<why>") — keep the position but reflect lower conviction, OR\n` +
                  `  • close_position(...) followed by update_thesis(thesis_id, change_status: "INVALIDATED", rationale: "<why>") — exit the position and mark the thesis broken.\n` +
                  `Find the active LONG/SHORT thesis_id via get_theses(tickers: ["${args.ticker}"]) and call update_thesis. Do NOT retry record_thesis on ${args.ticker} with direction PASS — it will reject again.`,
              },
              sources: [],
            };
          }
        } catch (posErr) {
          console.warn(
            `[record-thesis] no-PASS-on-held check failed (non-fatal):`,
            posErr instanceof Error ? posErr.message : posErr
          );
        }
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

      // Provenance soft-nudge — Monitor ROI tracer hook (VISION Pillar 5).
      // When the agent picks non-ROUTED_SIGNAL provenance for a ticker that
      // appeared in this run's read_signals output, the chain
      //   Thesis.sourceSignalIds → Signal.monitorId → Monitor
      // loses its hook and the trade-evaluator can't credit the source
      // monitor on close. We log loud, append a hint to the success message,
      // but do NOT reject — a hard gate would risk a regression and the
      // thesis itself is fine. The fix is a prompt-level expectation; this
      // gives us telemetry on how often the agent ignores it AND reminds
      // the agent in-context for the rest of the run.
      let provenanceNudge: string | null = null;
      if (
        inferredSourceKind !== "ROUTED_SIGNAL" &&
        ctx.signalsByTicker &&
        ctx.analystId
      ) {
        const tickerKey = args.ticker.toUpperCase();
        const matchingSignals = ctx.signalsByTicker.get(tickerKey);
        if (matchingSignals && matchingSignals.size > 0) {
          const sample = Array.from(matchingSignals).slice(0, 3);
          console.warn(
            `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} provenance=${inferredSourceKind} ` +
              `but read_signals returned ${matchingSignals.size} matching signal(s) this run (e.g. ${sample.join(", ")}). ` +
              `Monitor ROI credit chain broken — agent should pass source_kind=ROUTED_SIGNAL with these IDs.`,
          );
          provenanceNudge =
            `Note: read_signals returned ${matchingSignals.size} signal${matchingSignals.size === 1 ? "" : "s"} on $${args.ticker} this run ` +
            `(IDs: ${sample.join(", ")}${matchingSignals.size > sample.length ? ", …" : ""}). ` +
            `Next time, pass source_kind:"ROUTED_SIGNAL" + source_signal_ids:[those IDs] so the trade-evaluator can credit the source monitor on close.`;
        }
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

      // Relative-ordering gate. The shape rule depends on direction:
      //   LONG  — target_price > entry_price > stop_loss
      //   SHORT — target_price < entry_price < stop_loss
      //   PASS  — no shape rule (reference levels, no trade plan)
      // Catches inverted-target theses at write time. PR #227 added the
      // same check at place_trade; this is the upstream cure that prevents
      // broken WATCHING rows from sitting in the watchlist for weeks
      // (2026-05-07 audit found 3 such rows on Earnings Drift / Secular
      // Theme dating back to April 23-27).
      const shapeCheck = validateThesisShape({
        direction: args.direction,
        entryPrice: args.entry_price ?? null,
        targetPrice: args.target_price ?? null,
        stopLoss: args.stop_loss ?? null,
      });
      if (!shapeCheck.ok) {
        console.warn(
          `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} REJECTED — invalid thesis shape (${shapeCheck.reason}).`,
        );
        return {
          summary: `Thesis rejected for ${args.ticker}: ${shapeCheck.reason}.`,
          data: {
            thesis_id: null,
            status: "FAILED" as const,
            note: shapeCheck.note,
          },
          sources: [],
        };
      }

      // Compute composite = SUM of the four weighted dimensions (caps:
      // 3+3+2+2 = 10). NOT an average — each dimension's cap is the weight,
      // so summing produces a score on the same /10 scale. ≥ 7 = ADD/ROTATE
      // eligible; < 7 must be PASS or WATCH. R/R and portfolio comparison
      // are separate gates, applied in the workflow.
      const scoringComposite = args.scoring
        ? args.scoring.trendStrength.score +
          args.scoring.relativeStrength.score +
          args.scoring.entryQuality.score +
          args.scoring.catalystFreshness.score
        : null;

      const fullResearch = {
        ...(args.fundamentals ? { fundamentals: args.fundamentals } : {}),
        ...(args.scoring
          ? { scoring: args.scoring, scoringComposite }
          : {}),
      };

      // Default nextReviewAt by horizon. Cheap, transparent, lets the
      // housekeeping run pick up theses without the agent having to do
      // the date math. Falls through to null when horizon is omitted —
      // legacy theses don't get an auto-review date.
      let nextReviewAt: Date | null = null;
      if (args.next_review_at) {
        nextReviewAt = new Date(args.next_review_at);
      } else if (args.horizon) {
        const now = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const days =
          args.horizon === "CATALYST"
            ? 1
            : args.horizon === "TRADE"
              ? 1
              : args.horizon === "TARGET"
                ? 7
                : 30; // COMPOUNDER
        nextReviewAt = new Date(now + days * dayMs);
      }

      // ── Effective status — derived once, used both for triggers and DB ──
      // We compute the held vs watching distinction up front so the
      // trigger factory below can pick the right template (ENTER triggers
      // for watching, EXIT triggers for held). Same logic as line 638's
      // effectiveStatus — kept in lockstep; if you change one, change both.
      const effectiveStatusForTriggers: "ACTIVE" | "WATCHING" =
        args.status ??
        (inferredSourceKind === "WATCHLIST_REVIEW" ? "WATCHING" : "ACTIVE");

      // ── Hoisted trigger build ─────────────────────────────────────────
      // Hoisted so we can run the watching ENTER-trigger guard below
      // BEFORE the row hits the DB. The guard inspects the merged final
      // array (defaults + agent-supplied + cooldown backfill) and rejects
      // WATCHING/LONG-or-SHORT theses with no ENTER actions — matches the
      // upstream guard in manage_watchlist.ts and closes the last creation
      // hole for inert watching theses.
      const mergedTriggers: Trigger[] = (() => {
        // Without horizon we can't pick a defaults template — agent's
        // raw triggers are all we have. Cooldown backfill still runs.
        if (!args.horizon) {
          return applyTriggerCooldownDefaults(
            (args.triggers ?? []) as Trigger[],
          );
        }
        const defaults = defaultTriggersForHorizon(
          args.horizon as Horizon,
          {
            entryPrice: args.entry_price ?? null,
            targetPrice: args.target_price ?? null,
            stopLoss: args.stop_loss ?? null,
            maxHoldDays: args.max_hold_days ?? null,
            catalystDate: args.catalyst_date ? new Date(args.catalyst_date) : null,
            direction: args.direction,
          },
          effectiveStatusForTriggers === "WATCHING" ? "WATCHING" : "HELD",
        );
        const merged = mergeTriggers(
          defaults,
          (args.triggers ?? []) as Trigger[],
        );
        return applyTriggerCooldownDefaults(merged);
      })();

      // ── ENTER-trigger guard (parity with manage_watchlist) ───────────
      // A WATCHING/LONG or WATCHING/SHORT thesis without an ENTER trigger
      // sits inert — the trigger evaluator has no entry-promotion path,
      // and the daily-run promotion check has no level to compare price
      // against. The default templates emit one off targetPrice; this
      // guard catches the cases where (a) targetPrice is missing or (b)
      // the agent passed an explicit triggers[] array that crowded out
      // the default ENTER via the (predicate.kind, action) merge bucket.
      // PASS theses are exempt — they're institutional memory, not
      // entry-gated.
      if (
        effectiveStatusForTriggers === "WATCHING" &&
        (args.direction === "LONG" || args.direction === "SHORT")
      ) {
        const hasEnter = mergedTriggers.some((t) => t.action === "ENTER");
        if (!hasEnter) {
          const reason =
            args.target_price == null
              ? `target_price is required on a directional WATCHING thesis — that's the level the ENTER trigger fires on. Either supply target_price (the breakout level for LONG, the breakdown level for SHORT) or set direction to PASS for institutional-memory-only entries.`
              : `Your supplied triggers[] array displaced the default ENTER trigger via the (predicate, action) merge bucket. Add a trigger with action: "ENTER" and a price predicate (PRICE_ABOVE for LONG, PRICE_BELOW for SHORT) at the entry level — without it the watchlist trigger pipeline can't promote this thesis.`;
          console.warn(
            `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} REJECTED — WATCHING ${args.direction} with no ENTER trigger.`,
          );
          return {
            summary: `Thesis rejected for ${args.ticker}: WATCHING ${args.direction} requires an ENTER trigger.`,
            data: {
              thesis_id: null,
              status: "FAILED" as const,
              note: reason,
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
        // Derive hold_duration from horizon when the agent didn't provide
        // one (or passed a horizon value like "TRADE" by mistake — schema
        // already rejects those, but the fallback runs anyway).
        // Mapping: COMPOUNDER → POSITION, everything else → SWING.
        // DAY is intentionally never auto-picked; agents that want DAY
        // must pass it explicitly.
        holdDuration:
          args.hold_duration ??
          (args.horizon === "COMPOUNDER" ? "POSITION" : "SWING"),
        signalTypes: args.signal_types,
        sourcesUsed: args.sources_used ?? [],
        sourceSignalIds,
        sourceKind: inferredSourceKind,
        sourceRationale: sourceRationale.length > 0 ? sourceRationale : null,
        fullResearch: Object.keys(fullResearch).length > 0 ? fullResearch : undefined,
        source: "AGENT",
        modelUsed: "gpt-4o",
        // ── Durable-state fields (PR 1) ─────────────────────────────────
        horizon: args.horizon ?? null,
        coreBelief: args.core_belief ?? null,
        keyAssumptions: args.key_assumptions ?? [],
        invalidationConds: args.invalidation_conditions ?? [],
        targetSizePct: args.target_size_pct ?? null,
        scalingPlan: args.scaling_plan
          ? (args.scaling_plan as object)
          : undefined,
        // mergedTriggers built and validated above the coreData literal.
        // Centralized so the ENTER-trigger guard can inspect the final
        // array (defaults + agent + cooldown) BEFORE the row hits the
        // DB. See the build block above for the templating rules.
        triggers: mergedTriggers as object[],
        catalystDate: args.catalyst_date ? new Date(args.catalyst_date) : null,
        maxHoldDays:
          args.max_hold_days ?? (args.horizon === "TRADE" ? 14 : null),
        nextReviewAt,
      };

      // ── Same-direction guard ────────────────────────────────────────
      // The durable model is ONE Thesis row per (analyst, ticker) evolving
      // over time via update_thesis. record_thesis is reserved for:
      //   1. New coverage (no existing thesis on this ticker), OR
      //   2. Direction flips (LONG → SHORT, PASS → LONG, etc.), OR
      //   3. Replacing a previously INVALIDATED/CLOSED thesis with a
      //      fundamentally new belief.
      //
      // If an ACTIVE/WATCHING same-direction thesis already exists, reject
      // and tell the agent to use update_thesis instead. Without this guard,
      // every morning run on a held or watched name would auto-supersede
      // yesterday's row and mint a fresh chain — exactly the chained-
      // replacement pattern we're moving away from.
      //
      // PASS is included in the search (was excluded prior to 2026-04-30):
      // a fresh PASS on a ticker that already has a PASS thesis should
      // redirect to update_thesis (writes a REVIEWED entry — the analyst
      // looked again and the conclusion is unchanged). Without this, every
      // morning's watchlist-review run minted a new ACTIVE+PASS row,
      // chaining forever. PASS-on-LONG / PASS-on-SHORT etc. still take the
      // direction-flip branch below (parent gets INVALIDATED, new PASS
      // thesis lands).
      //
      // Normalize empty-string parent_thesis_id to null. The agent
      // sometimes passes "" instead of omitting the field; without this,
      // the eventual prisma.thesis.create() FK-violates because no row
      // has id "". Pre-existing bug surfaced when MSFT theses started
      // failing to save with `Foreign key constraint violated on
      // Thesis_parentThesisId_fkey`.
      const rawParentId = args.parent_thesis_id?.trim() ?? "";
      let resolvedParentId: string | null = rawParentId.length > 0 ? rawParentId : null;
      if (!resolvedParentId && ctx.analystId) {
        try {
          const existingThesis = await prisma.thesis.findFirst({
            where: {
              ticker: args.ticker,
              status: { in: ["ACTIVE", "WATCHING"] },
              researchRun: { agentConfigId: ctx.analystId },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, direction: true, status: true },
          });
          if (existingThesis) {
            if (existingThesis.direction === args.direction) {
              // Same-direction reject. The agent should be calling
              // update_thesis here.
              // Status is USE_UPDATE_THESIS — not FAILED. The morning-run
              // process gate counts ThesisUpdate touches via runId, so an
              // update_thesis follow-up will satisfy the gate. Renderer
              // pivots to existing_thesis_id when thesis_id is null so
              // the rejected card still opens the real thesis timeline.
              //
              // The note is prescriptive and includes the exact next-tool
              // call shape — past prompts have shown GPT-4o reads the
              // rejection and gives up rather than retrying. Keep this
              // imperative.
              return {
                summary: `Use update_thesis for ${args.ticker} — an active ${existingThesis.direction} thesis already exists.`,
                data: {
                  thesis_id: null,
                  status: "USE_UPDATE_THESIS" as const,
                  existing_thesis_id: existingThesis.id,
                  ticker: args.ticker,
                  note:
                    `NOT a failure — this is a redirect. An active ${existingThesis.direction} thesis already exists for ${args.ticker} (id ${existingThesis.id}). ` +
                    `YOUR NEXT TOOL CALL MUST BE update_thesis with this shape:\n` +
                    `  update_thesis({\n` +
                    `    thesis_id: "${existingThesis.id}",\n` +
                    `    rationale: "<one-line: why you're touching this thesis today>",\n` +
                    `    // Plus any of these you actually want to change:\n` +
                    `    target_price: <new>,\n` +
                    `    stop_loss: <new>,\n` +
                    `    confidence_score: <new>,\n` +
                    `    reasoning_summary: "<refreshed>",\n` +
                    `    signal_ids: [<from today's read_signals>],\n` +
                    `  })\n` +
                    `If you reviewed and nothing actually changed, call update_thesis with ONLY thesis_id + rationale — that writes a REVIEWED entry and counts as the required thesis touch for this run. ` +
                    `record_thesis is reserved for new coverage on a NEW ticker or direction flips (LONG ↔ SHORT). Do NOT retry record_thesis on ${args.ticker} — it will reject again.`,
                },
                sources: [],
              };
            }
            // Direction flip — allow the chain. Parent gets INVALIDATED on
            // PASS or SUPERSEDED otherwise (existing logic below).
            resolvedParentId = existingThesis.id;
          }
        } catch { /* non-fatal */ }
      }

      // ── Cross-analyst overlap guard (DAY-only) ──────────────────────────
      // Day-traders should pick fresh names from today's tape, not lean on
      // tickers another analyst already covers. Observed in production
      // 2026-05-07: a fresh DAY analyst minted theses on AMD/MU/SMCI —
      // every one already covered ACTIVE/WATCHING by another analyst on
      // the same account. The intraday workflow degenerated into "review
      // the rest of the book's tickers" instead of net-new discovery.
      //
      // For DAY-only analysts: block when another analyst has the same
      // (ticker, direction) ACTIVE/WATCHING. Override allowed via
      // acknowledge_cross_analyst_overlap with a rationale — the marginal
      // intraday setup may genuinely be distinct from a multi-week thesis.
      // Non-DAY analysts: no check (overlapping coverage across time
      // horizons is a feature, not a bug).
      if (ctx.analystId && ctx.userId && args.direction !== "PASS") {
        try {
          const thisAnalyst = await prisma.agentConfig.findFirst({
            where: { id: ctx.analystId },
            select: { holdDurations: true },
          });
          const isDayOnly =
            (thisAnalyst?.holdDurations ?? []).length > 0 &&
            (thisAnalyst?.holdDurations ?? []).every(
              (h: string) => h.toUpperCase() === "DAY",
            );
          if (isDayOnly && !args.acknowledge_cross_analyst_overlap) {
            const otherAnalystThesis = await prisma.thesis.findFirst({
              where: {
                ticker: args.ticker,
                direction: args.direction,
                status: { in: ["ACTIVE", "WATCHING"] },
                researchRun: {
                  agentConfig: {
                    userId: ctx.userId,
                    id: { not: ctx.analystId },
                  },
                },
              },
              orderBy: { createdAt: "desc" },
              select: {
                id: true,
                status: true,
                researchRun: {
                  select: { agentConfig: { select: { id: true, name: true } } },
                },
              },
            });
            if (otherAnalystThesis) {
              const otherName =
                otherAnalystThesis.researchRun.agentConfig?.name ?? "another analyst";
              return {
                summary: `${args.ticker} already covered ${otherAnalystThesis.status} ${args.direction} by ${otherName} — pick a fresh name or pass acknowledge_cross_analyst_overlap.`,
                data: {
                  thesis_id: null,
                  status: "CROSS_ANALYST_OVERLAP" as const,
                  ticker: args.ticker,
                  conflicting_analyst: otherName,
                  conflicting_thesis_id: otherAnalystThesis.id,
                  conflicting_status: otherAnalystThesis.status,
                  note:
                    `${args.ticker} (${args.direction}) is already covered ${otherAnalystThesis.status} by ${otherName} (thesis ${otherAnalystThesis.id}). ` +
                    `As a DAY-only analyst, your edge is the intraday setup — duplicating swing/position coverage doesn't add edge to this account. ` +
                    `OPTIONS:\n` +
                    `  1. (preferred) Pick a different name from today's movers list. Plenty of net-new candidates above your $5B cap floor.\n` +
                    `  2. (override) If today's intraday setup is genuinely distinct from ${otherName}'s thesis (e.g. opening-range breakout vs multi-week earnings drift), retry record_thesis with acknowledge_cross_analyst_overlap: "<one-line rationale>".\n` +
                    `Do NOT retry without one of these — the same block will fire again.`,
                },
                sources: [],
              };
            }
          }
        } catch { /* non-fatal — overlap check is advisory, not blocking on error */ }
      }

      // Effective status: explicit `status` arg wins; otherwise derive
      // from source_kind. WATCHLIST_REVIEW (and the watchlist-collapse
      // call sites that follow) → WATCHING; everything else → ACTIVE.
      // This is the producer fix that makes the WATCHING enum value
      // (consumed by trigger-evaluator, morning-brief-generator,
      // tactical-run, get-theses, update-thesis) actually populated.
      // Reuse the value we hoisted earlier for the trigger factory so
      // status, triggers, and the DB row never disagree.
      const effectiveStatus = effectiveStatusForTriggers;

      let thesis;
      try {
        thesis = await prisma.thesis.create({
          data: { ...coreData, status: effectiveStatus, parentThesisId: resolvedParentId },
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
            // PR 1 durable-state columns — also strip if Prisma client is
            // out of sync with the schema.
            horizon: _horizon,
            coreBelief: _belief,
            keyAssumptions: _assumptions,
            invalidationConds: _invalid,
            targetSizePct: _size,
            scalingPlan: _scaling,
            triggers: _triggers,
            catalystDate: _cdate,
            maxHoldDays: _maxhold,
            nextReviewAt: _review,
            ...fallbackData
          } = coreData;
          void _ids;
          void _kind;
          void _rationale;
          void _horizon;
          void _belief;
          void _assumptions;
          void _invalid;
          void _size;
          void _scaling;
          void _triggers;
          void _cdate;
          void _maxhold;
          void _review;
          thesis = await prisma.thesis.create({
            data: { ...fallbackData, status: effectiveStatus },
          });
          resolvedParentId = null;
        } else {
          // Any other error is a real failure — log with full context and throw.
          console.error(
            `[tool] record_thesis create() FAILED for ${args.ticker}: ${errMsg}`
          );
          throw v2Err;
        }
      }

      // ── ThesisUpdate(CREATED) — durable activity log ─────────────────
      // Single source of truth for thesis history. Non-fatal: if this
      // fails the thesis still landed; we just lose the timeline row.
      // Logs LOUD so we notice if writes start dropping.
      const createdSummary =
        args.direction === "PASS"
          ? `Passed on ${args.ticker}`
          : `${args.direction} thesis on ${args.ticker} at confidence ${args.confidence_score}`;
      await writeThesisUpdate({
        thesisId: thesis.id,
        type: "CREATED",
        summary: createdSummary,
        rationale: args.reasoning_summary,
        signalIds: sourceSignalIds,
        runId: ctx.runId,
        priceAtTime: args.entry_price ?? null,
      });

      // Transition parent thesis lifecycle.
      if (resolvedParentId) {
        try {
          if (args.direction === "PASS") {
            const invalidReason =
              args.reasoning_summary?.slice(0, 500) ||
              "Thesis invalidated by follow-up research";
            await prisma.thesis.update({
              where: { id: resolvedParentId },
              data: {
                status: "INVALIDATED",
                invalidatedAt: new Date(),
                invalidReason,
              },
            });
            await writeThesisUpdate({
              thesisId: resolvedParentId,
              type: "INVALIDATED",
              summary: `Invalidated by PASS thesis on ${args.ticker}`,
              rationale: invalidReason,
              fieldChanges: {
                status: { from: "ACTIVE", to: "INVALIDATED" },
              },
              runId: ctx.runId,
              // Same moment as the new thesis — capture current price so
              // the parent's terminal-state row carries context.
              priceAtTime: args.entry_price ?? null,
            });
          } else {
            await prisma.thesis.update({
              where: { id: resolvedParentId },
              data: { status: "SUPERSEDED" },
            });
            await writeThesisUpdate({
              thesisId: resolvedParentId,
              type: "SUPERSEDED",
              summary: `Replaced by newer ${args.direction} thesis on ${args.ticker}`,
              rationale: args.reasoning_summary,
              fieldChanges: {
                status: { from: "ACTIVE", to: "SUPERSEDED" },
              },
              runId: ctx.runId,
              priceAtTime: args.entry_price ?? null,
            });
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
        summary:
          `Thesis recorded: ${args.direction} ${args.ticker} (${effectiveStatus.toLowerCase()}, confidence: ${args.confidence_score})` +
          (provenanceNudge ? ` — ${provenanceNudge}` : ""),
        data: {
          thesis_id: thesis.id,
          status: effectiveStatus,
          ...(provenanceNudge ? { provenance_nudge: provenanceNudge } : {}),
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
