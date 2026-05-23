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
import { validateThesisBelief } from "@/lib/agent/thesis-belief";
import {
  HORIZON_REVIEW_DAYS,
  WATCHING_FIRST_REVIEW_DAYS,
  holdDurationFromHorizon,
  type Horizon as HorizonPolicy,
} from "@/lib/agent/horizon-policy";

// ── V2 deep-research section shapes (PR-9 flat schema cutover) ───────────
// Two content shapes for the 9 sections, mirroring the parsed output of
// write_thesis_research. See docs/plans/THESIS_CLEANUP.md §1.2.
const sectionCitationSchema = z
  .object({
    url: z.string().optional(),
    title: z.string().optional(),
    domain: z.string().optional(),
    kind: z.enum(["STRUCTURED", "WEB"]).optional(),
  })
  .describe("Citation chip (one URL or [STRUCTURED:...] reference).");

const sectionTextSchema = z
  .object({
    text: z.string(),
    citations: z.array(sectionCitationSchema).optional(),
  })
  .describe("Prose paragraph with optional citations.");

const sectionBulletSchema = z
  .object({
    bullets: z.array(
      z.object({
        text: z.string(),
        citation: sectionCitationSchema.optional(),
      }),
    ),
  })
  .describe("Bulleted list, one citation per bullet.");

