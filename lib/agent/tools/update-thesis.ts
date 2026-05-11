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

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import { applyTriggerCooldownDefaults } from "@/lib/agent/triggers/defaults";
import type { Trigger } from "@/lib/agent/triggers/types";
import {
  writeThesisUpdate,
  diffThesisFields,
  type ThesisUpdateType,
} from "@/lib/agent/thesis-updates";
import { getStockQuote } from "@/lib/actions/finnhub.actions";
import { validateThesisShape } from "@/lib/agent/thesis-shape";
import { validateThesisBelief } from "@/lib/agent/thesis-belief";
import { HORIZON_REVIEW_DAYS, type Horizon } from "@/lib/agent/horizon-policy";

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
  reasoning_summary: z
    .string()
    .optional()
    .describe(
      "Updated 2-3 sentence trade rationale. Often diverges from core_belief over time as the rationale shifts even if the underlying belief holds.",
    ),
  thesis_bullets: z.array(z.string()).optional(),
  risk_flags: z.array(z.string()).optional(),
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
  signal_types: z.array(z.string()).optional(),

  confidence_score: z.number().int().min(0).max(100).optional(),
  target_price: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  target_size_pct: z.number().min(0).max(100).optional(),

  horizon: z
    .enum(["CATALYST", "TARGET", "TRADE", "COMPOUNDER"])
    .optional()
    .describe(
      "Promote or demote when the trade structure has actually changed. Examples: a TRADE that's compounding past its 14d window because the thesis got bigger → upgrade to TARGET (and extend maxHoldDays + push nextReviewAt to the new cadence). A COMPOUNDER whose moat eroded but isn't dead → downgrade to TARGET with a tighter exit. A CATALYST that printed and is now a position trade on residual momentum → upgrade to TARGET. When you change horizon you MUST also update maxHoldDays and nextReviewAt to the new horizon's defaults (TRADE 14d / TARGET 90d / COMPOUNDER 365d) — leaving the old cadence in place produces a thesis whose exit policy doesn't match its label, which is worse than not promoting at all. Only spawn a fresh record_thesis when direction or core belief flips, not when the time horizon evolves.",
    ),
  catalyst_date: z.string().datetime().nullable().optional(),
  max_hold_days: z.number().int().positive().max(365).nullable().optional(),
  next_review_at: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .describe(
      "When housekeeping should re-look at this thesis. Pass an ISO timestamp; pass null to clear (no scheduled review).",
    ),

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

  // ── Status transitions (deliberate) ───────────────────────────────────
  change_status: z
    .enum(["ACTIVE", "INVALIDATED", "CLOSED"])
    .optional()
    .describe(
      "Deliberate status transition. " +
        "ACTIVE = WATCHING → ACTIVE promotion (entry condition fired and you took the trade). MUST be paired with a place_trade in the same run, AND target_price + stop_loss must be supplied — recomputed relative to the actual entry, not copied from the WATCHING row's old levels. " +
        "INVALIDATED = the belief broke; we no longer believe the thesis. " +
        "CLOSED = we exited the position based on this thesis (target hit, stop, manual close). " +
        "For direction flips or completely new beliefs, use record_thesis with parent_thesis_id instead.",
    ),
});

type UpdatePatch = Partial<{
  reasoningSummary: string;
  thesisBullets: string[];
  riskFlags: string[];
  signalTypes: string[];
  coreBelief: string | null;
  keyAssumptions: string[];
  invalidationConds: string[];
  confidenceScore: number;
  targetPrice: number | null;
  stopLoss: number | null;
  targetSizePct: number | null;
  horizon: string | null;
  catalystDate: Date | null;
  maxHoldDays: number | null;
  nextReviewAt: Date | null;
  triggers: object;
  scalingPlan: object | null;
  status: string;
  invalidatedAt: Date;
  invalidReason: string;
  closedAt: Date;
  closeReason: string;
}>;

