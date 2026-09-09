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
 * - Triggers change one at a time (DAV-242): `add_triggers`, `edit_triggers`
 *   by id, `remove_trigger_ids`, and the entry / target / stop arguments are
 *   the same ops on the buy / target / floor trigger. Every op is its own
 *   line in the activity log; a refused op is reported by id and the rest
 *   of the call lands. See lib/agent/triggers/ops.ts.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import {
  parseTriggersResilient,
  triggersArraySchema,
  triggerActionSchema,
} from "@/lib/agent/triggers/schema";
import {
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { ResolvedTrigger } from "@/lib/agent/triggers/levels";
import {
  acceptedOps,
  applyTriggerOps,
  checkLadder,
  type TriggerOp,
  type TriggerOpResult,
} from "@/lib/agent/triggers/ops";
import {
  writeThesisUpdate,
  diffThesisFields,
  compactFieldChanges,
  type ThesisUpdateType,
} from "@/lib/agent/thesis-updates";
import { getStockQuote } from "@/lib/actions/finnhub.actions";
import { isUnresearchedSeed } from "@/lib/agent/thesis-direction";
import {
  checkStatusTransition,
  checkTerminateWithoutClose,
  checkWatchingOptOut,
  needsPairedCloseCheck,
} from "@/lib/agent/thesis-transitions";
import { holdDurationFromHorizon } from "@/lib/agent/horizon-policy";

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
  target_price: z.number().nullable().optional()
    .describe("The target — edits the target trigger (adds one if none, null removes it). One change, one activity line."),
  stop_loss: z.number().nullable().optional()
    .describe("The floor — edits the sell-below trigger (adds one if none, null removes it). On a held stock it may only tighten."),
  entry_price: z.number().nullable().optional()
    .describe(
      "WHERE YOU'D BUY IN — edits the buy trigger (adds one if none, null removes it). A price the stock has NOT reached, never the current quote. " +
      "The side follows the level: BELOW the current quote is a pullback you want to buy, ABOVE it is a breakout you want confirmed first — the buy trigger is rewritten to match, so you only have to pick the number. " +
      "A level AT the quote is a buy condition that is already true and re-fires every cooldown until someone removes it; if you want to buy now, call place_trade. " +
      "REQUIRED when promoting an unresearched seed to LONG/SHORT. Not editable on a held stock — there the entry is the fill."
    ),

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
      "Promote or demote when the trade structure has actually changed. Examples: a TRADE that's compounding past its 14d window because the thesis got bigger → upgrade to TARGET. A COMPOUNDER whose moat eroded but isn't dead → downgrade to TARGET with a tighter exit. A CATALYST that printed and is now a position trade on residual momentum → upgrade to TARGET. The review cadence follows the new horizon automatically — leaving the old cadence trigger in place produces a thesis whose exit policy doesn't match its label, so resend the trigger list to match. Only spawn a fresh record_thesis when direction or core belief flips, not when the time horizon evolves.",
    ),
  catalyst_date: z.string().datetime().nullable().optional(),

  // ── Trigger ops (DAV-242) — one trigger at a time, never a whole list ──
  add_triggers: triggersArraySchema
    .optional()
    .describe(
      "Triggers to ADD. Each is { predicate, action, rationale, cooldownDays?, fireMode? }; ids are minted here. " +
        "Adding where one already exists (a second buy trigger, target, floor, or review cadence) EDITS the existing one — a stock never carries two buy triggers.",
    ),
  edit_triggers: z
    .array(
      z.object({
        id: z.string().describe("The trigger's id, from get_theses."),
        level: z.number().optional().describe("New price for a price-above / price-below trigger."),
        pct: z.number().optional().describe("New percent for a move / gain / trailing trigger."),
        days: z.number().int().optional().describe("New day count for a time-elapsed / review-cadence trigger."),
        action: triggerActionSchema.optional(),
        fire_mode: z.enum(["TACTICAL", "DIRECT"]).optional(),
        rationale: z.string().optional().describe("REQUIRED when level / pct / days changes — the sentence moves with the number."),
        cooldown_days: z.number().int().min(0).max(90).optional(),
      }),
    )
    .optional()
    .describe(
      "Triggers to EDIT by id. Change the number, the action, the fire mode, or the wording. A level change needs a rationale. " +
        "On a held stock a protective sell level may only tighten — a loosening edit is refused by itself; the rest of the call lands.",
    ),
  remove_trigger_ids: z
    .array(z.string())
    .optional()
    .describe("Triggers to REMOVE by id. On a held stock a protective sell trigger cannot be removed."),

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
        "ARCHIVED = walked away from coverage without evidence-based invalidation (e.g. agent or user removed it from the watchlist — it retires the thesis with reason DROPPED). Off the watchlist; visible on the stock page as institutional memory. Use it ONLY when you never want this name back. To stop paying for a name, or to shelve a plan that does not work, keep it WATCHING and resend triggers without the plan levels and clock — that costs nothing and the name stays in view. (A researched-and-declined PASS is NOT this — pass direction: \"PASS\", which lands status=PASSED.) " +
        "For direction flips or completely new beliefs, use record_thesis with parent_thesis_id instead.",
    ),

  // ── Deep-research artifact passthrough (THESIS_RESEARCH_V2 refresh) ───
  // Mirror of record_thesis's research_data arg. Populated by the
  // thesis-writer pipeline's refresh path (run-thesis-writer.ts).
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
      "Raw structured-data markdown block from the thesis-writer's data pull. " +
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
  // ── Conviction Expression v4 (existing-row read) ──────────────────────
  conviction: string | null;
  convictionRationale: string | null;
  variantView: string | null;
  horizon: string | null;
  catalystDate: Date | null;
  lastReviewedAt: Date | null;
  triggers: object;
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
    "Three hard-reject conditions to know about: " +
    "(1) goalpost-moving guard — refuses to raise targetPrice on a WATCHING thesis whose existing entry condition is currently met (price has crossed the old target — your job is to PROMOTE, not move the bar); " +
    "(2) structural-belief discipline gate — patches that change confidence_score / target_price / stop_loss WITHOUT also touching core_belief / key_assumptions / invalidation_conditions are rejected unless `structural_unchanged_reason` is supplied. Either update the belief to reflect why the trade plan is moving, or state explicitly why the belief is intact; " +
    "(3) protective-level ratchet — on a held stock, protective sell levels only move toward MORE protection. Lowering a stop, widening a trailing give-back, removing a protective sell trigger, or switching one from automatic to judgment-first is refused per trigger (the rest of the call still lands; every op comes back in `trigger_ops` with accepted/refused and why). Only the principal moves a safety line down. If you believe a level is wrong, keep it and say so in your rationale with the number you'd suggest.",
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
        // Conviction Expression v4 — read existing values so gates can
        // enforce coherence when only a subset of (conviction, rationale,
        // variantView) is being patched.
        conviction: true,
        convictionRationale: true,
        variantView: true,
        horizon: true,
        catalystDate: true,
        triggers: true,
        // Per-thesis fire state for inherited rungs — read so a rung
        // dropped as redundant can hand its cooldown stamp over.
        triggerState: true,
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
    // with reasoning/bullets set but NO `direction` arg. The call succeeded
    // (patch was non-empty so the empty-patch auto-bump didn't fire), the
    // agent pushed the review clock forward 30 days, and the seed got
    // buried for a month with no commitment. F1 in the V2 prompt tells the
    // agent to commit; this gate ENFORCES it tool-side.
    //
    // Rule: any update_thesis call on an unresearched seed MUST include
    // `direction`. The seed is "awaiting first research" — there's nothing
    // to refine until the agent commits to a view. Refining the seed's
    // reasoning/bullets without committing is the wrong shape regardless
    // of how good the rationale is.
    //
    // P1-24 B4: a seed is direction=null (new) or 'PENDING' (legacy) — the
    // isUnresearchedSeed helper catches both during the dual-read window.
    //
    // DAV-209: direction-null also covers "looked, no view yet, keeping the
    // name in view." That is a finished decision, not an unresearched seed,
    // and its wake triggers must stay editable without forcing a direction
    // commitment. The derived discriminator: such a row carries ≥1
    // AGENT-authored trigger; a seed carries none (zero triggers, or only a
    // DEFAULT-source clock).
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
            `Refining a PENDING's reasoning/bullets without committing direction buries it on the watchlist and surfaces it again later with no progress. That's a soft fail dressed up as a review. Decide and commit.`,
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

    // A terminal flip clears the plan, so the price-shape rules below don't
    // apply to it. (PASS on a seed is terminal too — it lands PASSED.)
    const isTerminalTransition =
      args.change_status === "INVALIDATED" ||
      args.change_status === "ARCHIVED" ||
      args.direction === "PASS";

    // ── Trigger ops (DAV-242) ────────────────────────────────────────────
    // Every trigger change is an op: add, edit by id, remove by id — and
    // the entry / target / stop arguments are the same ops on the buy /
    // target / floor trigger. Zero triggers is a legal state (DAV-209): a
    // review-only update on a bare thesis goes through untouched.
    const triggerOps: TriggerOp[] = [
      ...(args.add_triggers ?? []).map((t) => ({ op: "add" as const, trigger: t as Trigger })),
      ...(args.edit_triggers ?? []).map((e) => ({
        op: "edit" as const,
        id: e.id,
        level: e.level,
        pct: e.pct,
        days: e.days,
        action: e.action,
        fireMode: e.fire_mode,
        rationale: e.rationale,
        cooldownDays: e.cooldown_days,
      })),
      ...(args.remove_trigger_ids ?? []).map((id) => ({ op: "remove" as const, id })),
      ...(args.entry_price !== undefined ? [{ op: "level" as const, slot: "ENTRY" as const, price: args.entry_price }] : []),
      ...(args.stop_loss !== undefined ? [{ op: "level" as const, slot: "FLOOR" as const, price: args.stop_loss }] : []),
      ...(args.target_price !== undefined ? [{ op: "level" as const, slot: "TARGET" as const, price: args.target_price }] : []),
    ];

    // The levels above this thesis, resolved against an EMPTY thesis array
    // so we see them unmasked by the thesis's own triggers. Lazy: this is
    // the most-called tool in the app and most calls don't touch triggers.
    let inheritedLadder: ResolvedTrigger[] = [];
    if (triggerOps.length > 0 && !isTerminalTransition) {
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
    // target_price / stop_loss / entry_price are NOT written here. A level
    // change is a trigger op; the columns are recomputed from the resulting
    // trigger list in the ops block below. Writing the column directly is
    // how SNOW ended up showing a $256 stop that nothing would ever have
    // sold at. See docs/plans/LEVELS_AS_TRIGGERS.md.
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
    // type a date. Every surface derives the due date at read time (DAV-221).
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
    // ── Apply the trigger ops ────────────────────────────────────────────
    // Rules run per op on the resulting list (one trigger per bucket, the
    // ratchet on a held stock, a rationale on an agent's level change); a
    // refused op is reported by id and the rest lands. Then ONE check on the
    // derived plan — ordering, and 2:1 on a plan we don't own — replaces the
    // argument gate and the derived-tuple gate that used to run here.
    const opResults: TriggerOpResult[] = [];
    if (triggerOps.length > 0) {
      if (isTerminalTransition) {
        opResults.push(
          ...triggerOps.map((o) => ({
            op: o.op === "level" ? ("edit" as const) : o.op,
            id: "id" in o ? o.id : "",
            ok: false,
            text: "Trigger change",
            reason: "The thesis is being retired in this call — its triggers are cleared with it.",
          })),
        );
      } else if (parseTriggersResilient(existing.triggers).dropped > 0) {
        // A write must not "repair" a list by dropping what it can't parse —
        // that would silently delete a stop. Say so; nothing changes.
        opResults.push(
          ...triggerOps.map((o) => ({
            op: o.op === "level" ? ("edit" as const) : o.op,
            id: "id" in o ? o.id : "",
            ok: false,
            text: "Trigger change",
            reason: `$${existing.ticker} carries a trigger that cannot be parsed — fix the stored triggers before editing them.`,
          })),
        );
      } else {
        const levelDirection = ("direction" in patch ? patch.direction : existing.direction) as string | null;
        const levelStatus = (patch.status ?? existing.status) as string | null;
        const existingTriggers = parseTriggersResilient(existing.triggers).triggers as Trigger[];
        const applied = applyTriggerOps({
          stored: existingTriggers,
          inherited: inheritedLadder,
          ops: triggerOps,
          direction: levelDirection,
          status: levelStatus,
          actor: "AGENT",
          // The tape decides which side a re-levelled buy trigger compares on.
          // Without it every re-level was a breakout: the CRM shape, where the
          // analyst wrote "buy the pullback to $203" and the row stored
          // "buy above $203" against a $258 tape.
          currentPrice: resolvedPriceAtTime,
          mintId: () => randomUUID(),
        });
        opResults.push(...applied.results);

        if (applied.results.some((r) => r.ok)) {
          // Held: the entry is the fill. The open Position's avgCost is the
          // canonical record of what we actually own at what price (the
          // 2026-05-12 AMD shape — a $420 planned entry, a $446 fill, and a
          // $434 stop refused against the plan). Fall back to the row.
          const held = levelStatus === "HOLDING";
          const openPosition =
            held && ctx.analystId
              ? await prisma.position.findFirst({
                  where: {
                    analystId: ctx.analystId,
                    symbol: existing.ticker,
                    status: "OPEN",
                  },
                  select: { avgCost: true },
                  orderBy: { openedAt: "desc" },
                })
              : null;
          const avgCost =
            openPosition?.avgCost != null ? Number(openPosition.avgCost) : null;
          const check = checkLadder({
            triggers: applied.triggers,
            inherited: inheritedLadder,
            direction: levelDirection,
            status: levelStatus,
            entryPrice:
              avgCost ?? (existing.entryPrice != null ? Number(existing.entryPrice) : null),
            avgCost,
          });
          if (!check.ok) {
            return {
              summary: `Refused update on $${existing.ticker} — the resulting plan is invalid (${check.error}).`,
              data: {
                ok: false,
                error: check.error,
                message: check.message,
                trigger_ops: opResults,
              },
              sources: [],
            };
          }

          // ── Goalpost-moving guard (audit Root Cause #3) ──────────────────
          // Raising the target on a WATCHING thesis whose price has already
          // crossed the OLD target is moving the bar instead of acting (the
          // MRVL pattern). A raise while price is still below the old target
          // is a legitimate refinement.
          if (
            levelStatus === "WATCHING" &&
            check.columns.targetPrice != null &&
            existing.targetPrice != null &&
            check.columns.targetPrice > Number(existing.targetPrice) &&
            resolvedPriceAtTime != null &&
            resolvedPriceAtTime >= Number(existing.targetPrice)
          ) {
            return {
              summary: `Refused to raise target on $${existing.ticker} — entry condition is currently met.`,
              data: {
                ok: false,
                error: "goalpost_moving_blocked",
                message:
                  `${existing.ticker} is at $${resolvedPriceAtTime.toFixed(2)} and the existing target is $${Number(existing.targetPrice).toFixed(2)}. The entry condition is MET — your action is to PROMOTE (place_trade, which flips WATCHING → HOLDING), not raise the target to $${check.columns.targetPrice.toFixed(2)} and walk away. If you genuinely think the setup has changed, document a concrete rejection reason in record_run_summary's decision_rationale (volume too low, regime change, fresh negative news, R/R no longer 2:1) and leave the target untouched. Or close the thesis with change_status: "INVALIDATED".`,
                trigger_ops: opResults,
              },
              sources: [],
            };
          }

          patch.triggers = applied.triggers as unknown as object;
          patch.targetPrice = check.columns.targetPrice;
          patch.stopLoss = check.columns.stopLoss;
          // entryPrice on a HELD thesis is a historical fact — what the fill
          // actually cost, written once by place_trade. On a watch row it
          // derives from the buy trigger like the others.
          if (!held) patch.entryPrice = check.columns.entryPrice;
        }
      }
    }

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

    // ── Stamp when we looked (DAV-193, relocated by DAV-195 L7) ─────────
    // The clock counts from when we last LOOKED, so there is nothing to
    // compute: record the fact and let the cadence trigger do the
    // arithmetic. Every surface that shows a review date derives it at
    // read time from this stamp (DAV-221 — the cached column is gone).
    //
    // A decline is not a review and never reaches here — declining a sell
    // proposal leaves the market condition true, so that trigger fires again
    // tomorrow, unchanged. This is the other thing: the analyst looked, even
    // if it concluded nothing changed. If a run skips the thesis or crashes,
    // nothing is stamped and it stays due.
    if (patch.status !== "RETIRED" && patch.status !== "PASSED") {
      patch.lastReviewedAt = new Date();
    }

    // ── Narrative-only patches collapse to REVIEWED ──────────────────────
    // A "narrative-only" patch touches only fields the agent can fill on
    // every housekeeping pass without anything structural having changed:
    // a rewritten reasoningSummary, a re-keyed riskFlags list, refreshed
    // thesisBullets. Under gpt-4o the agent would
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
        data: { lastReviewedAt: reviewedAt },
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
          trigger_ops: opResults,
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
      "horizon",
      "catalystDate",
      // Lifecycle
      "status",
      "retiredReason",
    ] as const;
    // Bulky JSONB sections store a short preview instead of two full copies
    // per row. Scalars keep exact from/to. The trigger list is NOT diffed:
    // the ops the caller sent are the change, stored verbatim below, and the
    // Activity feed renders those lines ("Entry $183 → $190").
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
    const landedOps = acceptedOps(opResults);
    if (landedOps.length > 0) fieldChanges.triggerOps = { from: null, to: landedOps };

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

    // Build a punchy summary line for the timeline list view. The trigger
    // ops lead, one line each — a moved entry IS the entry change, not
    // "triggers updated" plus a separate column line.
    const summaryParts: string[] = landedOps.map((o) => o.text);
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
        trigger_ops: opResults,
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