const thesisFields = z.object({
  ticker: z.string(),
  company_name: z.string().optional().describe("Company name from get_stock_data"),
  exchange: z.string().optional().describe("Exchange from get_stock_data, e.g. NASDAQ"),
  direction: z.enum(["LONG", "SHORT", "PASS", "PENDING"]),
  // ── Narrative fields ─────────────────────────────────────────────────
  // Legacy plain-string args. Kept on the Zod schema so the daily-run +
  // discovery agents that haven't been migrated to the V2 narrative shape
  // can still write theses. Execute() wraps them in the new flat-column
  // shape ({text, citations:[]} / {bullets:[{text}]}) before persistence.
  // V2 thesis-writer agent should pass `snapshot`/`bull_case`/`bear_case`
  // directly with citations.
  reasoning_summary: z
    .string()
    .optional()
    .describe(
      "2-3 sentence summary of your thesis. For PASS: explain what you found AND why it doesn't fit your strategy right now. Legacy plain-string shape — V2 agents prefer `snapshot: { text, citations }`.",
    ),
  thesis_bullets: z
    .array(z.string())
    .optional()
    .describe(
      "3-5 key points supporting the thesis. Legacy shape — V2 agents prefer `bull_case: { bullets: [{ text, citation }] }`.",
    ),
  risk_flags: z
    .array(z.string())
    .optional()
    .describe(
      "2-4 key risks. Legacy shape — V2 agents prefer `bear_case: { bullets: [{ text, citation }] }`.",
    ),
  entry_price: z.number().optional().describe("Current price for entry. REQUIRED for LONG/SHORT — use the price from get_stock_data. Also include for PASS to enable shadow tracking."),
  target_price: z.number().optional().describe("Price target. REQUIRED for LONG/SHORT."),
  stop_loss: z.number().optional().describe("Stop-loss price. REQUIRED for LONG/SHORT."),
  // `hold_duration` arg removed 2026-05-18 (THESIS_CLEANUP PR-4). The
  // value is derived from horizon at render time via
  // holdDurationFromHorizon() — agents shouldn't have to think about it,
  // and historically half of failed record_thesis calls were agents
  // passing a horizon value ("TRADE") to this field by mistake.
  //
  // `confidence_score`, `signal_types`, `sources_used` args removed in
  // PR-9 (2026-05-21) — the columns are dropped from the DB.
  // Confidence ⇒ `scoring.composite` (the /10 setup grade is the single
  // conviction number). Signal types ⇒ derivable from `source_signal_ids`.
  // Sources ⇒ per-section citations inside the 9 narrative columns.
  fundamentals: z
    .object({
      // All numeric fundamentals accept null — get_stock_data legitimately
      // returns null for unstable PE (negative earnings), 52w highs that
      // haven't established yet, or zero-volume thin names. Plain
      // .optional() rejects null at the Zod layer and forces the agent
      // into a retry loop that fabricates 0 just to land the call (see
      // 2026-05-13 INTC discovery run: first record_thesis rejected on
      // pe_ratio:null, agent retried with pe_ratio:0 which is misleading).
      market_cap: z.number().nullable().optional(),
      pe_ratio: z.number().nullable().optional(),
      beta: z.number().nullable().optional(),
      avg_volume: z.number().nullable().optional(),
      high_52w: z.number().nullable().optional(),
      low_52w: z.number().nullable().optional(),
      sector: z.string().nullable().optional(),
      analyst_consensus: z.object({ buy: z.number(), hold: z.number(), sell: z.number() }).nullable().optional(),
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
    .enum([
      "ROUTED_SIGNAL",
      "WEB_SEARCH",
      "WATCHLIST_REVIEW",
      "POSITION_REVIEW",
      "USER_ADDED",
      "BUILDER_SEED",
      "EDITOR_SEED",
    ])
    .optional()
    .describe(
      "Where this thesis came from. ROUTED_SIGNAL = informed by a signal from read_signals (requires non-empty source_signal_ids). WEB_SEARCH = came from a live web_search call only. WATCHLIST_REVIEW = triggered by reviewing your own watchlist. POSITION_REVIEW = triggered by reviewing an open position. USER_ADDED/BUILDER_SEED/EDITOR_SEED are reserved for non-agent code paths (UI manual add, analyst-creation, editor chat) and should not be passed by the agent."
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
      "REQUIRED for LONG/SHORT. ONE sentence stating WHAT you believe will happen and why — the durable claim that, if it stops being true, the thesis is broken (e.g. \"AI capex sustains $200B/quarter through 2026, driving NVDA's gross margin above 75%\"). Distinct from reasoning_summary (the current-state framing, refreshed often); core_belief is the load-bearing claim. Optional only for direction=PASS.",
    ),
  key_assumptions: z
    .array(z.string())
    .optional()
    .describe(
      "REQUIRED for LONG/SHORT — must contain ≥2 specific premises. Each item is a single checkable claim that must remain true for core_belief to hold (e.g. \"Datacenter capex stays above $200B/yr through 2027\", \"No breakup of preferred customer relationship\"). Generic prose like \"strong fundamentals\" is insufficient — the tactical agent re-evaluates these against fresh signals to decide whether a trigger fire is thesis-breaking. Optional only for direction=PASS.",
    ),
  invalidation_conditions: z
    .array(z.string())
    .optional()
    .describe(
      "REQUIRED for LONG/SHORT — must contain ≥2 specific items. Concrete things that would prove this thesis wrong (e.g. \"Guidance cut on next print\", \"Gross margin below 70% on next print\", \"CFO departure\"). Generic risks like \"market volatility\" are insufficient. Used by the trade evaluator to grade exits and by the daily-run prompt to decide when a signal counts as thesis-breaking. Optional only for direction=PASS.",
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
      "ISO timestamp. REQUIRED when horizon=CATALYST — when the dated event lands (earnings date, FDA decision, M&A close, court ruling). Drives the trigger template (filings + earnings REVIEW around the date) and the 30d-past-event exit policy. If you don't know the date, this isn't a CATALYST thesis — use TRADE (with max_hold_days) or TARGET (open-ended).",
    ),
  max_hold_days: z
    .number()
    .int()
    .positive()
    .max(365)
    .optional()
    .describe(
      "REQUIRED when horizon=TRADE — declares the time-exit window for this short-term setup. Typical values: 5-7 for tight intraday/breakout, 10-14 for swing patterns. The TIME_ELAPSED trigger fires a REVIEW at this many days. There is NO silent default — set it explicitly or pick TARGET if you want open-ended.",
    ),
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

  // ── Deep-research artifacts (THESIS_RESEARCH_V2 Phase 1) ───────────────
  // Populated by the thesis-writer agent after calling write_thesis_research.
  // researchData is the raw markdown data block (~3-5KB) the synthesis
  // consumed; lands on Thesis.researchData for audit/debug. The 9 narrative
  // sections below each persist to their own first-class JSONB column —
  // PR-9 flattened the researchSections blob (see CLEANUP §1.3).
  research_data: z
    .string()
    .optional()
    .describe(
      "Raw structured-data markdown block from write_thesis_research(...).data.rawDataBlock. " +
        "Pass through verbatim. Lands on Thesis.researchData for the card's data tab.",
    ),

  // ── 9 narrative sections (PR-9 flat schema) ──────────────────────────
  // Three of these (snapshot/bull_case/bear_case) take precedence over the
  // legacy plain-string args (reasoning_summary/thesis_bullets/risk_flags)
  // when both are supplied. The other six don't have legacy counterparts.
  snapshot: sectionTextSchema
    .optional()
    .describe(
      "Snapshot section (V2): 1 paragraph current-state framing with citations. Supersedes `reasoning_summary` when present.",
    ),
  recent_catalysts: sectionTextSchema
    .optional()
    .describe(
      "Recent Catalysts section (V2): 1 paragraph covering the 1-2 week catalyst window for this ticker.",
    ),
  fundamentals_section: sectionTextSchema
    .optional()
    .describe(
      "Fundamentals section (V2): 1 paragraph + optional segment-breakdown narrative. Lands on Thesis.fundamentals (the narrative column). Distinct from the legacy structured `fundamentals` arg (market_cap / pe_ratio / etc.) which is UI-only.",
    ),
  latest_earnings: sectionBulletSchema
    .optional()
    .describe(
      "Latest Earnings section (V2): 5 specific earnings-call-derived bullets.",
    ),
  catalysts_and_events: sectionBulletSchema
    .optional()
    .describe(
      "Catalysts & Events section (V2): 3-5 dated upcoming-catalyst bullets.",
    ),
  bull_case: sectionBulletSchema
    .optional()
    .describe(
      "Bull Case section (V2): 3-5 cited bull bullets. Supersedes `thesis_bullets` when present.",
    ),
  bear_case: sectionBulletSchema
    .optional()
    .describe(
      "Bear Case section (V2): 3-5 cited bear bullets (mandatory even on LONG). Supersedes `risk_flags` when present.",
    ),
  analyst_consensus: sectionTextSchema
    .optional()
    .describe(
      "Analyst Consensus section (V2): 1 paragraph firm-by-firm consensus synthesis.",
    ),
  insider_technical: sectionTextSchema
    .optional()
    .describe(
      "Insider & Technical section (V2): 1 paragraph insider activity + technical setup.",
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
    "STAGE 3 ONLY. Write a thesis for every ticker you researched in Stage 2, back to back, in one batch. Direction must be LONG, SHORT, or PASS — PASS theses are mandatory for tickers you researched but won't trade, they document the decision. Never call this in Stage 2 (research) or Stage 4 (execution). Never write a verdict as narration text instead of calling this tool. " +
    "Structural-belief gate: directional theses (LONG/SHORT) MUST include core_belief (1 sentence), key_assumptions (≥2 specific items), and invalidation_conditions (≥2 specific items). Without all three the call is rejected — these fields drive the trade evaluator's post-mortem, the tactical agent's invalidation reasoning, and the daily run's assumption-drift checks. PASS theses are exempt.",
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
      // PENDING is reserved for non-agent server actions (addWatchlistItem,
      // createAnalystFromConfig, editor analyst-update). Agents always
      // commit to LONG / SHORT / PASS. If the agent wants to promote an
      // existing PENDING thesis to a real view, the path is
      // update_thesis(thesis_id, direction: "LONG"|"SHORT"|"PASS", ...).
      if (args.direction === "PENDING") {
        return {
          summary: `Thesis rejected for ${args.ticker}: agents cannot mint PENDING.`,
          data: {
            thesis_id: null,
            status: "FAILED" as const,
            note:
              `PENDING is reserved for user/builder/editor seeds (UI manual add, analyst creation, editor chat). ` +
              `As an agent, you commit to a view: LONG, SHORT, or PASS. ` +
              `If you're trying to promote an existing PENDING thesis on this ticker, call update_thesis(thesis_id, direction: "LONG"|"SHORT"|"PASS", ...) with the structural fields. ` +
              `If you want net-new coverage, pick LONG/SHORT (with target/stop/belief) or PASS (with invalidation_conditions).`,
          },
          sources: [],
        };
      }

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
                  `  • update_thesis(thesis_id, scoring: { ... lower composite }, stop_loss: <tighter>, rationale: "<why>") — keep the position but reflect lower conviction, OR\n` +
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

      // Structural-belief gate (P0-1). Directional theses MUST carry the
      // durable claim + the falsifiable premises + the things that would
      // prove them wrong. Audit 2026-05-07: 32% / 32% / 38% population
      // across 53 open theses; one analyst at 0% on all three. Without
      // these fields the thesis is a paragraph of vibes — the trade
      // evaluator can't grade against a falsifiable claim, the tactical
      // agent can't decide whether a trigger fire is thesis-breaking,
      // and the daily run can't tell when an assumption has flipped.
      // PASS theses bypass — they're "researched, decided not to trade"
      // and live in reasoning_summary + thesis_bullets + risk_flags.
      const beliefCheck = validateThesisBelief({
        direction: args.direction,
        coreBelief: args.core_belief ?? null,
        keyAssumptions: args.key_assumptions ?? null,
        invalidationConds: args.invalidation_conditions ?? null,
      });
      if (!beliefCheck.ok) {
        console.warn(
          `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} REJECTED — missing structural belief (${beliefCheck.missingFields.join(", ")}).`,
        );
        return {
          summary: `Thesis rejected for ${args.ticker}: missing ${beliefCheck.missingFields.join(", ")}.`,
          data: {
            thesis_id: null,
            status: "FAILED" as const,
            note: beliefCheck.note,
          },
          sources: [],
        };
      }

      // ── Conditional-requireds gate ─────────────────────────────────────
      // Some horizon × field combinations are structurally required but
      // were silently defaulted before this gate landed. Make them
      // explicit at write time so the durable thesis row reflects what
      // the agent actually decided, not what defaultTriggersForHorizon
      // happened to fall through to.
      //
      //   horizon=CATALYST → catalyst_date REQUIRED. The whole point of
      //                      a CATALYST trade is the dated event; the
      //                      trigger templates and the 30d-past-event
      //                      exit policy both key off it.
      //   horizon=TRADE    → max_hold_days REQUIRED (no default). 14
      //                      used to be the silent fallback. Force the
      //                      agent to declare the window so a TRADE
      //                      thesis isn't quietly auto-extended past
      //                      its intended life.
      // PASS theses bypass — they're not actionable plans.
      const isDirectional = args.direction === "LONG" || args.direction === "SHORT";
      if (isDirectional && args.horizon === "CATALYST" && !args.catalyst_date) {
        console.warn(
          `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} REJECTED — CATALYST horizon without catalyst_date.`,
        );
        return {
          summary: `Thesis rejected for ${args.ticker}: CATALYST requires catalyst_date.`,
          data: {
            thesis_id: null,
            status: "FAILED" as const,
            note:
              `CATALYST horizon means the trade is built around a specific dated event (FDA decision, M&A close, named earnings, court ruling). ` +
              `The catalyst_date drives the trigger template (filings + earnings REVIEW around the date) and the 30d-past-event exit policy. ` +
              `Pass catalyst_date as an ISO timestamp (e.g. "2026-06-15T20:30:00Z" for AMC earnings on 6/15). ` +
              `If you don't actually know when the catalyst lands, this isn't a CATALYST thesis — pick TRADE (max_hold_days bounds it) or TARGET (open-ended) instead.`,
          },
          sources: [],
        };
      }
      if (isDirectional && args.horizon === "TRADE" && args.max_hold_days == null) {
        console.warn(
          `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} REJECTED — TRADE horizon without explicit max_hold_days.`,
        );
        return {
          summary: `Thesis rejected for ${args.ticker}: TRADE requires explicit max_hold_days.`,
          data: {
            thesis_id: null,
            status: "FAILED" as const,
            note:
              `TRADE horizon means a bounded short-term setup (days-to-weeks) with a hard time exit. ` +
              `Pass max_hold_days explicitly — typical values are 5-7 for tight intraday/breakout setups, 10-14 for swing patterns. ` +
              `The TIME_ELAPSED trigger will fire a REVIEW at this many days; without it set, the thesis silently auto-extends past its intended window. ` +
              `If you want open-ended (no time exit), use TARGET instead.`,
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

      // Top-level scoring column (promoted from fullResearch.scoring on
      // 2026-05-18 — THESIS_CLEANUP PR-1). Composite folds in as a peer
      // key alongside the four dimensions.
      const scoring = args.scoring
        ? { ...args.scoring, composite: scoringComposite }
        : null;

      // PR-4 (2026-05-18): we no longer write `fullResearch` — the
      // `scoring` block is now top-level (PR-1), and the legacy
      // `fundamentals` sub-key had zero readers. The column itself drops
      // in PR-5 after the soak.

      // Default nextReviewAt by horizon AND by resulting status. WATCHING
      // theses use the longer WATCHING_FIRST_REVIEW_DAYS cadence (e.g.
      // COMPOUNDER WATCHING = 90d, vs. COMPOUNDER ACTIVE = 30d). A
      // watchlist entry doesn't need walking at the same intensity as a
      // live position. Pre-fix, every newly-minted WATCHING got the
      // held-side cadence and fired REVIEW_DUE ~3-12x more often than
      // intended, producing tactical busywork on stale watchlist names.
      //
      // Mirror of the effective-status logic below (line ~745) — kept
      // local instead of hoisting the whole block because the canonical
      // computation also needs args.status for downstream legal-pair
      // guards. Both derivations branch on the same inputs so they
      // can't disagree.
      const isDiscoveryDirectionalEarly =
        ctx.discoveryOnly === true &&
        (args.direction === "LONG" || args.direction === "SHORT");
      const willBeWatching: boolean =
        args.direction !== "PASS" &&
        (isDiscoveryDirectionalEarly ||
          args.status === "WATCHING" ||
          (args.status == null && inferredSourceKind === "WATCHLIST_REVIEW"));

      let nextReviewAt: Date | null = null;
      if (args.direction === "PASS") {
        // PASS = ARCHIVED at write. No review cadence, no wake-up.
        nextReviewAt = null;
      } else if (args.next_review_at) {
        nextReviewAt = new Date(args.next_review_at);
      } else if (args.horizon) {
        const dayMs = 24 * 60 * 60 * 1000;
        const horizonKey = args.horizon as HorizonPolicy;
        const days = willBeWatching
          ? WATCHING_FIRST_REVIEW_DAYS[horizonKey]
          : HORIZON_REVIEW_DAYS[horizonKey];
        nextReviewAt = new Date(Date.now() + days * dayMs);
      }

      // ── Effective status — derived from (direction, status) pair ──
      // Watchlist-collapse legal pairs:
      //   PENDING → WATCHING (only)
      //   PASS    → ARCHIVED (only, terminal at write)
      //   LONG/SHORT → WATCHING (default) or ACTIVE (explicit)
      // Anything else is rejected.
      // After the PENDING-rejection at the top of execute(), args.direction
      // is narrowed to LONG | SHORT | PASS.
      //
      // 2026-05-13 — discovery hard-clamp for LONG/SHORT (additive on top
      // of the legal-pair mapping). Discovery agents previously landed
      // status=ACTIVE on high-conviction LONG/SHORT mints — the prompt
      // instruction was advisory and GPT-4o overrode it (see INTC mint
      // cmp3i0y01 on 2026-05-13). ACTIVE attaches HELD-template triggers
      // (EXIT on stop_loss, REVIEW on target_hit) but no place_trade
      // fires, so the trigger evaluator later fires orphan tactical EXIT
      // runs that fail silently. Discovery is a WATCHING-mint surface by
      // design; ACTIVE promotion is the daily run's job (portfolio-fit
      // comparison + place_trade pairing). PASS is unaffected — it maps
      // to ARCHIVED in the same step below.
      const isDiscoveryDirectional =
        ctx.discoveryOnly === true &&
        (args.direction === "LONG" || args.direction === "SHORT");
      if (isDiscoveryDirectional && args.status === "ACTIVE") {
        console.warn(
          `[record-thesis] Analyst=${ctx.analystId} ticker=${args.ticker} — agent requested ACTIVE in discovery mode; forced WATCHING. Promotion is the daily-run's job.`,
        );
      }
      const effectiveStatusForTriggers: "ACTIVE" | "WATCHING" | "ARCHIVED" =
        args.direction === "PASS"
          ? "ARCHIVED"
          : isDiscoveryDirectional
            ? "WATCHING"
            : args.status ??
              (inferredSourceKind === "WATCHLIST_REVIEW" ? "WATCHING" : "ACTIVE");

      // ── Discovery LONG/SHORT WATCHING cap (Layer-1 enforcement) ────────
      // The discovery prompt has a soft cap ("mint up to 8 new WATCHING
      // theses per run") that GPT-4o doesn't honor — 2026-05-17's run
      // produced 7-8 mints per analyst across 5 analysts (38 new WATCHING
      // theses in one Sunday, against a documented 8/run target). Given
      // each thesis gets ~60-120s of deep research in V2, 5 is closer to
      // a quality bar than 8. Enforce as a Layer-1 reject so the prompt
      // can't override it.
      //
      // Counts existing LONG/SHORT WATCHING theses minted in THIS run
      // (researchRunId === ctx.runId). PASS theses don't count (those are
      // institutional memory, not coverage). Doesn't apply outside
      // discovery — daily-run still mints freely.
      const DISCOVERY_WATCHING_CAP = 5;
      if (
        isDiscoveryDirectional &&
        effectiveStatusForTriggers === "WATCHING" &&
        ctx.runId
      ) {
        const existingMints = await prisma.thesis.count({
          where: {
            researchRunId: ctx.runId,
            status: "WATCHING",
            direction: { in: ["LONG", "SHORT"] },
          },
        });
        if (existingMints >= DISCOVERY_WATCHING_CAP) {
          return {
            summary: `Thesis rejected for ${args.ticker}: discovery cap reached (${existingMints}/${DISCOVERY_WATCHING_CAP} LONG/SHORT WATCHING mints in this run).`,
            data: {
              thesis_id: null,
              status: "FAILED" as const,
              note:
                `Discovery cap: ${DISCOVERY_WATCHING_CAP} new LONG/SHORT WATCHING theses per discovery run. ` +
                `You've minted ${existingMints} already. Tighten the watchlist — ` +
                `the agent's next run can re-evaluate. ` +
                `PASS theses are not capped (those are institutional memory).`,
            },
            sources: [],
          };
        }
      }

      // Reject illegal (direction, status) pairs explicitly when the agent
      // passes an `status` arg that conflicts with direction.
      if (
        (args.direction === "PASS" && args.status === "ACTIVE") ||
        (args.direction === "PASS" && args.status === "WATCHING")
      ) {
        return {
          summary: `Thesis rejected for ${args.ticker}: illegal (direction, status) pair.`,
          data: {
            thesis_id: null,
            status: "FAILED" as const,
            note:
              `Direction='${args.direction}' is incompatible with status='${args.status}'. ` +
              `Legal pairs:\n` +
              `  • PENDING → WATCHING (seed, awaiting first research)\n` +
              `  • PASS → ARCHIVED (terminal, off the watchlist)\n` +
              `  • LONG/SHORT → WATCHING (entry-gated) or ACTIVE (live)\n` +
              `Retry with a legal pair.`,
          },
          sources: [],
        };
      }

      // PASS theses reject triggers[] at write — they're terminal, no
      // wake-up needed. Future re-encounter mints a fresh thesis chained
      // via parent_thesis_id.
      if (args.direction === "PASS" && Array.isArray(args.triggers) && args.triggers.length > 0) {
        return {
          summary: `Thesis rejected for ${args.ticker}: PASS theses cannot carry triggers.`,
          data: {
            thesis_id: null,
            status: "FAILED" as const,
            note:
              `PASS = "researched, decided not to trade." It's terminal at write (status=ARCHIVED) and lives as institutional memory only — no review cadence, no entry trigger, no wake-up. ` +
              `If you want the system to alert you when conditions flip, that's not a PASS — write a LONG/SHORT WATCHING thesis with an ENTER trigger at the level that would change your mind.`,
          },
          sources: [],
        };
      }

      // ── Hoisted trigger build ─────────────────────────────────────────
      // Hoisted so we can run the watching ENTER-trigger guard below
      // BEFORE the row hits the DB. The guard inspects the merged final
      // array (defaults + agent-supplied + cooldown backfill) and rejects
      // WATCHING/LONG-or-SHORT theses with no ENTER actions — matches the
      // upstream guard in manage_watchlist.ts and closes the last creation
      // hole for inert watching theses.
      const mergedTriggers: Trigger[] = (() => {
        // PASS theses are terminal — no triggers. Future re-encounter
        // mints a fresh directional thesis via parent_thesis_id.
        if (args.direction === "PASS") {
          return [];
        }
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

      // ── Narrative reconciliation (PR-9 flat schema) ───────────────────
      // The agent may pass either the legacy plain-string args
      // (reasoning_summary / thesis_bullets / risk_flags) or the new V2
      // section args (snapshot / bull_case / bear_case). V2 wins when both
      // are supplied. Legacy wraps in the new shape with empty citations.
      const snapshotPayload: object | undefined =
        args.snapshot ??
        (typeof args.reasoning_summary === "string" && args.reasoning_summary.length > 0
          ? { text: args.reasoning_summary, citations: [] }
          : undefined);
      const bullCasePayload: object | undefined =
        args.bull_case ??
        (args.thesis_bullets && args.thesis_bullets.length > 0
          ? { bullets: args.thesis_bullets.map((t) => ({ text: t })) }
          : undefined);
      const bearCasePayload: object | undefined =
        args.bear_case ??
        (args.risk_flags && args.risk_flags.length > 0
          ? { bullets: args.risk_flags.map((t) => ({ text: t })) }
          : undefined);

      // Narrative text for downstream consumers (ThesisUpdate.rationale,
      // RunEvent.message, TradeDecision.reasoning). Prefer the V2 snapshot
      // section; fall back to legacy reasoning_summary; empty string when
      // neither is supplied (PASS theses may carry only invalidation_conditions).
      const narrativeText: string =
        args.snapshot?.text ?? args.reasoning_summary ?? "";

      // researchUpdatedAt stamps whenever ANY V2 section landed — the daily-
      // run staleness gate (Phase 3) keys off it. The legacy-wrapped fallback
      // doesn't stamp it (those theses are pre-V2; no fresh research).
      const v2SectionSupplied =
        args.snapshot ||
        args.recent_catalysts ||
        args.fundamentals_section ||
        args.latest_earnings ||
        args.catalysts_and_events ||
        args.bull_case ||
        args.bear_case ||
        args.analyst_consensus ||
        args.insider_technical;

      const coreData = {
        researchRunId: ctx.runId,
        userId: ctx.userId,
        accountId: ctx.accountId,
        ticker: args.ticker,
        direction: args.direction,
        entryPrice: args.entry_price ?? null,
        targetPrice: args.target_price ?? null,
        stopLoss: args.stop_loss ?? null,
        // Legacy holdDuration column — derived from horizon. The arg was
        // dropped from the zod schema in PR-4 (was a token waste, agents
        // routinely confused it with `horizon`). Column drops in PR-5.
        holdDuration: holdDurationFromHorizon(args.horizon),
        sourceSignalIds,
        sourceKind: inferredSourceKind,
        sourceRationale: sourceRationale.length > 0 ? sourceRationale : null,
        scoring: scoring ?? undefined,
        // 2026-05-18 (THESIS_CLEANUP PR-4): `fullResearch` write was
        // dropped (scoring moved to top-level in PR-1; fundamentals
        // sub-key had zero readers). `source` + `modelUsed` are kept
        // here only because the columns are NOT NULL in the legacy
        // schema; both have zero readers and drop together in PR-5.
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
        // ── Deep-research artifacts (V2 flat schema, PR-9) ────────────────
        // researchData is the raw markdown data block; the 9 columns below
        // hold the parsed narrative sections. Use `undefined` for missing
        // sections (Prisma omits the field; Json? defaults to NULL).
        researchData:
          typeof args.research_data === "string" && args.research_data.length > 0
            ? args.research_data
            : undefined,
        snapshot: snapshotPayload,
        recentCatalysts: args.recent_catalysts ?? undefined,
        fundamentals: args.fundamentals_section ?? undefined,
        latestEarnings: args.latest_earnings ?? undefined,
        catalystsAndEvents: args.catalysts_and_events ?? undefined,
        bullCase: bullCasePayload,
        bearCase: bearCasePayload,
        analystConsensus: args.analyst_consensus ?? undefined,
        insiderTechnical: args.insider_technical ?? undefined,
        researchUpdatedAt: v2SectionSupplied ? new Date() : undefined,
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
                    `    scoring: { trendStrength: { score, note }, ... },\n` +
                    `    snapshot: { text: "<refreshed>", citations: [] },\n` +
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
                    accountId: ctx.accountId,
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
          (errMsg.includes("sourceRationale") && errMsg.includes("does not exist")) ||
          (errMsg.includes("researchData") && errMsg.includes("does not exist")) ||
          (errMsg.includes("researchUpdatedAt") && errMsg.includes("does not exist")) ||
          // PR-9 flat schema cutover
          (errMsg.includes("snapshot") && errMsg.includes("does not exist")) ||
          (errMsg.includes("bullCase") && errMsg.includes("does not exist")) ||
          (errMsg.includes("bearCase") && errMsg.includes("does not exist"));

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
            // THESIS_RESEARCH_V2 Phase 1 + PR-9 flat schema — strip every
            // V2-era research column if Prisma client predates them.
            researchData: _rdata,
            researchUpdatedAt: _rupdated,
            snapshot: _snap,
            recentCatalysts: _rcat,
            fundamentals: _fund,
            latestEarnings: _learn,
            catalystsAndEvents: _cae,
            bullCase: _bcase,
            bearCase: _xcase,
            analystConsensus: _acons,
            insiderTechnical: _itech,
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
          void _rdata;
          void _rupdated;
          void _snap;
          void _rcat;
          void _fund;
          void _learn;
          void _cae;
          void _bcase;
          void _xcase;
          void _acons;
          void _itech;
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
      const compositeForMessage =
        scoringComposite != null ? `composite ${scoringComposite}/10` : null;
      const createdSummary =
        args.direction === "PASS"
          ? `Passed on ${args.ticker}`
          : compositeForMessage
            ? `${args.direction} thesis on ${args.ticker} at ${compositeForMessage}`
            : `${args.direction} thesis on ${args.ticker}`;
      await writeThesisUpdate({
        thesisId: thesis.id,
        type: "CREATED",
        summary: createdSummary,
        rationale: narrativeText,
        signalIds: sourceSignalIds,
        runId: ctx.runId,
        priceAtTime: args.entry_price ?? null,
      });

      // Transition parent thesis lifecycle.
      if (resolvedParentId) {
        try {
          if (args.direction === "PASS") {
            const invalidReason =
              narrativeText.slice(0, 500) ||
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
              rationale: narrativeText,
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

      // Watchlist-collapse: this thesis IS the watchlist row (when
      // status='WATCHING'). No mirror table to sync.

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
            message: narrativeText,
            payload: {
              ticker: args.ticker,
              thesis: {
                ticker: args.ticker,
                direction: args.direction,
                // PR-9: confidence_score / signal_types / sources_used /
                // reasoning_summary / thesis_bullets / risk_flags fields
                // removed. The event payload mirrors the new flat schema:
                // composite (the conviction signal), snapshot (narrative),
                // and the 9 section blocks.
                composite: scoringComposite,
                snapshot: snapshotPayload,
                bull_case: bullCasePayload,
                bear_case: bearCasePayload,
                entry_price: args.entry_price,
                target_price: args.target_price,
                stop_loss: args.stop_loss,
                // PR-4: hold_duration arg was dropped from the schema —
                // derive from horizon for the event payload.
                hold_duration: holdDurationFromHorizon(args.horizon),
              },
              ...(evType === "skip"
                ? { reason: narrativeText, composite: scoringComposite }
                : {}),
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
              accountId: ctx.accountId,
              symbol: args.ticker,
              decision: "PASS",
              reasoning: narrativeText,
              thesisId: thesis.id,
            },
          });
        } catch (passErr) {
          console.error("[tool] record_thesis PASS decision creation FAILED:", passErr);
        }
      }

      return {
        summary:
          `Thesis recorded: ${args.direction} ${args.ticker} (${effectiveStatus.toLowerCase()}` +
          (scoringComposite != null ? `, composite ${scoringComposite}/10` : "") +
          `)` +
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
