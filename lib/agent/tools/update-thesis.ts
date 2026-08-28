/**
 * update_thesis — patch a durable thesis without rewriting it.
 *
 * Replaces the old "rewrite the whole thesis on every touch" pattern.
 * Each call:
 *   1. Loads the current Thesis row (by id, scoped to this analyst).
 *   2. Applies the patch — only the fields the agent passes are changed.
 *   3. Computes a structured diff and writes ONE ThesisUpdate row with the
 *      diff, rationale, signals cited, and price/position context at the
 *      moment of the update.
 *
 * Design notes:
 * - Updates do NOT chain via parentThesisId. The activity log IS the chain.
 *   parentThesisId is reserved for genuine thesis replacements via
 *   record_thesis (when direction or core belief shifts so significantly
 *   the agent wants a clean break).
 * - Status transitions go through a separate `change_status` field. We
 *   don't allow agents to silently flip ACTIVE → INVALIDATED via this tool;
 *   that's a deliberate transition with its own ThesisUpdate type.
 * - Triggers are replaced wholesale when supplied — we don't try to merge.
 *   The agent should pass the FULL trigger array it wants, not a delta.
 *   This keeps the schema simple and avoids "ghost trigger" bugs.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { getAccount } from "@/lib/alpaca";
import { subFloorTargetSize } from "@/lib/agent/position-sizing";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import {
  applyTriggerCooldownDefaults,
  reviewCadenceTrigger,
  CADENCE_DAYS_BY_HORIZON,
  nextReviewFrom,
} from "@/lib/agent/triggers/defaults";
import {
  dropRedundantInherited,
  carryOverDroppedFireState,
  adoptStoredTriggerIdentity,
} from "@/lib/agent/triggers/levels";
import {
  horizonFor,
  loadLevelSources,
  parseTriggerState,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import { validateEnterTriggerRequired } from "@/lib/agent/triggers/enter-guard";
import {
  protectiveRatchetViolations,
  describeRatchetViolation,
} from "@/lib/agent/triggers/ratchet";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { ResolvedTrigger } from "@/lib/agent/triggers/levels";
import { applyLevelArgs } from "@/lib/agent/triggers/price-levels";
import {
  writeThesisUpdate,
  diffThesisFields,
  compactFieldChanges,
  type ThesisUpdateType,
} from "@/lib/agent/thesis-updates";
import { getStockQuote } from "@/lib/actions/finnhub.actions";
import { validateThesisShape } from "@/lib/agent/thesis-shape";
import { validateThesisBelief } from "@/lib/agent/thesis-belief";
import { isUnresearchedSeed } from "@/lib/agent/thesis-direction";
import {
  checkStatusTransition,
  checkTerminateWithoutClose,
  checkWatchingOptOut,
  needsPairedCloseCheck,
} from "@/lib/agent/thesis-transitions";
import {
  holdDurationFromHorizon,
  type Horizon,
} from "@/lib/agent/horizon-policy";
import {
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

// ── V2 deep-research section shapes (PR-9 flat schema cutover) ───────────
// Same shape as record_thesis. See lib/agent/tools/record-thesis.ts.
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

const updateSchema = z.object({
  thesis_id: z.string().describe("Thesis id to update."),
  rationale: z
    .string()
    .min(10)
    .describe(
      "Why you're updating this thesis. Required — every update writes a timeline row and the rationale is what the user (or future you) reads to understand the change.",
    ),
  structural_unchanged_reason: z
    .string()
    .min(10)
    .optional()
    .describe(
      "OPTIONAL escape hatch for substantive non-belief changes. Required when the patch changes confidence_score / target_price / stop_loss WITHOUT also changing core_belief / key_assumptions / invalidation_conditions. State explicitly why the underlying belief still holds (e.g. \"key_assumption #2 confirmed by today's earnings beat — raising target to reflect, belief unchanged\"). Without this OR a belief-field change, target/stop/confidence patches are rejected — the discipline gate forces the agent to either update the belief or articulate why it didn't.",
    ),
  signal_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Signal ids that informed this update. Cited in the activity log row so we can trace causality back to the source.",
    ),
  trigger_id: z
    .string()
    .optional()
    .describe(
      "If this update was prompted by a trigger firing, the id of that trigger. Optional.",
    ),
  trade_id: z
    .string()
    .optional()
    .describe(
      "If this update produced a trade, the trade id. Optional — a trade typically writes its own update via place_trade / close_position; only set this for an out-of-band link.",
    ),
  price_at_time: z
    .number()
    .optional()
    .describe(
      "Current price for this ticker at the moment of update. Optional — captured into the activity log row for context.",
    ),

  // ── Patchable fields ──────────────────────────────────────────────────
  // Every field is optional. Whatever's passed gets written; whatever's
  // omitted is left unchanged.
  //
  // PR-9 flat schema: the legacy plain-string args
  // (reasoning_summary / thesis_bullets / risk_flags) accept the legacy
  // shape AND get wrapped into the new JSONB section shape on persist.
  // V2 callers pass the new section args directly (snapshot / bull_case /
  // bear_case + 6 new sections) for richer citations.
  reasoning_summary: z
    .string()
    .optional()
    .describe(
      "Legacy plain-string update for the snapshot section. V2 callers prefer `snapshot: { text, citations }`.",
    ),
  thesis_bullets: z
    .array(z.string())
    .optional()
    .describe(
      "Legacy plain-string-array update for the bull case. V2 callers prefer `bull_case: { bullets: [{ text, citation }] }`.",
    ),
  risk_flags: z
    .array(z.string())
    .optional()
    .describe(
      "Legacy plain-string-array update for the bear case. V2 callers prefer `bear_case: { bullets: [{ text, citation }] }`.",
    ),
  // The three "structural belief" fields. Substantive non-belief patches
  // (target/stop/confidence) without touching at least one of these are
  // rejected at the discipline gate below — the agent must either update
  // the belief OR pass `structural_unchanged_reason` explaining why the
  // underlying claim still holds. Closes P0-1.
  core_belief: z
    .string()
    .optional()
    .describe(
      "The durable claim — one sentence that captures WHAT you believe will happen and why. Diverges from reasoning_summary: core_belief is the underlying claim (rarely changes), reasoning_summary is the current-state framing (refreshed often). Touch this when the actual belief has shifted. If you're patching target/stop/confidence and the belief is unchanged, leave this alone and pass `structural_unchanged_reason` instead — the discipline gate enforces this.",
    ),
  key_assumptions: z
    .array(z.string())
    .optional()
    .describe(
      "What must be true for the core_belief to hold. Concrete and falsifiable items only: 'AI capex stays >$200B/quarter through 2026', 'no breakup of $TICKER's preferred customer relationship', 'guidance not cut more than 5% on next print'. Generic prose ('strong fundamentals') is insufficient. Touch this when one or more assumptions has been refined, confirmed, or invalidated by new evidence.",
    ),
  invalidation_conditions: z
    .array(z.string())
    .optional()
    .describe(
      "What would prove this thesis wrong. Concrete: 'guidance cut next quarter', 'CFO departure', 'gross margin below 35% on next print'. Generic 'market downturn' is insufficient. Used by the trade evaluator to grade exits and by the daily run to decide when a signal counts as thesis-breaking. On PASS theses, these double as re-entry criteria — if any flips the other way the PASS becomes a candidate to flip to LONG/SHORT.",
    ),
  // PR-9: signal_types / confidence_score columns dropped. Conviction
  // moves through `scoring` (the 4-dim setup grade, single conviction
  // number). signalTypes is derivable from sourceSignalIds.
  scoring: z
    .object({
      trendStrength: z.object({ score: z.number().min(0).max(3), note: z.string() }).optional(),
      relativeStrength: z.object({ score: z.number().min(0).max(3), note: z.string() }).optional(),
      entryQuality: z.object({ score: z.number().min(0).max(2), note: z.string() }).optional(),
      catalystFreshness: z.object({ score: z.number().min(0).max(2), note: z.string() }).optional(),
    })
    .optional()
    .describe(
      "Update the 4-dim composite scoring. Pass all four dims (with `composite` computed by the tool) to fully replace; pass a subset to merge with the existing scoring. composite ≥ 7 = ADD/ROTATE eligible; < 7 = WATCH or PASS.",
    ),
  target_price: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  entry_price: z.number().nullable().optional()
    .describe(
      "WHERE YOU'D BUY IN (or where you bought, on ACTIVE rows). Set the price you actually want to pay, not a snapshot of the tape. " +
      "When you re-level a watch, say which side you mean: BELOW the current quote is a pullback you want to buy, ABOVE it is a breakout you want confirmed first. " +
      "If you author the ENTER trigger yourself, match the predicate to that choice — PRICE_BELOW(entry) for a pullback, PRICE_ABOVE(entry) for a breakout. " +
      "PRICE_ABOVE on a level that already sits under the market is true the moment you write it and will re-fire every cooldown until someone removes it. " +
      "Optional for refinement updates; REQUIRED when promoting a PENDING thesis to LONG/SHORT (so target/stop have something to validate against in the shape gate). " +
      "On ACTIVE rows this is the actual fill price (set by place_trade); patching it on an ACTIVE row is rare and should only happen on a partial-fill / cost-basis correction."
    ),
  target_size_pct: z.number().min(0).max(100).optional(),

  // ── Conviction Expression v4 ─────────────────────────────────────────
  // See docs/plans/CONVICTION_EXPRESSION.md §3-§4. Patch-style here:
  // a tier set without a rationale is rejected; STRONG/HIGH without
  // variantView is rejected; STRONG with composite<7 or STRONG/HIGH
  // with entryQuality<2 is rejected (consistency gates §3.5).
  conviction: z
    .enum(["STRONG", "HIGH", "MEDIUM", "LOW"])
    .optional()
    .describe(
      "YOUR REAL VIEW after this review. STRONG = top calls (urgent buy, real money). HIGH = solid conviction, want it in size. MEDIUM = honest middle, probably works. LOW = tracking but not enthusiastic. " +
        "Independent of composite. Patch when the picture has materially changed (new evidence validated the variantView → upgrade; consensus caught up to your view → downgrade). When you patch this, you MUST also patch conviction_rationale. STRONG/HIGH require variant_view (patched in this call OR already on the row).",
    ),
  conviction_rationale: z
    .string()
    .max(400)
    .optional()
    .describe(
      "Updated rationale (≤400 chars). WRITE LIKE YOU'RE TALKING TO A PERSON — not 'composite 7/10, R/R 2.5:1'. Express the judgment, not the math. Required whenever you patch conviction.",
    ),
  variant_view: z
    .string()
    .max(300)
    .optional()
    .describe(
      "Update the writer's contrarian take (≤300 chars): 'consensus expects X, I think Y, here's why.' Required when patching conviction to STRONG/HIGH if existing.variantView is empty. Optional on MEDIUM/LOW.",
    ),

  // ── Direction (PENDING → LONG/SHORT/PASS promotion only) ─────────────
  // The only legal direction change is OUT of PENDING. Direction flips on
  // committed (LONG ↔ SHORT) theses go through record_thesis with
  // parent_thesis_id so the audit trail captures the chain.
  direction: z
    .enum(["LONG", "SHORT", "PASS"])
    .optional()
    .describe(
      "Direction commitment for a PENDING thesis (user/builder/editor seed). " +
      "Only legal when existing.direction === 'PENDING'. " +
      "LONG/SHORT: requires horizon, target_price, stop_loss, entry_price, core_belief, ≥2 key_assumptions, ≥2 invalidation_conditions, and triggers (or rely on horizon defaults). Stays WATCHING. " +
      "PASS: requires invalidation_conditions (≥1 — the flip-criteria). Automatically flips status to PASSED and clears triggers. " +
      "For direction flips on already-committed theses (LONG↔SHORT, etc.), use record_thesis with parent_thesis_id instead — same-direction changes here are rejected."
    ),

  horizon: z
    .enum(["CATALYST", "TARGET", "TRADE", "COMPOUNDER"])
    .optional()
    .describe(
      "Promote or demote when the trade structure has actually changed. Examples: a TRADE that's compounding past its 14d window because the thesis got bigger → upgrade to TARGET (and extend maxHoldDays + push nextReviewAt to the new cadence). A COMPOUNDER whose moat eroded but isn't dead → downgrade to TARGET with a tighter exit. A CATALYST that printed and is now a position trade on residual momentum → upgrade to TARGET. When you change horizon you MUST also update maxHoldDays and nextReviewAt to the new horizon's defaults (TRADE 14d / TARGET 90d / COMPOUNDER 365d) — leaving the old cadence in place produces a thesis whose exit policy doesn't match its label, which is worse than not promoting at all. Only spawn a fresh record_thesis when direction or core belief flips, not when the time horizon evolves.",
    ),
  catalyst_date: z.string().datetime().nullable().optional(),
  triggers: triggersArraySchema
    .optional()
    .describe(
      "Replace the entire trigger set. Pass the full array — we do not merge with existing triggers. To remove all triggers, pass [].",
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
    .nullable()
    .optional(),

  // ── V2 narrative sections (PR-9 flat schema) ──────────────────────────
  // Same 9 sections record_thesis accepts. Patching one section leaves the
  // others untouched (the rename + retype migration backfilled legacy rows
  // with empty-citation shapes, so partial updates are safe).
  snapshot: sectionTextSchema
    .optional()
    .describe(
      "Patch the Snapshot section (1 paragraph current-state framing). Supersedes `reasoning_summary` when both are passed.",
    ),
  recent_catalysts: sectionTextSchema
    .optional()
    .describe("Patch the Recent Catalysts section (1-2 week catalyst window narrative)."),
  fundamentals: sectionTextSchema
    .optional()
    .describe("Patch the Fundamentals section (narrative paragraph; persists to Thesis.fundamentals column)."),
  latest_earnings: sectionBulletSchema
    .optional()
    .describe("Patch the Latest Earnings section (5 specific bullets)."),
  catalysts_and_events: sectionBulletSchema
    .optional()
    .describe("Patch the Catalysts & Events section (3-5 dated bullets)."),
  bull_case: sectionBulletSchema
    .optional()
    .describe("Patch the Bull Case section (3-5 cited bullets). Supersedes `thesis_bullets` when both are passed."),
  bear_case: sectionBulletSchema
    .optional()
    .describe("Patch the Bear Case section (3-5 cited bullets, mandatory even on LONG). Supersedes `risk_flags` when both are passed."),
  analyst_consensus: sectionTextSchema
    .optional()
    .describe("Patch the Analyst Consensus section (firm-by-firm narrative)."),
  insider_technical: sectionTextSchema
    .optional()
    .describe("Patch the Insider & Technical section (insider activity + technical setup)."),

  // ── Status transitions (deliberate) ───────────────────────────────────
  // PROMOTED is intentionally excluded — only the promote-analyst action
  // sets it. Setting it here will fail Zod parse before this runs.
  change_status: z
    // P1-24 contract: the tool-owned account facts (HOLDING on a buy fill,
    // RETIRED-SOLD on a sell fill) are no longer accepted here — they were
    // the legacy ACTIVE/CLOSED verbs, removed from this enum. The agent still
    // speaks INVALIDATED / ARCHIVED as its intent verbs; the handler
    // translates them to the stored status=RETIRED + a retiredReason
    // (INVALIDATED → reason INVALIDATED, ARCHIVED → reason DROPPED).
    .enum(["INVALIDATED", "ARCHIVED", "WATCHING"])
    .optional()
    .describe(
      "Deliberate status transition — the BELIEF/lifecycle changes the analyst owns. " +
        "Holding and sold are NOT settable here — they're tool-owned account facts. WATCHING → HOLDING happens automatically when your buy fills (place_trade); HOLDING → retired-sold when your sell fills (close_position) — on the fill, or on the user's approval for a live proposal. Call those tools; the thesis status flips itself. " +
        "WATCHING = PROMOTED → WATCHING only. The legal opt-out path when you decide not to re-enter a just-promoted thesis on the first live run. The conviction stays in the library; the analyst will re-evaluate on subsequent runs. " +
        "INVALIDATED = the belief broke; we no longer believe the thesis (use this when concrete evidence disproves the view — it retires the thesis with reason INVALIDATED). Not allowed on PROMOTED — use WATCHING. " +
        "ARCHIVED = walked away from coverage without evidence-based invalidation (e.g. agent or user removed it from the watchlist — it retires the thesis with reason DROPPED). Off the watchlist; visible on the stock page as institutional memory. (A researched-and-declined PASS is NOT this — pass direction: \"PASS\", which lands status=PASSED.) " +
        "For direction flips or completely new beliefs, use record_thesis with parent_thesis_id instead.",
    ),

  // ── Deep-research artifact passthrough (THESIS_RESEARCH_V2 refresh) ───
  // Mirror of record_thesis's research_data arg. Populated by the
  // thesis-writer agent's refresh path after calling write_thesis_research.
  // Persisted on Thesis.researchData (markdown data block, ~3-5KB) for the
  // card's data tab + audit.
  //
  // PR-9: `research_sections` blob arg removed. The 9 parsed sections are
  // now individual flat args (snapshot / bull_case / bear_case + 6 new
  // sections defined above) — they land on first-class JSONB columns.
  research_data: z
    .string()
    .optional()
    .describe(
      "Raw structured-data markdown block from write_thesis_research(...).data.rawDataBlock. " +
        "Pass through verbatim. Lands on Thesis.researchData for the card's data tab.",
    ),
});

type UpdatePatch = Partial<{
  // P1-24: `LONG | SHORT | null` only. A PASS patch writes `null` here and
  // carries the pass fact on status=PASSED (the column no longer stores
  // 'PASS' or 'PENDING').
  direction: string | null;
  entryPrice: number | null;
  // PR-9 flat schema: legacy plain-string columns (reasoningSummary,
  // thesisBullets, riskFlags) replaced by JSONB section columns. Per the
  // single-shot cutover, the writer no longer surfaces the old fields.
  snapshot: object;
  bullCase: object;
  bearCase: object;
  recentCatalysts: object;
  fundamentals: object;
  latestEarnings: object;
  catalystsAndEvents: object;
  analystConsensus: object;
  insiderTechnical: object;
  researchUpdatedAt: Date;
  coreBelief: string | null;
  keyAssumptions: string[];
  invalidationConds: string[];
  // PR-9 dropped confidenceScore / signalTypes columns. Conviction lives
  // in scoring.composite (set via the scoring arg, not patched directly).
  scoring: object;
  targetPrice: number | null;
  stopLoss: number | null;
  targetSizePct: number | null;
  // ── Conviction Expression v4 (existing-row read) ──────────────────────
  conviction: string | null;
  convictionRationale: string | null;
  variantView: string | null;
  horizon: string | null;
  catalystDate: Date | null;
  nextReviewAt: Date | null;
  lastReviewedAt: Date | null;
  triggers: object;
  /** Fire state for inherited rungs — see the triggers patch block. */
  triggerState: object;
  scalingPlan: object | null;
  status: string;
  retiredReason: string;
  invalidatedAt: Date;
  invalidReason: string;
  closedAt: Date;
  closeReason: string;
  promotedAt: Date | null;
  // THESIS_RESEARCH_V2 Phase 1 — refresh path persistence.
  // PR-9: researchSections blob dropped; researchUpdatedAt is declared
  // higher up in this same type (stamped when any V2 section lands).
  researchData: string;
}>;