export const updateThesis = defineTool({
  description:
    "Update an existing thesis durably. Pass thesis_id + the fields you want to change + a rationale explaining why. Every call writes one row to the thesis activity log so the change is auditable. Use this — not record_thesis — when you're refining an existing belief (raising the target after good news, tightening the stop, swapping in fresh triggers, marking the thesis invalidated). Use record_thesis only when the thesis fundamentally changes (direction flip, completely new core belief). " +
    "Three hard-reject conditions to know about: " +
    "(1) zero-trigger guard — refuses updates on theses with no triggers unless the update adds triggers OR closes the thesis; " +
    "(2) goalpost-moving guard — refuses to raise targetPrice on a WATCHING thesis whose existing entry condition is currently met (price has crossed the old target — your job is to PROMOTE, not move the bar); " +
    "(3) structural-belief discipline gate — patches that change confidence_score / target_price / stop_loss WITHOUT also touching core_belief / key_assumptions / invalidation_conditions are rejected unless `structural_unchanged_reason` is supplied. Either update the belief to reflect why the trade plan is moving, or state explicitly why the belief is intact.",
  schema: updateSchema,
  ui: "thesis-card" as const,

  progressLabel: (args) => {
    if (args.change_status === "ACTIVE") return `Promoting thesis ${args.thesis_id.slice(-8)} → ACTIVE`;
    if (args.change_status === "INVALIDATED") return `Invalidating thesis ${args.thesis_id.slice(-8)}`;
    if (args.change_status === "CLOSED") return `Closing thesis ${args.thesis_id.slice(-8)}`;
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
        // direction + entryPrice are read by the shape gate below — adding
        // them to the select fixes a latent bug where existing.direction
        // and existing.entryPrice came back undefined at runtime.
        direction: true,
        entryPrice: true,
        researchRun: { select: { agentConfigId: true } },
        // Snapshot every field we might diff:
        reasoningSummary: true,
        thesisBullets: true,
        riskFlags: true,
        signalTypes: true,
        coreBelief: true,
        keyAssumptions: true,
        invalidationConds: true,
        confidenceScore: true,
        targetPrice: true,
        stopLoss: true,
        targetSizePct: true,
        horizon: true,
        catalystDate: true,
        maxHoldDays: true,
        nextReviewAt: true,
        triggers: true,
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

    if (existing.status !== "ACTIVE" && existing.status !== "WATCHING") {
      return {
        summary: `Thesis ${args.thesis_id} is ${existing.status}; can't update a terminal thesis.`,
        data: { ok: false, error: "terminal_status", current_status: existing.status },
        sources: [],
      };
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
    const isTerminalTransition =
      args.change_status === "INVALIDATED" ||
      args.change_status === "CLOSED";
    const existingTriggerCount = Array.isArray(existing.triggers)
      ? (existing.triggers as unknown[]).length
      : 0;
    const updateAddsTriggers =
      args.triggers !== undefined && args.triggers.length > 0;
    if (existingTriggerCount === 0 && !updateAddsTriggers && !isTerminalTransition) {
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
    // Bypass on ACTIVE promotion: the WATCHING target_price doubled as
    // the ENTER trigger level — promotion legitimately recomputes new
    // target/stop relative to the actual fill, so the new target being
    // > old target while price is ≥ old target is the EXPECTED shape
    // of a promotion, not goalpost-moving.
    if (
      args.change_status !== "ACTIVE" &&
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
            `${existing.ticker} is at $${resolvedPriceAtTime.toFixed(2)} and the existing target is $${existing.targetPrice.toFixed(2)}. The entry condition is MET — your action is to PROMOTE (record_thesis status=ACTIVE → place_trade), not raise the target to $${args.target_price.toFixed(2)} and walk away. If you genuinely think the setup has changed, document a concrete rejection reason in record_run_summary's decision_rationale (volume too low, regime change, fresh negative news, R/R no longer 2:1) and leave the target untouched. Or close the thesis with change_status: "INVALIDATED".`,
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
    const shapeCheckNeeded =
      (args.target_price !== undefined || args.stop_loss !== undefined) &&
      !isTerminalTransition &&
      (existing.direction === "LONG" || existing.direction === "SHORT");
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
      const effectiveEntry =
        existing.entryPrice != null ? Number(existing.entryPrice) : null;
      const shapeCheck = validateThesisShape({
        direction: existing.direction as "LONG" | "SHORT",
        entryPrice: effectiveEntry,
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
    if (args.reasoning_summary !== undefined)
      patch.reasoningSummary = args.reasoning_summary;
    if (args.thesis_bullets !== undefined)
      patch.thesisBullets = args.thesis_bullets;
    if (args.risk_flags !== undefined) patch.riskFlags = args.risk_flags;
    if (args.signal_types !== undefined) patch.signalTypes = args.signal_types;
    if (args.core_belief !== undefined) patch.coreBelief = args.core_belief;
    if (args.key_assumptions !== undefined)
      patch.keyAssumptions = args.key_assumptions;
    if (args.invalidation_conditions !== undefined)
      patch.invalidationConds = args.invalidation_conditions;
    if (args.confidence_score !== undefined)
      patch.confidenceScore = args.confidence_score;
    if (args.target_price !== undefined) patch.targetPrice = args.target_price;
    if (args.stop_loss !== undefined) patch.stopLoss = args.stop_loss;
    if (args.target_size_pct !== undefined)
      patch.targetSizePct = args.target_size_pct;
    if (args.horizon !== undefined) patch.horizon = args.horizon;
    if (args.catalyst_date !== undefined)
      patch.catalystDate = args.catalyst_date ? new Date(args.catalyst_date) : null;
    if (args.max_hold_days !== undefined) patch.maxHoldDays = args.max_hold_days;
    if (args.next_review_at !== undefined)
      patch.nextReviewAt = args.next_review_at
        ? new Date(args.next_review_at)
        : null;
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
      const incoming = args.triggers as Trigger[];
      const preserved = incoming.map((t) => {
        if (t.lastFiredAt != null) return t; // agent provided one — respect it
        const prior = t.id ? lastFiredById.get(t.id) : undefined;
        return prior ? { ...t, lastFiredAt: prior } : t;
      });
      patch.triggers = applyTriggerCooldownDefaults(preserved) as object;
    }
    if (args.scaling_plan !== undefined)
      patch.scalingPlan =
        args.scaling_plan === null ? null : (args.scaling_plan as object);

    // Status transitions get extra paperwork.
    let updateType: ThesisUpdateType = "UPDATED";
    if (args.change_status === "INVALIDATED") {
      patch.status = "INVALIDATED";
      patch.invalidatedAt = new Date();
      patch.invalidReason = args.rationale.slice(0, 500);
      updateType = "INVALIDATED";
    } else if (args.change_status === "CLOSED") {
      patch.status = "CLOSED";
      patch.closedAt = new Date();
      patch.closeReason = args.rationale.slice(0, 500);
      updateType = "CLOSED";
    } else if (args.change_status === "ACTIVE") {
      // ── WATCHING → ACTIVE promotion (close the promotion gap) ──────────
      // Pre-this-PR there was no first-class path: the tactical prompt
      // instructed `update_thesis(change_status: "ACTIVE")` but the enum
      // only allowed INVALIDATED/CLOSED, so the call rejected silently
      // and theses stayed WATCHING with open positions. Now legal.
      //
      // Two requirements at promotion:
      //   1. Source must be WATCHING — promoting an already-ACTIVE row
      //      makes no sense; promoting a terminal-state row is blocked
      //      upstream by the existing terminal_status guard.
      //   2. target_price + stop_loss MUST be supplied and recomputed
      //      relative to the actual entry. The WATCHING row's old
      //      target was the ENTER trigger level (the breakout
      //      threshold); price has now reached it, so as a take-profit
      //      it's behind the agent. Same for stop. Mint NEW values.
      if (existing.status !== "WATCHING") {
        return {
          summary: `Refused promotion on $${existing.ticker} — current status is ${existing.status}, not WATCHING.`,
          data: {
            ok: false,
            error: "promotion_from_non_watching",
            message:
              `change_status: "ACTIVE" is the WATCHING → ACTIVE promotion path. This thesis is already ${existing.status}; you can't promote what's already promoted (or terminal). ` +
              `If you meant to refine an open ACTIVE thesis, drop change_status and pass the fields you want to change directly. ` +
              `If you meant to re-open a CLOSED thesis, mint a new one via record_thesis.`,
          },
          sources: [],
        };
      }
      if (args.target_price == null || args.stop_loss == null) {
        return {
          summary: `Refused promotion on $${existing.ticker} — recomputed target_price and stop_loss required.`,
          data: {
            ok: false,
            error: "promotion_missing_levels",
            message:
              `Promoting WATCHING → ACTIVE requires fresh target_price AND stop_loss recomputed relative to the actual entry, not copied from the WATCHING row's old levels. ` +
              `The old target was the ENTER trigger threshold (price has now crossed it, so as a take-profit it's behind you). The old stop was set against an old reference entry that no longer applies. ` +
              `Pass new values: LONG → target_price > current price (R/R ≥ 2:1 vs new stop), stop_loss < current price. SHORT → mirror.`,
          },
          sources: [],
        };
      }
      patch.status = "ACTIVE";
      updateType = "STATUS_CHANGED";
    }

    // Empty patch (only rationale supplied)? That's a REVIEWED row, not
    // an UPDATED row. Useful when housekeeping looks at a thesis and
    // decides it's still right — we want a paper trail of "agent looked
    // here on this date" without polluting the diff log.
    //
    // Auto-bump nextReviewAt forward by the horizon's default cadence.
    // Without this, REVIEWED-only updates write the audit row but leave
    // the review clock stuck — the same thesis surfaces as needsAction
    // == REVIEW_DUE on every subsequent run forever. Bug observed
    // 2026-05-11: theses with nextReviewAt = 2026-05-02 still showing
    // "Review 9d overdue" the day after the agent reviewed them.
    const patchKeyCount = Object.keys(patch).length;
    if (patchKeyCount === 0) {
      const horizon =
        ((existing as { horizon: string | null }).horizon as Horizon | null) ??
        "TARGET";
      const cadenceDays = HORIZON_REVIEW_DAYS[horizon] ?? 7;
      const newNextReviewAt = new Date(
        Date.now() + cadenceDays * 86_400_000,
      );
      await prisma.thesis.update({
        where: { id: existing.id },
        data: { nextReviewAt: newNextReviewAt },
      });

      // Awaited (was void). Both the morning-research coverage gate and
      // the tactical-run close-out gate query ThesisUpdate immediately
      // after the agent finishes — fire-and-forget races caused false
      // FAILED on legitimate REVIEWED-only runs.
      await writeThesisUpdate({
        thesisId: existing.id,
        type: "REVIEWED",
        summary: `Reviewed ${existing.ticker} thesis — no changes (next review in ${cadenceDays}d)`,
        rationale: args.rationale,
        runId: ctx.runId,
        signalIds: args.signal_ids,
        triggerId: args.trigger_id,
        priceAtTime: resolvedPriceAtTime,
      });
      return {
        summary: `Reviewed ${existing.ticker} thesis: no changes (next review in ${cadenceDays}d).`,
        data: {
          ok: true,
          thesis_id: existing.id,
          type: "REVIEWED" as const,
          card: thesisToCardData({
            ...existing,
            nextReviewAt: newNextReviewAt,
          }),
        },
        sources: [],
      };
    }

    // Compute the diff BEFORE applying so the field-changes payload reflects
    // only what actually moved.
    const diffFields = [
      "reasoningSummary",
      "thesisBullets",
      "riskFlags",
      "signalTypes",
      "coreBelief",
      "keyAssumptions",
      "invalidationConds",
      "confidenceScore",
      "targetPrice",
      "stopLoss",
      "targetSizePct",
      "horizon",
      "catalystDate",
      "maxHoldDays",
      "nextReviewAt",
      "triggers",
      "scalingPlan",
      "status",
    ] as const;
    const prevSnapshot = Object.fromEntries(
      diffFields.map((f) => [f, (existing as Record<string, unknown>)[f]]),
    );
    const nextSnapshot: Record<string, unknown> = { ...prevSnapshot };
    for (const [k, v] of Object.entries(patch)) {
      if (k in nextSnapshot) nextSnapshot[k] = v;
    }
    const fieldChanges = diffThesisFields(prevSnapshot, nextSnapshot, [
      ...diffFields,
    ]);

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
    const touchesQuant = !!(
      fieldChanges.confidenceScore ||
      fieldChanges.targetPrice ||
      fieldChanges.stopLoss
    );
    const touchesBelief = !!(
      fieldChanges.coreBelief ||
      fieldChanges.keyAssumptions ||
      fieldChanges.invalidationConds
    );
    const hasUnchangedReason =
      typeof args.structural_unchanged_reason === "string" &&
      args.structural_unchanged_reason.trim().length >= 10;
    // The gate bypasses on ANY deliberate state transition (terminal +
    // ACTIVE promotion). For terminal: belief is frozen by definition.
    // For promotion: the act of putting capital behind the WATCHING
    // belief is its own implicit justification — the agent isn't moving
    // goalposts on an open trade, they're acting on the existing thesis.
    const isStateTransition =
      isTerminalTransition || args.change_status === "ACTIVE";
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
    await prisma.thesis.update({
      where: { id: existing.id },
      data: patch as object,
    });

    // ── Symmetric watchlist sync ──────────────────────────────────────
    // PR 203 added the manage_watchlist → Thesis sync (ADD mints WATCHING
    // thesis; REMOVE supersedes thesis). The reverse path was missing:
    // when the agent invalidates or closes a WATCHING-anchored thesis via
    // update_thesis, the AnalystWatchlistItem row was left ACTIVE — the
    // agent's "this thesis is dead" decision didn't propagate to the
    // legacy watchlist table. Captured the 2026-05-04 ASML / Tech
    // Momentum drift case. Bridge fix; the watchlist table is being
    // collapsed in the next phase, after which Thesis.status='WATCHING'
    // IS the watchlist and this whole class of two-store bugs is gone.
    const wasWatching = existing.status === "WATCHING";
    const flippedToTerminal =
      args.change_status === "INVALIDATED" ||
      args.change_status === "CLOSED";
    const ownerAnalystId = existing.researchRun?.agentConfigId;
    if (wasWatching && flippedToTerminal && ownerAnalystId) {
      try {
        await prisma.analystWatchlistItem.updateMany({
          where: {
            analystId: ownerAnalystId,
            symbol: existing.ticker,
            status: "ACTIVE",
          },
          data: {
            status: "REMOVED",
            removedAt: new Date(),
            removeReason: `thesis ${args.change_status?.toLowerCase()}: ${args.rationale.slice(0, 200)}`,
          },
        });
      } catch (err) {
        // Non-fatal — the thesis state is the source of truth post-collapse;
        // the watchlist table is the legacy mirror. Drift is preferable to
        // a failed update_thesis call here.
        console.warn(
          `[update_thesis] watchlist sync failed for thesis=${existing.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

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
    if (fieldChanges.confidenceScore) {
      summaryParts.push(
        `confidence ${fieldChanges.confidenceScore.from} → ${fieldChanges.confidenceScore.to}`,
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
      fieldChanges.reasoningSummary ||
      fieldChanges.thesisBullets ||
      fieldChanges.invalidationConds ||
      fieldChanges.keyAssumptions
    ) {
      summaryParts.push("rationale updated");
    }
    const summary =
      summaryParts.length > 0
        ? `Updated ${existing.ticker}: ${summaryParts.join(", ")}`
        : `Updated ${existing.ticker} thesis`;

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
  direction: "LONG" | "SHORT" | "PASS";
  confidence_score: number;
  reasoning_summary: string;
  thesis_bullets: string[];
  risk_flags: string[];
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  hold_duration?: string;
  signal_types: string[];
  status: "ACTIVE" | "WATCHING" | "INVALIDATED" | "CLOSED" | "SUPERSEDED";
} {
  return {
    thesis_id: t.id as string,
    ticker: t.ticker as string,
    direction: t.direction as "LONG" | "SHORT" | "PASS",
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
    hold_duration: (t.holdDuration as string) ?? undefined,
    signal_types: (t.signalTypes as string[]) ?? [],
    status: (t.status as
      | "ACTIVE"
      | "WATCHING"
      | "INVALIDATED"
      | "CLOSED"
      | "SUPERSEDED") ?? "ACTIVE",
  };
}

function fmtNum(v: unknown): string {
  if (typeof v === "number") return v.toFixed(2);
  if (v == null) return "—";
  return String(v);
}