export const updateThesis = defineTool({
  description:
    "Update an existing thesis durably. Pass thesis_id + the fields you want to change + a rationale explaining why. Every call writes one row to the thesis activity log so the change is auditable. Use this — not record_thesis — when you're refining an existing belief (raising the target after good news, tightening the stop, swapping in fresh triggers, marking the thesis invalidated). Use record_thesis only when the thesis fundamentally changes (direction flip, completely new core belief). " +
    "Four hard-reject conditions to know about: " +
    "(1) zero-trigger guard — refuses updates on theses with no triggers unless the update adds triggers OR closes the thesis; " +
    "(2) goalpost-moving guard — refuses to raise targetPrice on a WATCHING thesis whose existing entry condition is currently met (price has crossed the old target — your job is to PROMOTE, not move the bar); " +
    "(3) structural-belief discipline gate — patches that change confidence_score / target_price / stop_loss WITHOUT also touching core_belief / key_assumptions / invalidation_conditions are rejected unless `structural_unchanged_reason` is supplied. Either update the belief to reflect why the trade plan is moving, or state explicitly why the belief is intact; " +
    "(4) protective-level ratchet — on a held stock, protective sell levels only move toward MORE protection. Lowering a stop, widening a trailing give-back, deleting a protective sell trigger, or switching one from automatic to judgment-first is rejected. Only the principal moves a safety line down. If you believe a level is wrong, keep it and say so in your rationale with the number you'd suggest.",
  schema: updateSchema,
  ui: "thesis-card" as const,
  gateLog: "update_thesis",

  progressLabel: (args) => {
    if (args.change_status === "INVALIDATED") return `Invalidating thesis ${args.thesis_id.slice(-8)}`;
    if (args.change_status === "ARCHIVED") return `Archiving thesis ${args.thesis_id.slice(-8)}`;
    return `Updating thesis ${args.thesis_id.slice(-8)}`;
  },

  execute: async (args, ctx) => {
    // Resolve priceAtTime defensively. The agent SHOULD pass price_at_time
    // (it just called get_stock_data on this ticker). When it forgets, we
    // fall back to a fresh Finnhub quote so the timeline row never has a
    // null price for an active update. Cheap (one HTTP call, 30s cache);
    // worth it for the timeline integrity.
    let resolvedPriceAtTime: number | null = args.price_at_time ?? null;

    // Load + scope check. A thesis must belong to an analyst's user;
    // updating someone else's thesis would be a security hole.
    const existing = await prisma.thesis.findUnique({
      where: { id: args.thesis_id },
      select: {
        id: true,
        userId: true,
        ticker: true,
        status: true,
        // Diffed by the fieldChanges builder — a terminal transition writes
        // retiredReason, and the audit row should carry the from/to.
        retiredReason: true,
        // Diffed (compacted) so a degraded research_data-only refresh still
        // records that the research payload changed.
        researchData: true,
        // direction + entryPrice are read by the shape gate below — adding
        // them to the select fixes a latent bug where existing.direction
        // and existing.entryPrice came back undefined at runtime.
        direction: true,
        entryPrice: true,
        researchRun: { select: { agentConfigId: true } },
        // PR-9 flat schema: select the V2 narrative columns + scoring.
        snapshot: true,
        bullCase: true,
        bearCase: true,
        recentCatalysts: true,
        fundamentals: true,
        latestEarnings: true,
        catalystsAndEvents: true,
        analystConsensus: true,
        insiderTechnical: true,
        coreBelief: true,
        keyAssumptions: true,
        invalidationConds: true,
        scoring: true,
        targetPrice: true,
        stopLoss: true,
        targetSizePct: true,
        // Conviction Expression v4 — read existing values so gates can
        // enforce coherence when only a subset of (conviction, rationale,
        // variantView) is being patched.
        conviction: true,
        convictionRationale: true,
        variantView: true,
        horizon: true,
        catalystDate: true,
        nextReviewAt: true,
        triggers: true,
        // Per-thesis fire state for inherited rungs — read so a rung
        // dropped as redundant can hand its cooldown stamp over.
        triggerState: true,
        scalingPlan: true,
      },
    });

    if (!existing) {
      return {
        summary: `Thesis ${args.thesis_id} not found.`,
        data: { ok: false, error: "not_found" },
        sources: [],
      };
    }
    if (existing.userId !== ctx.userId) {
      return {
        summary: `Thesis ${args.thesis_id} does not belong to this user.`,
        data: { ok: false, error: "scope_mismatch" },
        sources: [],
      };
    }

    // priceAtTime fallback: agent didn't pass one → fetch a fresh quote
    // for this ticker. Failure is non-fatal; just leaves it null.
    if (resolvedPriceAtTime == null) {
      try {
        const quote = await getStockQuote(existing.ticker);
        if (quote && Number.isFinite(quote.c) && quote.c > 0) {
          resolvedPriceAtTime = quote.c;
        }
      } catch {
        /* non-fatal */
      }
    }
    if (
      ctx.analystId &&
      existing.researchRun?.agentConfigId &&
      existing.researchRun.agentConfigId !== ctx.analystId
    ) {
      return {
        summary: `Thesis ${args.thesis_id} belongs to a different analyst.`,
        data: { ok: false, error: "analyst_mismatch" },
        sources: [],
      };
    }

    // ── Status-transition law (DAV-210) ──────────────────────────────────
    // Terminal rows, the PROMOTED state machine, and the writer role gate —
    // one readable table in lib/agent/thesis-transitions.ts. Codes and
    // messages are byte-identical to the inline blocks this replaced; the
    // incident history (AVGO/MRVL/TSM writer flips, the CRWD/CEG burn)
    // moved with the rules.
    const transitionInput = {
      thesisId: args.thesis_id,
      ticker: existing.ticker,
      currentStatus: existing.status,
      changeStatus: args.change_status,
      runMode: ctx.runMode,
    };
    {
      const violation = checkStatusTransition(transitionInput);
      if (violation) {
        return {
          summary: violation.summary,
          data: { ok: false, ...violation.data },
          sources: [],
        };
      }
    }

    // ── HOLDING / retired-sold are tool-owned (P1-25 / P1-24) ─────────────
    // The legacy ACTIVE/CLOSED change_status verbs were removed from this
    // tool's input enum: WATCHING→HOLDING and HOLDING→retired-sold are facts
    // about the Alpaca account, set ONLY by the execution/approval layer when
    // a real fill lands (place_trade inline + promoteThesisOnApproval;
    // close_position / closeThesisOnApproval). The agent that tried to set
    // them here is what stranded SNOW: on a proposal path it flipped
    // WATCHING→ACTIVE before approval, and reject/expire never reverted it →
    // orphan thesis with no position. Now Zod rejects those verbs outright at
    // parse time; the agent expresses INTENT (place_trade / close_position)
    // and the tool projects the status.

    // ── Position-thesis pairing guard ─────────────────────────────────────
    // Terminating an ACTIVE thesis without closing its position creates a
    // zombie position: the position stays OPEN but the live thesis backing
    // it is terminal. Three observed cases:
    //   - 2026-05-13 Secular Theme / GOOGL → INVALIDATED without close
    //   - 2026-05-14 Earnings Drift / TSM → INVALIDATED without close
    //   - 2026-05-14 Catalyst Event Raider / AMZN → ARCHIVED without close (F2 gap)
    //
    // Both INVALIDATED and ARCHIVED on a HOLDING-with-position are the same
    // zombie pattern. Refuse either unless a close_position fired on the
    // same ticker in this run.
    //
    // Carve-outs:
    //   - WATCHING thesis being terminated (no position by definition) — pass.
    //   - The thesis is already terminal (handled by the terminal guard above).
    // (P1-24: the legacy `change_status='CLOSED'` verb is gone — exiting a held
    // name is close_position, which flips the thesis to RETIRED-sold itself.
    // The agent can no longer retire a held name without that paired close.)
    if (needsPairedCloseCheck(transitionInput) && ctx.analystId) {
      const openPosition = await prisma.position.findFirst({
        where: {
          analystId: ctx.analystId,
          symbol: existing.ticker,
          status: "OPEN",
        },
        select: { id: true, direction: true, quantity: true },
      });
      // Did close_position fire on this ticker in THIS run? If so, the
      // pair is intact — let the terminal transition through.
      const closeInRun =
        openPosition && ctx.runId
          ? await prisma.thesisUpdate.findFirst({
              where: {
                runId: ctx.runId,
                type: "CLOSED",
                thesis: { ticker: existing.ticker },
              },
              select: { id: true },
            })
          : null;
      const violation = checkTerminateWithoutClose(transitionInput, {
        openPosition,
        closedThisRun: closeInRun != null,
      });
      if (violation) {
        return {
          summary: violation.summary,
          data: { ok: false, ...violation.data },
          sources: [],
        };
      }
    }

    // ── Unresearched-seed-must-commit guard ──────────────────────────────
    // 2026-05-14: observed the agent calling update_thesis on seed theses
    // with reasoning/bullets/nextReviewAt set but NO `direction` arg. The
    // call succeeded (patch was non-empty so the empty-patch auto-bump
    // didn't fire), the agent set nextReviewAt forward 30 days, and the
    // seed got buried for a month with no commitment. F1 in the V2
    // prompt tells the agent to commit; this gate ENFORCES it tool-side.
    //
    // Rule: any update_thesis call on an unresearched seed MUST include
    // `direction`. The seed is "awaiting first research" — there's nothing
    // to refine until the agent commits to a view. Refining the seed's
    // reasoning/bullets/nextReviewAt without committing is the wrong
    // shape regardless of how good the rationale is.
    //
    // P1-24 B4: a seed is direction=null (new) or 'PENDING' (legacy) — the
    // isUnresearchedSeed helper catches both during the dual-read window.
    //
    // W2 (DAV-209): direction-null now ALSO means a soft watch — "looked,
    // declined to trade, keeping a wake on it." A soft watch is a finished
    // decision, not an unresearched seed, and its wake triggers must stay
    // editable without forcing a direction commitment. The derived
    // discriminator: a soft watch always carries ≥1 AGENT-authored trigger
    // (the mint gate enforces the wake invariant); a seed carries none
    // (zero triggers, or only the DEFAULT-source seed cadence).
    const existingRowTriggers: Trigger[] = Array.isArray(existing.triggers)
      ? (existing.triggers as unknown as Trigger[])
      : [];
    const isSoftWatchRow =
      isUnresearchedSeed(existing.direction) &&
      existingRowTriggers.some((t) => t.source === "AGENT");
    if (
      isUnresearchedSeed(existing.direction) &&
      !isSoftWatchRow &&
      !args.direction
    ) {
      return {
        summary: `Thesis ${args.thesis_id} is an unresearched seed — update_thesis must include direction.`,
        data: {
          ok: false,
          error: "pending_update_without_direction",
          current_direction: existing.direction,
          ticker: existing.ticker,
          message:
            `$${existing.ticker} is an unresearched seed awaiting first research. update_thesis calls on seed theses MUST include \`direction\` to commit to a view. ` +
            `Three legal commitments:\n` +
            `  • \`direction: "LONG"\` + horizon + entry_price + target_price + stop_loss + core_belief + key_assumptions (≥2) + invalidation_conditions (≥2) + triggers + rationale — bullish, stays WATCHING.\n` +
            `  • \`direction: "SHORT"\` + same structural fields — bearish, stays WATCHING.\n` +
            `  • \`direction: "PASS"\` + invalidation_conditions (≥1) + rationale — researched, declined. Auto-flips to PASSED.\n` +
            `Refining a PENDING's reasoning/bullets/nextReviewAt without committing direction buries it on the watchlist and surfaces it again later with no progress. That's a soft fail dressed up as a review. Decide and commit.`,
        },
        sources: [],
      };
    }

    // ── Unresearched-seed-promotion direction guard ──────────────────────
    // The only legal direction change is OUT of an unresearched seed
    // (user/builder/editor seed → agent committed to a view). Direction
    // flips on committed (LONG ↔ SHORT) theses go through record_thesis
    // with parent_thesis_id so the audit trail captures the chain.
    //
    // P1-24 B4: a seed is direction=null (new) or 'PENDING' (legacy).
    if (args.direction) {
      if (!isUnresearchedSeed(existing.direction)) {
        return {
          summary: `Thesis ${args.thesis_id} is ${existing.direction}, not an unresearched seed — direction flips go through record_thesis.`,
          data: {
            ok: false,
            error: "direction_change_only_from_pending",
            current_direction: existing.direction,
            message:
              `update_thesis can only change direction when the existing thesis is an unresearched seed (no committed direction yet — user/builder/editor watchlist add awaiting first research). ` +
              `For an actual direction flip on a committed thesis (LONG → SHORT, etc.), call record_thesis with parent_thesis_id=${args.thesis_id} — the old thesis gets SUPERSEDED, the new direction is chained for audit.`,
          },
          sources: [],
        };
      }
      // PENDING → LONG/SHORT: need full structural commitment.
      if (args.direction === "LONG" || args.direction === "SHORT") {
        const missing: string[] = [];
        if (!args.horizon) missing.push("horizon");
        if (args.target_price == null) missing.push("target_price");
        if (args.stop_loss == null) missing.push("stop_loss");
        if (args.entry_price == null) missing.push("entry_price");
        if (!args.core_belief || args.core_belief.trim().length === 0) missing.push("core_belief");
        if (!args.key_assumptions || args.key_assumptions.filter((s) => s.trim().length > 0).length < 2) missing.push("key_assumptions (≥2)");
        if (!args.invalidation_conditions || args.invalidation_conditions.filter((s) => s.trim().length > 0).length < 2) missing.push("invalidation_conditions (≥2)");
        // Conviction Expression v4 — PENDING promotion requires the
        // same writer-side fields record_thesis would have required.
        if (!args.conviction) missing.push("conviction (STRONG/HIGH/MEDIUM/LOW)");
        if (!args.conviction_rationale || args.conviction_rationale.trim().length === 0) missing.push("conviction_rationale");
        if (
          (args.conviction === "STRONG" || args.conviction === "HIGH") &&
          (!args.variant_view || args.variant_view.trim().length === 0)
        ) {
          missing.push("variant_view (required for STRONG/HIGH)");
        }
        if (args.target_size_pct == null) missing.push("target_size_pct");
        if (missing.length > 0) {
          return {
            summary: `Refused PENDING→${args.direction} promotion on $${existing.ticker} — missing structural fields.`,
            data: {
              ok: false,
              error: "pending_promotion_missing_fields",
              missing,
              message:
                `Promoting a PENDING thesis to ${args.direction} is a full commitment — you need every structural field that record_thesis would have required. Missing: ${missing.join(", ")}. Supply all of them in this call and the thesis flips PENDING → ${args.direction} WATCHING in place.`,
            },
            sources: [],
          };
        }
      }
      // PENDING → PASS: need flip-criteria.
      if (args.direction === "PASS") {
        const inv = args.invalidation_conditions ?? [];
        if (inv.filter((s) => s.trim().length > 0).length < 1) {
          return {
            summary: `Refused PENDING→PASS on $${existing.ticker} — invalidation_conditions required.`,
            data: {
              ok: false,
              error: "pending_pass_missing_invalidation",
              message:
                `Flipping PENDING to PASS still needs invalidation_conditions (≥1). PASS is institutional memory; the value of that memory is what would change the verdict. Without flip-criteria a future encounter has nothing to compare against.`,
            },
            sources: [],
          };
        }
      }
    }

    // ── Conviction Expression v4 — coherence + consistency gates ────────
    // See docs/plans/CONVICTION_EXPRESSION.md §3, §3.5. Three checks fire
    // on non-PENDING-promotion paths:
    //   1. Coherence: if patching `conviction`, must also patch rationale.
    //   2. Coherence: if patching to STRONG/HIGH, variantView must exist
    //      (either patched in this call, or already on the row).
    //   3. Consistency Gate A: conviction (patched or existing) = STRONG
    //      requires effective composite ≥ 7.
    //   4. Consistency Gate B: conviction = STRONG/HIGH requires effective
    //      entryQuality.score ≥ 2.
    //
    // "Effective" = patched value if present in this call, otherwise the
    // existing-row value. This catches the asymmetric case where a writer
    // lowers composite via a scoring patch on a thesis that already has
    // conviction=STRONG (the patch would silently break the invariant).
    // P1-24 B4: seed = direction null (new) or 'PENDING' (legacy).
    const isPendingPromotionForConvictionGates = isUnresearchedSeed(
      existing.direction,
    );
    if (!isPendingPromotionForConvictionGates) {
      const effectiveConviction = args.conviction ?? existing.conviction;
      const effectiveVariantView =
        args.variant_view !== undefined
          ? args.variant_view
          : existing.variantView;

      // Coherence check 1: setting conviction requires rationale in same call.
      if (args.conviction !== undefined) {
        if (!args.conviction_rationale || args.conviction_rationale.trim().length === 0) {
          return {
            summary: `Refused update on $${existing.ticker} — patching conviction requires conviction_rationale.`,
            data: {
              ok: false,
              error: "conviction_rationale_required",
              message:
                `Whenever you patch \`conviction\`, you must also patch \`conviction_rationale\` (one sentence ≤200 chars explaining the new tier). ` +
                `Carrying over the prior rationale silently when changing the tier means the rationale stops matching the tier. Decide and document.`,
            },
            sources: [],
          };
        }
      }
      // Coherence check 2: STRONG/HIGH needs a variantView, even if just
      // carried over from the existing row.
      if (
        (effectiveConviction === "STRONG" || effectiveConviction === "HIGH") &&
        (!effectiveVariantView || effectiveVariantView.trim().length === 0)
      ) {
        return {
          summary: `Refused update on $${existing.ticker} — ${effectiveConviction} conviction requires variant_view.`,
          data: {
            ok: false,
            error: "variant_view_required",
            message:
              `${effectiveConviction} conviction requires variant_view — "consensus expects X, I think Y, here's why." ` +
              `Pass variant_view in this call (≤300 chars), or downgrade conviction to MEDIUM. ` +
              `Every buy-side pitch framework requires a variant view for top-tier conviction.`,
          },
          sources: [],
        };
      }

      // Consistency gates (Gate A, Gate B) REMOVED 2026-05-31.
      // See record-thesis.ts for the rationale: conviction is the
      // writer's view, NOT a derived field from composite. Coupling them
      // made the tier "just a name on composite," which defeated the
      // point. Conviction patches now stand on their own.
    }

    // ── Zero-trigger guard (audit Step 4) ─────────────────────────────────
    // A WATCHING thesis with no triggers can't react to anything — the
    // trigger evaluator has nothing to fire on, the agent has nothing to
    // promote. If the agent is reviewing one of these and isn't either
    // (a) closing it or (b) adding triggers, the review is a no-op that
    // still claims the closeout-contract slot. Refuse the update so the
    // agent has to either fix it or close it.
    //
    // ACTIVE theses with zero triggers are also broken (no exit triggers!)
    // — same rule applies.
    //
    // Exception: status transition to INVALIDATED/CLOSED is the
    // legitimate "give up on this broken thesis" path. Allow that.
    //
    // Since the cascade landed, "can this thesis react to anything?" is a
    // question about the RESOLVED ladder, not the stored column: a thesis
    // storing zero rungs of its own still inherits its analyst's, its
    // account's, and the standing code minimums. Counting only the column
    // would refuse legitimate reviews on exactly the theses that are
    // protected purely by inherited rungs.
    const isTerminalTransition =
      args.change_status === "INVALIDATED" ||
      args.change_status === "ARCHIVED" ||
      // PASS (seed → PASS) is a terminal flip — clears triggers, sets PASSED.
      args.direction === "PASS";

    // The levels above this thesis, resolved against an EMPTY thesis array
    // so we see them unmasked by the thesis's own rungs. Used twice: by
    // the guard just below, and by the wholesale-replace path further down
    // to keep inherited rungs from being copied onto the row.
    //
    // Lazy: update_thesis is the most-called tool in the app and most
    // calls don't touch triggers at all. Only pay the two level queries
    // when the answer can actually change something — a trigger replace,
    // or a stored-count of zero where the guard needs to know whether
    // inherited rungs are covering the thesis.
    const storedTriggerCount = Array.isArray(existing.triggers)
      ? (existing.triggers as unknown[]).length
      : 0;
    const needsLevels = args.triggers !== undefined || storedTriggerCount === 0;
    let inheritedLadder: ResolvedTrigger[] = [];
    if (needsLevels) {
      const analystId = existing.researchRun?.agentConfigId ?? null;
      const levelSources = analystId
        ? (await loadLevelSources([analystId])).get(analystId)
        : undefined;
      inheritedLadder = resolveThesisLadder(
        {
          triggers: [],
          triggerState: {},
          status: existing.status,
          horizon: args.horizon ?? existing.horizon,
        },
        levelSources,
        `thesis=${args.thesis_id}`,
      );
    }

    const existingTriggerCount = storedTriggerCount + inheritedLadder.length;
    const updateAddsTriggers =
      args.triggers !== undefined && args.triggers.length > 0;
    // Unresearched seeds always start with zero triggers — that's expected,
    // not a violation. Only fire the zero-trigger guard on committed rows.
    // P1-24 B4: seed = direction null (new) or 'PENDING' (legacy).
    const isPendingPromotion = isUnresearchedSeed(existing.direction);
    if (
      existingTriggerCount === 0 &&
      !updateAddsTriggers &&
      !isTerminalTransition &&
      !isPendingPromotion
    ) {
      return {
        summary: `Thesis ${args.thesis_id} has no triggers; refusing review-only update.`,
        data: {
          ok: false,
          error: "zero_trigger_thesis",
          message:
            `${existing.ticker} thesis has no triggers — the trigger system can't fire anything on it. A review without action is a no-op. You must EITHER (a) supply a non-empty triggers[] array describing what would fire entry/exit/review, OR (b) close it via change_status: "INVALIDATED" if the thesis is no longer trackable.`,
        },
        sources: [],
      };
    }

    // ── Goalpost-moving guard (audit Root Cause #3) ───────────────────────
    // Refuse to raise targetPrice on a WATCHING thesis whose existing
    // entry condition is currently met. This is the MRVL pattern: trigger
    // PRICE_ABOVE $172 has fired (current price $172.15), and instead of
    // entering the trade the agent calls update_thesis to raise the
    // target to $195 — moving the bar instead of acting. The trigger-
    // evaluator will keep firing on every signal route until the agent
    // either INITIATEs or invalidates.
    //
    // A target raise on WATCHING is allowed when the current price is
    // BELOW the OLD target (legitimate refinement before the entry
    // condition triggers). It's blocked when the current price has
    // already crossed the OLD target.
    //
    // P1-24: promotion is place_trade (WATCHING → HOLDING), which doesn't go
    // through this tool, so there's no longer an ACTIVE-via-update_thesis
    // bypass to carve out — the guard applies on every WATCHING target-raise
    // whose entry condition is already met.
    if (
      existing.status === "WATCHING" &&
      args.target_price != null &&
      existing.targetPrice != null &&
      args.target_price > existing.targetPrice &&
      resolvedPriceAtTime != null &&
      resolvedPriceAtTime >= existing.targetPrice
    ) {
      return {
        summary: `Refused to raise target on $${existing.ticker} — entry condition is currently met.`,
        data: {
          ok: false,
          error: "goalpost_moving_blocked",
          message:
            `${existing.ticker} is at $${resolvedPriceAtTime.toFixed(2)} and the existing target is $${existing.targetPrice.toFixed(2)}. The entry condition is MET — your action is to PROMOTE (place_trade, which flips WATCHING → HOLDING), not raise the target to $${args.target_price.toFixed(2)} and walk away. If you genuinely think the setup has changed, document a concrete rejection reason in record_run_summary's decision_rationale (volume too low, regime change, fresh negative news, R/R no longer 2:1) and leave the target untouched. Or close the thesis with change_status: "INVALIDATED".`,
        },
        sources: [],
      };
    }

    // ── Relative-ordering gate ────────────────────────────────────────────
    // If the patch touches target_price or stop_loss, validate that the
    // resulting (entry, target, stop) tuple satisfies direction-relative
    // ordering. Same shape rule that record_thesis uses; this catches the
    // case where the agent edits one price but produces a bad pair (e.g.
    // raises stop_loss above the existing entry_price on a LONG).
    //
    // We do NOT run this check when the patch leaves target/stop alone —
    // a confidence-only update on a pre-existing broken row shouldn't be
    // blocked by this gate (the row's shape is rotten, but cleaning it up
    // is the job of either a future update or a SQL cleanup, not this
    // particular review). Terminal transitions (INVALIDATED/CLOSED) also
    // bypass — the values become reference history at that point.
    // Effective direction for the shape check: when the agent is promoting
    // PENDING → LONG/SHORT, validate against the NEW direction (the resulting
    // state), not the existing PENDING. PENDING has no shape rule.
    const effectiveDirectionForShape =
      args.direction === "LONG" || args.direction === "SHORT"
        ? args.direction
        : existing.direction;
    const shapeCheckNeeded =
      (args.target_price !== undefined || args.stop_loss !== undefined) &&
      !isTerminalTransition &&
      (effectiveDirectionForShape === "LONG" || effectiveDirectionForShape === "SHORT");
    if (shapeCheckNeeded) {
      const effectiveTarget =
        args.target_price !== undefined
          ? args.target_price
          : existing.targetPrice != null
            ? Number(existing.targetPrice)
            : null;
      const effectiveStop =
        args.stop_loss !== undefined
          ? args.stop_loss
          : existing.stopLoss != null
            ? Number(existing.stopLoss)
            : null;
      // Effective entry: prefer the OPEN Position's actual fill price
      // over the thesis row's planned entry. Captures the 2026-05-12 AMD
      // shape — a WATCHING thesis carries entryPrice=$420 (the planned
      // breakout level / ENTER trigger), the position fills at $446,
      // and the agent's stop at $434 is correct relative to the FILL
      // but the shape gate read against the stale $420 and rejected
      // every attempt. The Position table is the canonical record of
      // "what we actually own at what price" — for shape validation we
      // want the real entry, not the planned one. Falls back to the
      // thesis row's entryPrice for WATCHING theses (no position yet)
      // or when no open position is found.
      // P1-24 B4: an unresearched seed (direction null or legacy 'PENDING')
      // never has an OPEN position — skip the lookup. For committed rows the
      // direction is LONG/SHORT; `?? undefined` keeps the Position filter
      // happy now that the column type is `string | null`.
      const openPosition =
        ctx.analystId && !isUnresearchedSeed(existing.direction)
          ? await prisma.position.findFirst({
              where: {
                analystId: ctx.analystId,
                symbol: existing.ticker,
                direction: existing.direction ?? undefined,
                status: "OPEN",
              },
              select: { avgCost: true },
              orderBy: { openedAt: "desc" },
            })
          : null;
      const effectiveEntry =
        openPosition?.avgCost != null
          ? Number(openPosition.avgCost)
          : existing.entryPrice != null
            ? Number(existing.entryPrice)
            : null;
      const shapeCheck = validateThesisShape({
        direction: effectiveDirectionForShape as "LONG" | "SHORT",
        entryPrice:
          args.entry_price !== undefined ? args.entry_price : effectiveEntry,
        targetPrice: effectiveTarget,
        stopLoss: effectiveStop,
      });
      if (!shapeCheck.ok) {
        return {
          summary: `Refused update on $${existing.ticker} — invalid post-patch shape (${shapeCheck.reason}).`,
          data: {
            ok: false,
            error: "invalid_thesis_shape",
            message: shapeCheck.note,
          },
          sources: [],
        };
      }
    }

    // Build the patch. Only set keys the agent supplied — undefined ≠ null.
    const patch: UpdatePatch = {};

    // ── Narrative section reconciliation (PR-9 flat schema) ──────────────
    // V2 section args (snapshot / bull_case / bear_case) take precedence
    // over the legacy plain-string args (reasoning_summary / thesis_bullets
    // / risk_flags). Legacy values are wrapped in the new JSONB shape.
    if (args.snapshot !== undefined) {
      patch.snapshot = args.snapshot;
    } else if (args.reasoning_summary !== undefined) {
      patch.snapshot = { text: args.reasoning_summary, citations: [] };
    }
    if (args.bull_case !== undefined) {
      patch.bullCase = args.bull_case;
    } else if (args.thesis_bullets !== undefined) {
      patch.bullCase = { bullets: args.thesis_bullets.map((t) => ({ text: t })) };
    }
    if (args.bear_case !== undefined) {
      patch.bearCase = args.bear_case;
    } else if (args.risk_flags !== undefined) {
      patch.bearCase = { bullets: args.risk_flags.map((t) => ({ text: t })) };
    }
    // 6 new V2 sections — no legacy fallback.
    if (args.recent_catalysts !== undefined) patch.recentCatalysts = args.recent_catalysts;
    if (args.fundamentals !== undefined) patch.fundamentals = args.fundamentals;
    if (args.latest_earnings !== undefined) patch.latestEarnings = args.latest_earnings;
    if (args.catalysts_and_events !== undefined) patch.catalystsAndEvents = args.catalysts_and_events;
    if (args.analyst_consensus !== undefined) patch.analystConsensus = args.analyst_consensus;
    if (args.insider_technical !== undefined) patch.insiderTechnical = args.insider_technical;
    // Stamp researchUpdatedAt if any V2 section was touched (drives the
    // daily-run staleness gate).
    if (
      args.snapshot !== undefined ||
      args.bull_case !== undefined ||
      args.bear_case !== undefined ||
      args.recent_catalysts !== undefined ||
      args.fundamentals !== undefined ||
      args.latest_earnings !== undefined ||
      args.catalysts_and_events !== undefined ||
      args.analyst_consensus !== undefined ||
      args.insider_technical !== undefined
    ) {
      patch.researchUpdatedAt = new Date();
    }

    if (args.core_belief !== undefined) patch.coreBelief = args.core_belief;
    if (args.key_assumptions !== undefined)
      patch.keyAssumptions = args.key_assumptions;
    if (args.invalidation_conditions !== undefined)
      patch.invalidationConds = args.invalidation_conditions;
    // PR-9: confidence_score arg dropped — composite (in scoring) is the
    // single conviction number. Scoring is merged with existing (partial
    // updates supported); composite is computed from the 4 dims.
    if (args.scoring !== undefined) {
      // Read current scoring + merge with patch.
      const currentScoring =
        existing.scoring && typeof existing.scoring === "object"
          ? (existing.scoring as Record<string, unknown>)
          : {};
      const merged = { ...currentScoring, ...args.scoring };
      const t = (merged.trendStrength as { score?: number } | undefined)?.score ?? 0;
      const r = (merged.relativeStrength as { score?: number } | undefined)?.score ?? 0;
      const e = (merged.entryQuality as { score?: number } | undefined)?.score ?? 0;
      const c = (merged.catalystFreshness as { score?: number } | undefined)?.score ?? 0;
      patch.scoring = { ...merged, composite: t + r + e + c };
    }
    // target_price / stop_loss / entry_price are NOT written here any more.
    // A level change is a TRIGGER change; the columns are recomputed from the
    // resulting trigger list further down (search "derive-on-write"). Writing
    // the column directly is how SNOW ended up showing a $256 stop that
    // nothing would ever have sold at. See docs/plans/LEVELS_AS_TRIGGERS.md.
    // PENDING-promotion direction flip (guarded above so this only runs on
    // legal transitions). A PASS (incl. PENDING → PASS) flips status to
    // PASSED and clears triggers; PENDING → LONG/SHORT stays WATCHING with
    // the structural fields the agent supplied.
    if (args.direction !== undefined) {
      if (args.direction === "PASS") {
        // PASS = researched-and-declined → PASSED (was ARCHIVED before the
        // status-taxonomy migration; the walk-away change_status:"ARCHIVED"
        // path below is unchanged).
        //
        // P1-24 PASS-off-direction: the pass fact now lives ENTIRELY on
        // status=PASSED. `direction` is nulled — `LONG|SHORT|null` is the
        // only legal column domain. The agent still SENDS direction:"PASS"
        // (kept call signal), we just don't store it. Readers identify a
        // pass via status=PASSED (see isPassedThesis).
        patch.direction = null;
        patch.status = "PASSED";
        patch.closedAt = new Date();
        patch.closeReason = args.rationale.slice(0, 500);
        patch.triggers = [] as unknown as object;
      } else {
        // LONG / SHORT — the only other legal direction promotion (out of
        // an unresearched seed; guarded above).
        patch.direction = args.direction;
      }
    }
    // ── Sub-floor sizing gate (P1-40 companion — same check as record_thesis) ──
    // A refresh must not lower targetSizePct below the analyst's dollar floor:
    // the plan becomes self-rejecting at place_trade (RARE's 4% vs $5k floor —
    // the fired ENTER died unexecuted). Fail-open on equity-fetch failure.
    if (
      args.target_size_pct !== undefined &&
      args.target_size_pct > 0 &&
      ctx.minPositionSize != null &&
      ctx.minPositionSize > 0
    ) {
      try {
        const account = await getAccount(ctx.alpacaCreds);
        const subFloor = subFloorTargetSize({
          targetSizePct: args.target_size_pct,
          equity: Number(account?.equity),
          environment: ctx.runEnvironment ?? "PAPER",
          minPositionSize: ctx.minPositionSize,
          maxPositionSize: ctx.maxPositionSize,
          realMaxPosition: ctx.realMaxPosition,
        });
        if (subFloor) {
          return {
            summary: `Update rejected for ${existing.ticker}: target_size_pct ${args.target_size_pct}% is below this analyst's position floor.`,
            data: {
              ok: false,
              error: "target_size_below_floor",
              message:
                `target_size_pct ${args.target_size_pct}% ≈ $${Math.round(subFloor.intendedDollars).toLocaleString()} at current equity — below this analyst's $${Math.round(subFloor.floorDollars).toLocaleString()} minimum position. place_trade rejects sub-floor entries, so this plan could never fill. ` +
                `Retry with target_size_pct: ${subFloor.floorPct} or higher if conviction supports a full-floor position; otherwise leave sizing unchanged and reflect the reduced conviction in the tier/rationale instead.`,
            },
            sources: [],
          };
        }
      } catch { /* fail-open */ }
      patch.targetSizePct = args.target_size_pct;
    } else if (args.target_size_pct !== undefined)
      patch.targetSizePct = args.target_size_pct;
    // Conviction Expression v4 — persist patched conviction fields.
    // Coherence + consistency gates above already ran; values here are
    // safe to write. Empty-string for variantView is normalized to null
    // (writer way to clear an obsolete edge).
    if (args.conviction !== undefined) patch.conviction = args.conviction;
    if (args.conviction_rationale !== undefined)
      patch.convictionRationale = args.conviction_rationale;
    if (args.variant_view !== undefined)
      patch.variantView =
        args.variant_view.trim().length === 0 ? null : args.variant_view;
    if (args.horizon !== undefined) patch.horizon = args.horizon;
    if (args.catalyst_date !== undefined)
      patch.catalystDate = args.catalyst_date ? new Date(args.catalyst_date) : null;
    // next_review_at is gone (DAV-195 L7). Review cadence is a trigger:
    // "review every N days", counted from the last actual review, cascading
    // account -> analyst -> thesis like every other level. An agent that
    // wants this name looked at more often edits that trigger; it does not
    // type a date. nextReviewAt is a derived display value now.
    // THESIS_RESEARCH_V2 refresh-path research persistence. PR-9: the
    // `research_sections` blob is gone — parsed sections land on the 9
    // first-class JSONB columns above (which also stamp researchUpdatedAt
    // via the V2-section-supplied check). `research_data` (the raw markdown
    // structured-data block) is still passthrough-persisted here for the
    // card's data tab + audit.
    if (
      typeof args.research_data === "string" &&
      args.research_data.length > 0
    ) {
      patch.researchData = args.research_data;
      // researchUpdatedAt was already stamped above when any V2 section
      // arrived; stamp here too as a fallback when only research_data lands
      // without sections (degraded synthesis path).
      if (patch.researchUpdatedAt === undefined) {
        patch.researchUpdatedAt = new Date();
      }
    }
    if (args.triggers !== undefined) {
      // Triggers are wholesale-replaced (intentional — agent passes the FULL
      // array, see file header). But two server-managed fields must survive
      // that replacement:
      //
      //   1. `lastFiredAt` — the cooldown stamp. The agent never sees nor
      //      reasons about it; if we trust its trigger payload verbatim,
      //      every update wipes the firing memory and the next signal
      //      re-fires the trigger. PR 2.5 / PR 3 both relied on this stamp
      //      and silently lost it on every update_thesis touch.
      //
      //   2. `cooldownDays` — agent-authored triggers often omit it
      //      (schema marks it optional). applyTriggerCooldownDefaults
      //      backfills a sane per-kind default so the cooldown gate isn't
      //      a no-op.
      //
      // We key by trigger id. The agent SHOULD pass the existing id when
      // editing an in-place trigger; new triggers get a fresh id from the
      // schema layer. Triggers with no prior match are treated as net-new.
      const existingTriggers: Trigger[] = Array.isArray(existing.triggers)
        ? (existing.triggers as unknown as Trigger[])
        : [];
      const lastFiredById = new Map(
        existingTriggers
          .filter((t) => t.id && t.lastFiredAt)
          .map((t) => [t.id, t.lastFiredAt] as const),
      );
      //   3. Rungs the thesis INHERITS must not be copied onto it. The
      //      agent now reads the resolved ladder (get_theses), so a
      //      faithful wholesale-replace resends the analyst / account /
      //      default rungs too. Storing those would promote them to
      //      THESIS level and freeze a snapshot of the level above —
      //      after one review cycle every standing rule would be
      //      overridden everywhere by a copy of itself. Only a rung whose
      //      VALUE or fire mode actually differs is kept as an override.
      //      See dropRedundantInherited in lib/agent/triggers/levels.
      const incoming = dropRedundantInherited(
        args.triggers as Trigger[],
        inheritedLadder,
      );

      // Dropping a redundant rung must not drop its COOLDOWN. A thesis
      // that carries a materialized copy of a default (most rows minted
      // before the cascade do) converges to inheriting it the first time
      // the agent resends the ladder — and the inherited rung has a
      // different id, so its `lastFiredAt` would not carry over and a
      // rung mid-cooldown could immediately re-fire. Same family as the
      // 2026-06-02 NVDA runaway. Carry the stamp across, into the
      // per-thesis fire state the inherited rung actually reads.
      const droppedIds = new Set(
        (args.triggers as Trigger[])
          .filter((t) => !incoming.some((k) => k.id === t.id))
          .map((t) => t.id),
      );
      if (droppedIds.size > 0) {
        patch.triggerState = carryOverDroppedFireState(
          existingTriggers.filter((t) => droppedIds.has(t.id)),
          inheritedLadder,
          parseTriggerState(existing.triggerState),
        ) as object;
      }

      // The agent resends the ladder WITHOUT ids and the schema mints a
      // fresh uuid per id-less rung — so before any id-keyed carry-over can
      // work, an unchanged rung must get its stored id back. Without this
      // the resend wipes the firing memory despite the map above (ABT
      // 2026-08-26: ENTER fired, the tactical run resent the ladder, the
      // fresh id dropped `lastFiredAt`, and the next 5-minute tick re-fired
      // it — four tactical runs in 15 minutes on one unchanged trigger).
      // It also keeps `source` honest below: resending a principal-authored
      // floor verbatim must not re-stamp it AGENT.
      const readopted = adoptStoredTriggerIdentity(incoming, existingTriggers);

      const preserved = readopted.map((t) => {
        if (t.lastFiredAt != null) return t; // agent provided one — respect it
        const prior = t.id ? lastFiredById.get(t.id) : undefined;
        return prior ? { ...t, lastFiredAt: prior } : t;
      });
      // Agent-authored rungs are stamped AGENT. A rung whose id matches an
      // existing one keeps whatever source it already had — resending a
      // rung you didn't author doesn't make it yours.
      const sourceById = new Map(
        existingTriggers.filter((t) => t.id).map((t) => [t.id, t.source] as const),
      );
      const stamped = preserved.map((t) => {
        const prior = t.id ? sourceById.get(t.id) : undefined;
        return prior !== undefined
          ? { ...t, source: prior }
          : { ...t, source: "AGENT" as const };
      });
      let finalTriggers = applyTriggerCooldownDefaults(stamped);

      // ── Plan ⇒ cadence on the update path (W2, DAV-209 invariant 2) ──
      // WATCHING no longer inherits the account's review cadence (W1), so
      // a wholesale replace that omits the cadence rung would silently
      // take a committed watch off the review clock — "reviews stop, no
      // error." Mirror of record_thesis's mint stamp: a directional
      // WATCHING thesis always leaves this tool with a clock. Direction-
      // null rows (seeds, soft watches) are exempt — a soft watch being
      // cadence-free is the point, and seeds carry their own seed clock.
      // Terminal transitions (change_status) skip: the row is leaving the
      // watchlist anyway.
      const finalDirection = args.direction ?? existing.direction;
      if (
        existing.status === "WATCHING" &&
        !args.change_status &&
        (finalDirection === "LONG" || finalDirection === "SHORT") &&
        !finalTriggers.some((t) => t.predicate.kind === "REVIEW_CADENCE")
      ) {
        finalTriggers = [
          ...finalTriggers,
          {
            ...reviewCadenceTrigger(
              CADENCE_DAYS_BY_HORIZON[
                horizonFor(args.horizon ?? existing.horizon ?? null)
              ],
            ),
            source: "DEFAULT" as const,
          },
        ];
      }
      patch.triggers = finalTriggers as object;
    }

    // ── Derive-on-write: levels are triggers (DAV-195 L3) ────────────────
    // Runs AFTER the wholesale replace so an explicit level argument lands on
    // top of a resent trigger list — update_thesis({triggers:[...],
    // stop_loss:720}) ends with the floor at 720.
    //
    // Two things happen here, and the second runs even when the caller passed
    // no level argument at all:
    //   1. each supplied level is written as a TRIGGER, and
    //   2. the cached columns are recomputed from the FINAL trigger list.
    // (2) is what closes the wholesale-replace hole: resend a ladder without
    // the floor and `stopLoss` goes null with it, instead of lingering as a
    // number nothing enforces. Whether dropping it is ALLOWED is the ratchet
    // gate's business, and that runs below on this output.
    const touchesLevels =
      args.entry_price !== undefined ||
      args.target_price !== undefined ||
      args.stop_loss !== undefined;
    if (touchesLevels || patch.triggers !== undefined) {
      const baseTriggers: Trigger[] =
        patch.triggers !== undefined
          ? ((patch.triggers as unknown as Trigger[]) ?? [])
          : Array.isArray(existing.triggers)
            ? (existing.triggers as unknown as Trigger[])
            : [];
      const levelDirection = ("direction" in patch
        ? patch.direction
        : existing.direction) as string | null;
      const levelStatus = (patch.status ?? existing.status) as string | null;
      const applied = applyLevelArgs({
        stored: baseTriggers,
        inherited: inheritedLadder,
        levels: {
          entry: args.entry_price,
          target: args.target_price,
          floor: args.stop_loss,
        },
        direction: levelDirection,
        status: levelStatus,
        source: "AGENT",
        mintId: () => randomUUID(),
      });
      patch.triggers = applyTriggerCooldownDefaults(
        applied.triggers,
      ) as unknown as object;
      patch.targetPrice = applied.columns.targetPrice;
      patch.stopLoss = applied.columns.stopLoss;
      // entryPrice on a HELD thesis is a historical fact — what the fill
      // actually cost, written once by place_trade. It is not a plan and
      // nothing here may recompute it (doing so would null it out on every
      // review, since the buy trigger is deliberately gone once we own the
      // name). On a watch row it derives from the buy level like the others.
      if (levelStatus !== "HOLDING") {
        patch.entryPrice = applied.columns.entryPrice;
      }
    }
    if (args.scaling_plan !== undefined)
      patch.scalingPlan =
        args.scaling_plan === null ? null : (args.scaling_plan as object);

    // Status transitions get extra paperwork.
    let updateType: ThesisUpdateType = "UPDATED";
    if (args.change_status === "INVALIDATED") {
      // P1-24 B3: terminal collapse → RETIRED + retiredReason. The agent
      // verb (change_status:"INVALIDATED") is unchanged; the stored status
      // is RETIRED and the reason records why. invalidatedAt/invalidReason
      // still carry the narrative; updateType stays the audit event kind.
      patch.status = "RETIRED";
      patch.retiredReason = "INVALIDATED";
      patch.invalidatedAt = new Date();
      patch.invalidReason = args.rationale.slice(0, 500);
      updateType = "INVALIDATED";
    } else if (args.change_status === "ARCHIVED") {
      // Terminal-without-trade-or-invalidation. Used for agent/user walking
      // away from coverage (user UI remove; editor remove). NOT for a
      // researched-and-declined PASS — that's direction:"PASS" → status=PASSED
      // above. Distinct from INVALIDATED (view disproven by evidence). Exiting
      // a held position is close_position, which retires the thesis (sold)
      // itself — there's no agent CLOSED verb here anymore.
      // P1-24: walk-away ARCHIVED → RETIRED + retiredReason=DROPPED.
      patch.status = "RETIRED";
      patch.retiredReason = "DROPPED";
      patch.closedAt = new Date();
      patch.closeReason = args.rationale.slice(0, 500);
      // Existing ThesisUpdateType taxonomy doesn't have ARCHIVED. Use
      // STATUS_CHANGED so the audit log captures the from/to in fieldChanges.
      updateType = "STATUS_CHANGED";
    } else if (args.change_status === "WATCHING") {
      // ── PROMOTED → WATCHING (only legal source) ─────────────────────────
      // The opt-out path on the first live run. The analyst decides not to
      // re-enter this name live; downgrade to WATCHING and let the next run
      // re-evaluate. Conviction context fields (paperTenureDays / P&L /
      // review count) stay on the row for reference; promotedAt clears.
      const violation = checkWatchingOptOut(transitionInput);
      if (violation) {
        return {
          summary: violation.summary,
          data: { ok: false, ...violation.data },
          sources: [],
        };
      }
      patch.status = "WATCHING";
      patch.promotedAt = null;
      updateType = "STATUS_CHANGED";
    }
    // P1-24: the legacy WATCHING/PROMOTED → ACTIVE promotion path was removed
    // from this tool. Entering a position is place_trade (it flips the thesis
    // WATCHING/PROMOTED → HOLDING atomically with the Alpaca fill and computes
    // the levels from the actual entry); the agent no longer sets a holding
    // status via update_thesis.

    // ── ENTER-trigger guard (parity with record_thesis) ──────────────────
    // A WATCHING LONG/SHORT thesis must have at least one ENTER trigger,
    // otherwise the trigger evaluator has no entry-promotion path and the
    // thesis sits inert forever. record_thesis enforced this at mint time;
    // this guard plugs the second write surface so the thesis-writer's
    // refresh path can't strip the ENTER trigger by passing a HELD-style
    // triggers[] array (XPEV 2026-05-25 production evidence).
    //
    // Runs LATE so patch.status / patch.direction / patch.triggers reflect
    // every transition processed above (change_status, PENDING-promotion,
    // PASS → PASSED, wholesale-trigger-replace). Pure helper lives in
    // lib/agent/triggers/enter-guard.ts and is shared with record_thesis.
    // P1-24 B4: existing.direction may be null (unresearched seed). The
    // enter-guard treats any non-LONG/SHORT value (incl. null/'PENDING') as
    // a bypass, so passing null through is correct.
    // P1-24 PASS-off-direction: a PASS patch sets patch.direction=null — a
    // VALID patched value, not "absent". Use `"direction" in patch` so the
    // null isn't swallowed by `??` and we don't fall back to the stale
    // existing direction (which would let the guard inspect a LONG/SHORT it
    // no longer is). When direction was patched, the patched value wins
    // (incl. null); otherwise keep the existing direction.
    const effectiveEnterDirection = ("direction" in patch
      ? patch.direction
      : existing.direction) as "LONG" | "SHORT" | "PASS" | null;
    const effectiveEnterStatus = (patch.status ?? existing.status) as
      | "WATCHING"
      | "HOLDING"
      | "PROMOTED"
      | "PASSED"
      | "RETIRED";
    const effectiveEnterTriggers: Trigger[] =
      patch.triggers !== undefined
        ? ((patch.triggers as unknown as Trigger[]) ?? [])
        : Array.isArray(existing.triggers)
          ? (existing.triggers as unknown as Trigger[])
          : [];
    const effectiveEnterTarget =
      patch.targetPrice !== undefined
        ? patch.targetPrice
        : existing.targetPrice != null
          ? Number(existing.targetPrice)
          : null;
    const enterGuard = validateEnterTriggerRequired({
      direction: effectiveEnterDirection,
      status: effectiveEnterStatus,
      triggers: effectiveEnterTriggers,
      targetPrice: effectiveEnterTarget,
    });
    if (!enterGuard.ok) {
      console.warn(
        `[update-thesis] thesis=${args.thesis_id} ticker=${existing.ticker} REJECTED — WATCHING ${effectiveEnterDirection} with no ENTER trigger.`,
      );
      return {
        summary: `Refused update on $${existing.ticker} — WATCHING ${effectiveEnterDirection} requires an ENTER trigger.`,
        data: {
          ok: false,
          error: "missing_enter_trigger",
          message: enterGuard.note,
        },
        sources: [],
      };
    }

    // ── Protective-level ratchet gate (DAV-185) ──────────────────────────
    // The 2026-08-16 standing ruling as code: on a held stock, an analyst
    // may raise/tighten a protective sell level; it may never lower, widen,
    // or delete one, or demote it from automatic (DIRECT) to judgment-first.
    // Prompt-side versions of this rule failed live on 2026-08-18 (MU floor
    // 948 → 814 while two sell proposals from the 948 breach sat awaiting
    // approval). The principal's UI paths (thesis sheet, reject dialog —
    // lib/actions/thesis-edit.ts / level-triggers.ts) don't run this gate;
    // "thesis is broken, sell" flows don't either (terminal transitions set
    // patch.status, so effectiveEnterStatus is no longer HOLDING, and the
    // sell itself is close_position).
    //
    // Runs LATE like the ENTER guard: patch.triggers is the final processed
    // replacement (post dropRedundantInherited), so resending an inherited
    // rung verbatim stays legal, while deleting a thesis override to let a
    // weaker inherited value show through is caught.
    if (effectiveEnterStatus === "HOLDING") {
      const ratchetProblems: string[] = [];
      if (patch.triggers !== undefined) {
        const violations = protectiveRatchetViolations({
          direction: effectiveEnterDirection,
          before: Array.isArray(existing.triggers)
            ? (existing.triggers as unknown as Trigger[])
            : [],
          after: (patch.triggers as unknown as Trigger[]) ?? [],
          inherited: inheritedLadder,
        });
        ratchetProblems.push(...violations.map(describeRatchetViolation));
      }
      // The stopLoss COLUMN is the same safety line in its scalar form
      // (P1-42 dual representation) — tactical validation reads it, so a
      // lowered column misinforms the next protective-fire review even
      // though the trigger evaluator fires off the rungs.
      if (patch.stopLoss !== undefined) {
        const oldStop =
          existing.stopLoss != null ? Number(existing.stopLoss) : null;
        const newStop = patch.stopLoss;
        if (oldStop != null && newStop == null) {
          ratchetProblems.push(
            `stop_loss $${oldStop} → cleared — that removes the recorded stop on a stock we own.`,
          );
        } else if (oldStop != null && newStop != null) {
          const isLong = effectiveEnterDirection !== "SHORT";
          if (isLong ? newStop < oldStop : newStop > oldStop) {
            ratchetProblems.push(
              `stop_loss $${oldStop} → $${newStop} — that moves the stop the wrong way on a stock we own.`,
            );
          }
        }
      }
      if (ratchetProblems.length > 0) {
        console.warn(
          `[update-thesis] thesis=${args.thesis_id} ticker=${existing.ticker} REJECTED — protective-level ratchet: ${ratchetProblems.length} violation(s).`,
        );
        return {
          summary: `Refused update on $${existing.ticker} — protective levels on a held stock only move toward more protection.`,
          data: {
            ok: false,
            error: "protective_level_locked",
            message:
              `This update weakens the protection on $${existing.ticker}, a stock we currently own:\n` +
              ratchetProblems.map((p) => `  • ${p}`).join("\n") +
              `\n\nProtective levels only move toward MORE protection. Only the principal moves a safety line down, widens it, or removes it — from the thesis sheet or when rejecting a sell proposal. ` +
              `Resend your update keeping every current protective level (raising/tightening is fine). If you believe a level is wrong, say so in your rationale with the number you'd suggest and why — that reaches the principal with the next proposal.`,
          },
          sources: [],
        };
      }
    }

    // ── Stamp when we looked (DAV-193, relocated by DAV-195 L7) ─────────
    // DAV-193 shipped a conditional bump here: a non-terminal update on an
    // already-overdue thesis pushed nextReviewAt forward by the horizon
    // cadence. It fixed same-morning re-fires, and it needed three inputs
    // (the current date, the horizon, the cadence table) to decide a date
    // that a second block below decided differently.
    //
    // The clock now counts from when we last LOOKED, so there is nothing to
    // compute: record the fact and let the cadence trigger do the arithmetic.
    // nextReviewAt becomes a derived display value.
    //
    // A decline is not a review and never reaches here — declining a sell
    // proposal leaves the market condition true, so that trigger fires again
    // tomorrow, unchanged. This is the other thing: the analyst looked, even
    // if it concluded nothing changed. If a run skips the thesis or crashes,
    // nothing is stamped and it stays due.
    if (patch.status !== "RETIRED" && patch.status !== "PASSED") {
      const reviewedAt = new Date();
      patch.lastReviewedAt = reviewedAt;
      // And recompute the derived date. L7 stamped lastReviewedAt, called
      // nextReviewAt "derived", and derived it nowhere — so the column froze
      // and the overdue cron read every thesis past its last written date as
      // permanently overdue.
      patch.nextReviewAt = nextReviewFrom(
        reviewedAt,
        (patch.triggers as unknown as Trigger[]) ??
          (Array.isArray(existing.triggers)
            ? (existing.triggers as unknown as Trigger[])
            : []),
        (args.horizon ?? existing.horizon) as Horizon | null,
      );
    }

    // ── Narrative-only patches collapse to REVIEWED ──────────────────────
    // A "narrative-only" patch touches only fields the agent can fill on
    // every housekeeping pass without anything structural having changed:
    // a rewritten reasoningSummary, a re-keyed riskFlags list, refreshed
    // thesisBullets, a bumped nextReviewAt. Under gpt-4o the agent would
    // call update_thesis(rationale) with no other fields and the
    // empty-patch path below classified the row as REVIEWED. Under gpt-5.5
    // (swap day 2026-05-12) the agent is verbosely chattier and fills
    // narrative fields on every closeout, so the audit log collapsed: 0
    // REVIEWED rows from morning-runs since the swap, all 18-37 daily
    // UPDATED. That destroys the audit-log signal — run-reviews can no
    // longer separate "agent reviewed it" from "agent actually changed
    // something."
    //
    // Solution: classify a non-empty patch that touches only narrative
    // keys as REVIEWED, same as the empty-patch path below. Status
    // transitions (already set above as INVALIDATED/CLOSED/STATUS_CHANGED)
    // stay as-is — narrative reclassification only applies to the default
    // UPDATED bucket.
    //
    // A7 from docs/plans/SYSTEM_AUDIT_2026_05_19.md.
    // PR-9 flat schema: the patch writes `snapshot` / `bullCase` / `bearCase`
    // (the legacy reasoning_summary / thesis_bullets / risk_flags args are
    // wrapped into those keys above), so the narrative set must name the keys
    // that actually land in the patch. `researchUpdatedAt` rides along — it is
    // auto-stamped whenever any narrative section arrives, and must not make a
    // narrative-only patch look structural. The stale legacy names here were
    // half of the empty-diff audit hole (GAPS P2, prerequisite for P1-33):
    // narrative refreshes stopped collapsing to REVIEWED and instead landed as
    // UPDATED rows whose diff dropped every key.
    const NARRATIVE_KEYS = new Set([
      "snapshot",
      "bullCase",
      "bearCase",
      "nextReviewAt",
      "researchUpdatedAt",
    ]);
    const patchKeysList = Object.keys(patch);
    const isNarrativeOnly =
      patchKeysList.length > 0 &&
      updateType === "UPDATED" &&
      patchKeysList.every((k) => NARRATIVE_KEYS.has(k));
    if (isNarrativeOnly) {
      updateType = "REVIEWED";
    }

    // Empty patch (only rationale supplied)? That's a REVIEWED row, not
    // an UPDATED row. Useful when housekeeping looks at a thesis and
    // decides it's still right — we want a paper trail of "agent looked
    // here on this date" without polluting the diff log.
    //
    // A REVIEWED-only touch stamps the same clock as any other review —
    // looking IS the event, whether or not anything changed. The horizon
    // cadence lookup that used to live here is gone with the second copy of
    // the review clock; the cadence is a trigger now and it reads this stamp.
    const patchKeyCount = Object.keys(patch).length;
    if (patchKeyCount === 0) {
      const reviewedAt = new Date();
      await prisma.thesis.update({
        where: { id: existing.id },
        data: {
          lastReviewedAt: reviewedAt,
          nextReviewAt: nextReviewFrom(
            reviewedAt,
            Array.isArray(existing.triggers)
              ? (existing.triggers as unknown as Trigger[])
              : [],
            existing.horizon as Horizon | null,
          ),
        },
      });

      // Awaited (was void). Both the morning-research coverage gate and
      // the tactical-run close-out gate query ThesisUpdate immediately
      // after the agent finishes — fire-and-forget races caused false
      // FAILED on legitimate REVIEWED-only runs.
      await writeThesisUpdate({
        thesisId: existing.id,
        type: "REVIEWED",
        summary: `Reviewed ${existing.ticker} thesis — no changes`,
        rationale: args.rationale,
        runId: ctx.runId,
        signalIds: args.signal_ids,
        triggerId: args.trigger_id,
        priceAtTime: resolvedPriceAtTime,
      });
      return {
        summary: `Reviewed ${existing.ticker} thesis: no changes.`,
        data: {
          ok: true,
          thesis_id: existing.id,
          type: "REVIEWED" as const,
          card: thesisToCardData({ ...existing, lastReviewedAt: reviewedAt }),
        },
        sources: [],
      };
    }

    // Compute the diff BEFORE applying so the field-changes payload reflects
    // only what actually moved.
    //
    // These are the keys the patch above can actually write (PR-9 flat
    // schema). The pre-PR-9 legacy names (reasoningSummary / thesisBullets /
    // riskFlags / confidenceScore) sat here long after the patch stopped
    // writing them, so every narrative/scoring/section change fell through
    // the diff — 47% of UPDATED rows carried an empty fieldChanges (GAPS P2
    // audit hole, prerequisite for P1-33). Keep this list in lockstep with
    // the patch assembly above.
    const diffFields = [
      // Narrative (flat schema)
      "snapshot",
      "bullCase",
      "bearCase",
      // Research sections (V2)
      "recentCatalysts",
      "fundamentals",
      "latestEarnings",
      "catalystsAndEvents",
      "analystConsensus",
      "insiderTechnical",
      "researchData",
      // Belief
      "coreBelief",
      "keyAssumptions",
      "invalidationConds",
      // Conviction + scoring
      "scoring",
      "conviction",
      "convictionRationale",
      "variantView",
      // Trade plan
      "direction",
      "entryPrice",
      "targetPrice",
      "stopLoss",
      "targetSizePct",
      "horizon",
      "catalystDate",
      "nextReviewAt",
      "triggers",
      "scalingPlan",
      // Lifecycle
      "status",
      "retiredReason",
    ] as const;
    // Bulky JSONB sections store a short preview instead of two full copies
    // per row. Scalars and the trigger arrays keep exact from/to — the
    // Activity timeline renders those numbers ("floor 64 → 71") directly.
    const BULKY_DIFF_KEYS = [
      "snapshot",
      "bullCase",
      "bearCase",
      "recentCatalysts",
      "fundamentals",
      "latestEarnings",
      "catalystsAndEvents",
      "analystConsensus",
      "insiderTechnical",
      "researchData",
    ] as const;
    const prevSnapshot = Object.fromEntries(
      diffFields.map((f) => [f, (existing as Record<string, unknown>)[f]]),
    );
    const nextSnapshot: Record<string, unknown> = { ...prevSnapshot };
    for (const [k, v] of Object.entries(patch)) {
      if (k in nextSnapshot) nextSnapshot[k] = v;
    }
    const fieldChanges = compactFieldChanges(
      diffThesisFields(prevSnapshot, nextSnapshot, [...diffFields]),
      BULKY_DIFF_KEYS,
    );

    // ── Structural-unchanged-reason gate (P0-1) ──────────────────────────
    // Substantive non-belief patches (target_price / stop_loss /
    // confidence_score) without touching at least one belief field
    // (core_belief / key_assumptions / invalidation_conditions) AND
    // without `structural_unchanged_reason` are rejected.
    //
    // Why: audit Root Cause showed reasoning_summary + thesis_bullets get
    // rewritten constantly while structural fields are touched on <6% of
    // updates. The agent silently moves target/stop/confidence without
    // ever interrogating whether the underlying belief still holds. The
    // gate forces one of two outcomes:
    //   (a) the belief HAS shifted → update at least one belief field, OR
    //   (b) the belief HASN'T shifted → state explicitly why in
    //       `structural_unchanged_reason` (e.g. "key_assumption #2
    //       confirmed by today's earnings beat — raising target,
    //       belief unchanged").
    //
    // Bypass conditions (gate doesn't apply):
    //   - terminal transitions (INVALIDATED / CLOSED) — the patch is
    //     paperwork on a dead thesis, belief is frozen by definition
    //   - REVIEWED-only updates (empty patch) — handled separately above
    //   - patches that don't touch any quant field — pure rationale
    //     refreshes, narrative cleanups, signal_type re-tags
    // (confidenceScore was dropped in PR-9 — the patch can't write it, so a
    // check on it here was permanently false. Composite/scoring changes are
    // deliberately NOT quant-gated: the thesis-writer refreshes scoring on
    // every pass and gating it would refuse routine refreshes.)
    const touchesQuant = !!(fieldChanges.targetPrice || fieldChanges.stopLoss);
    const touchesBelief = !!(
      fieldChanges.coreBelief ||
      fieldChanges.keyAssumptions ||
      fieldChanges.invalidationConds
    );
    const hasUnchangedReason =
      typeof args.structural_unchanged_reason === "string" &&
      args.structural_unchanged_reason.trim().length >= 10;
    // The gate bypasses on a deliberate terminal transition — belief is
    // frozen by definition. (The legacy ACTIVE-promotion bypass is gone; entry
    // is place_trade, which doesn't route through this tool.)
    const isStateTransition = isTerminalTransition;
    if (
      touchesQuant &&
      !touchesBelief &&
      !hasUnchangedReason &&
      !isStateTransition
    ) {
      const changed = Object.keys(fieldChanges).filter((f) =>
        ["confidenceScore", "targetPrice", "stopLoss"].includes(f),
      );
      return {
        summary: `Refused update on $${existing.ticker} — quant change without belief change or justification.`,
        data: {
          ok: false,
          error: "structural_belief_unchanged",
          message:
            `You're patching ${changed.join(", ")} on ${existing.ticker} without touching the underlying belief (core_belief / key_assumptions / invalidation_conditions). ` +
            `The discipline rule: a substantive trade-plan change requires either (1) a corresponding belief update — refine an assumption, drop one that's been confirmed, add an invalidation condition that just became plausible — OR (2) an explicit \`structural_unchanged_reason\` (≥10 chars) stating why the underlying belief still holds. ` +
            `Examples of (2): "key_assumption #2 (datacenter capex) confirmed by today's earnings beat — raising target to reflect, belief unchanged", or "tightening stop after price moved in our favor; assumptions and invalidation conditions still hold". ` +
            `Retry with one of those.`,
        },
        sources: [],
      };
    }

    // Apply.
    try {
      await prisma.thesis.update({
        where: { id: existing.id },
        data: patch as object,
      });
    } catch (updErr: unknown) {
      // THESIS_RESEARCH_V2 fallback — mirrors record_thesis.ts. If the
      // Prisma client is out of sync with the schema (e.g. the V2 columns
      // haven't been regenerated locally), retry the update without those
      // fields so the rest of the patch lands. Loud log so we notice if
      // this fires in production — the schema migration shipped in
      // PR #278 + PR-9 so it should never trigger, but the strip mirrors
      // record_thesis's defense-in-depth.
      const errMsg = updErr instanceof Error ? updErr.message : String(updErr);
      const isUnknownArgError =
        errMsg.includes("Unknown arg") ||
        errMsg.includes("Unknown argument") ||
        (errMsg.includes("researchData") && errMsg.includes("does not exist")) ||
        (errMsg.includes("researchUpdatedAt") && errMsg.includes("does not exist")) ||
        (errMsg.includes("snapshot") && errMsg.includes("does not exist")) ||
        (errMsg.includes("bullCase") && errMsg.includes("does not exist")) ||
        (errMsg.includes("bearCase") && errMsg.includes("does not exist"));
      const hasV2Field =
        "researchData" in patch ||
        "researchUpdatedAt" in patch ||
        "snapshot" in patch ||
        "bullCase" in patch ||
        "bearCase" in patch ||
        "recentCatalysts" in patch ||
        "fundamentals" in patch ||
        "latestEarnings" in patch ||
        "catalystsAndEvents" in patch ||
        "analystConsensus" in patch ||
        "insiderTechnical" in patch;
      if (isUnknownArgError && hasV2Field) {
        console.error(
          `[tool] update_thesis V2 FALLBACK for ${existing.ticker}: stripping V2 research columns. Prisma client appears out of sync. Full error: ${errMsg}`,
        );
        const {
          researchData: _rdata,
          researchUpdatedAt: _rupdated,
          snapshot: _snap,
          bullCase: _bcase,
          bearCase: _xcase,
          recentCatalysts: _rcat,
          fundamentals: _fund,
          latestEarnings: _learn,
          catalystsAndEvents: _cae,
          analystConsensus: _acons,
          insiderTechnical: _itech,
          ...fallbackPatch
        } = patch;
        void _rdata;
        void _rupdated;
        void _snap;
        void _bcase;
        void _xcase;
        void _rcat;
        void _fund;
        void _learn;
        void _cae;
        void _acons;
        void _itech;
        await prisma.thesis.update({
          where: { id: existing.id },
          data: fallbackPatch as object,
        });
      } else {
        throw updErr;
      }
    }

    // Watchlist-collapse: Thesis is now the single store. WATCHING →
    // terminal transitions automatically remove the thesis from the
    // watchlist view (which is just `WHERE status='WATCHING'`). No
    // mirror table to sync.

    // Build a punchy summary line for the timeline list view.
    const summaryParts: string[] = [];
    if (fieldChanges.targetPrice) {
      summaryParts.push(
        `target ${fmtNum(fieldChanges.targetPrice.from)} → ${fmtNum(fieldChanges.targetPrice.to)}`,
      );
    }
    if (fieldChanges.stopLoss) {
      summaryParts.push(
        `stop ${fmtNum(fieldChanges.stopLoss.from)} → ${fmtNum(fieldChanges.stopLoss.to)}`,
      );
    }
    if (fieldChanges.scoring) {
      const from = (fieldChanges.scoring.from as { composite?: number } | null)
        ?.composite;
      const to = (fieldChanges.scoring.to as { composite?: number } | null)
        ?.composite;
      summaryParts.push(
        from != null && to != null && from !== to
          ? `composite ${from} → ${to}`
          : "scoring updated",
      );
    }
    if (fieldChanges.status) {
      summaryParts.push(
        `${fieldChanges.status.from} → ${fieldChanges.status.to}`,
      );
    }
    if (fieldChanges.triggers) {
      summaryParts.push("triggers updated");
    }
    if (
      fieldChanges.coreBelief ||
      fieldChanges.snapshot ||
      fieldChanges.bullCase ||
      fieldChanges.bearCase ||
      fieldChanges.invalidationConds ||
      fieldChanges.keyAssumptions
    ) {
      summaryParts.push("rationale updated");
    }
    if (
      fieldChanges.recentCatalysts ||
      fieldChanges.fundamentals ||
      fieldChanges.latestEarnings ||
      fieldChanges.catalystsAndEvents ||
      fieldChanges.analystConsensus ||
      fieldChanges.insiderTechnical ||
      fieldChanges.researchData
    ) {
      summaryParts.push("research refreshed");
    }
    const verb = updateType === "REVIEWED" ? "Reviewed" : "Updated";
    const summary =
      summaryParts.length > 0
        ? `${verb} ${existing.ticker}: ${summaryParts.join(", ")}`
        : `${verb} ${existing.ticker} thesis`;

    // Awaited (was void). The tactical-run close-out gate and the
    // morning-research coverage gate both query ThesisUpdate the moment
    // the agent finishes; fire-and-forget races dropped the row past
    // the gate's read horizon and false-failed legitimate runs.
    //
    // structural_unchanged_reason is appended to the timeline rationale
    // when supplied so the discipline justification is preserved alongside
    // the change explanation — otherwise it'd be visible only in agent
    // logs, not in the user-facing thesis timeline.
    const persistedRationale = hasUnchangedReason
      ? `${args.rationale}\n\n[Belief unchanged: ${args.structural_unchanged_reason!.trim()}]`
      : args.rationale;
    await writeThesisUpdate({
      thesisId: existing.id,
      type: updateType,
      summary,
      rationale: persistedRationale,
      fieldChanges,
      runId: ctx.runId,
      signalIds: args.signal_ids,
      triggerId: args.trigger_id,
      tradeId: args.trade_id,
      priceAtTime: resolvedPriceAtTime,
    });

    return {
      summary,
      data: {
        ok: true,
        thesis_id: existing.id,
        type: updateType,
        changed_fields: Object.keys(fieldChanges),
        // Post-update thesis snapshot for the chat renderer. Merges the
        // pre-update record with the patch we just applied — no extra DB
        // read. Drives the "Wrote / edited theses" carousel.
        card: thesisToCardData({ ...existing, ...patch }),
      },
      sources: [],
    };
  },
});

/**
 * Map a Thesis row (from prisma) to the ThesisCardData shape consumed by
 * ThesisCardRenderer. Same shape that record_thesis returns.
 */
function thesisToCardData(t: Record<string, unknown>): {
  thesis_id: string;
  ticker: string;
  // P1-24: `LONG | SHORT | null`. A pass stores direction=null and carries
  // the pass fact on status=PASSED below; the renderer + sheet key on status.
  direction: "LONG" | "SHORT" | null;
  confidence_score: number;
  reasoning_summary: string;
  thesis_bullets: string[];
  risk_flags: string[];
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  hold_duration?: string;
  signal_types: string[];
  status: "HOLDING" | "WATCHING" | "PROMOTED" | "RETIRED" | "PASSED";
} {
  return {
    thesis_id: t.id as string,
    ticker: t.ticker as string,
    direction: (t.direction as "LONG" | "SHORT" | null) ?? null,
    confidence_score: (t.confidenceScore as number) ?? 0,
    reasoning_summary: (t.reasoningSummary as string) ?? "",
    thesis_bullets: (t.thesisBullets as string[]) ?? [],
    risk_flags: (t.riskFlags as string[]) ?? [],
    entry_price:
      typeof t.entryPrice === "number" ? (t.entryPrice as number) : null,
    target_price:
      typeof t.targetPrice === "number" ? (t.targetPrice as number) : null,
    stop_loss:
      typeof t.stopLoss === "number" ? (t.stopLoss as number) : null,
    // Hold duration is now derived from `horizon` at card-data assembly
    // time (PR-4 — the legacy column drops in PR-5). Falls back to the
    // legacy column for rows that don't yet have horizon set.
    hold_duration:
      typeof t.horizon === "string" && t.horizon.length > 0
        ? holdDurationFromHorizon(t.horizon)
        : ((t.holdDuration as string) ?? undefined),
    signal_types: (t.signalTypes as string[]) ?? [],
    status: (t.status as
      | "HOLDING"
      | "WATCHING"
      | "PROMOTED"
      | "RETIRED"
      | "PASSED") ?? "WATCHING",
  };
}

function fmtNum(v: unknown): string {
  if (typeof v === "number") return v.toFixed(2);
  if (v == null) return "—";
  return String(v);
}
