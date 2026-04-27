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
import {
  writeThesisUpdate,
  diffThesisFields,
  type ThesisUpdateType,
} from "@/lib/agent/thesis-updates";

const updateSchema = z.object({
  thesis_id: z.string().describe("Thesis id to update."),
  rationale: z
    .string()
    .min(10)
    .describe(
      "Why you're updating this thesis. Required — every update writes a timeline row and the rationale is what the user (or future you) reads to understand the change.",
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
  core_belief: z.string().optional(),
  reasoning_summary: z
    .string()
    .optional()
    .describe(
      "Updated 2-3 sentence trade rationale. Often diverges from core_belief over time as the rationale shifts even if the underlying belief holds.",
    ),
  thesis_bullets: z.array(z.string()).optional(),
  risk_flags: z.array(z.string()).optional(),
  key_assumptions: z.array(z.string()).optional(),
  invalidation_conditions: z.array(z.string()).optional(),
  signal_types: z.array(z.string()).optional(),

  confidence_score: z.number().int().min(0).max(100).optional(),
  target_price: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  target_size_pct: z.number().min(0).max(100).optional(),

  horizon: z
    .enum(["CATALYST", "TARGET", "TRADE", "COMPOUNDER"])
    .optional()
    .describe(
      "Rarely changed — flipping horizon means the analyst's exit policy changed, which is usually a sign the thesis itself should be replaced via record_thesis instead.",
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
    .enum(["INVALIDATED", "CLOSED"])
    .optional()
    .describe(
      "Deliberate status transition. INVALIDATED = we no longer believe the thesis. CLOSED = we exited the position based on this thesis (target hit, stop, or manual close). For PASS-by-pivot or replacement, use record_thesis with parent_thesis_id instead.",
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
    "Update an existing thesis durably. Pass thesis_id + the fields you want to change + a rationale explaining why. Every call writes one row to the thesis activity log so the change is auditable. Use this — not record_thesis — when you're refining an existing belief (raising the target after good news, tightening the stop, swapping in fresh triggers, marking the thesis invalidated). Use record_thesis only when the thesis fundamentally changes (direction flip, completely new core belief).",
  schema: updateSchema,
  ui: "tool-ui" as const,

  progressLabel: (args) => {
    if (args.change_status === "INVALIDATED") return `Invalidating thesis ${args.thesis_id.slice(-8)}`;
    if (args.change_status === "CLOSED") return `Closing thesis ${args.thesis_id.slice(-8)}`;
    return `Updating thesis ${args.thesis_id.slice(-8)}`;
  },

  execute: async (args, ctx) => {
    // Load + scope check. A thesis must belong to an analyst's user;
    // updating someone else's thesis would be a security hole.
    const existing = await prisma.thesis.findUnique({
      where: { id: args.thesis_id },
      select: {
        id: true,
        userId: true,
        ticker: true,
        status: true,
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
    if (args.triggers !== undefined) patch.triggers = args.triggers as object;
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
    }

    // Empty patch (only rationale supplied)? That's a REVIEWED row, not
    // an UPDATED row. Useful when housekeeping looks at a thesis and
    // decides it's still right — we want a paper trail of "agent looked
    // here on this date" without polluting the diff log.
    const patchKeyCount = Object.keys(patch).length;
    if (patchKeyCount === 0) {
      void writeThesisUpdate({
        thesisId: existing.id,
        type: "REVIEWED",
        summary: `Reviewed ${existing.ticker} thesis — no changes`,
        rationale: args.rationale,
        runId: ctx.runId,
        signalIds: args.signal_ids,
        triggerId: args.trigger_id,
        priceAtTime: args.price_at_time ?? null,
      });
      return {
        summary: `Reviewed ${existing.ticker} thesis: no changes.`,
        data: { ok: true, thesis_id: existing.id, type: "REVIEWED" as const },
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

    // Apply.
    await prisma.thesis.update({
      where: { id: existing.id },
      data: patch as object,
    });

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

    void writeThesisUpdate({
      thesisId: existing.id,
      type: updateType,
      summary,
      rationale: args.rationale,
      fieldChanges,
      runId: ctx.runId,
      signalIds: args.signal_ids,
      triggerId: args.trigger_id,
      tradeId: args.trade_id,
      priceAtTime: args.price_at_time ?? null,
    });

    return {
      summary,
      data: {
        ok: true,
        thesis_id: existing.id,
        type: updateType,
        changed_fields: Object.keys(fieldChanges),
      },
      sources: [],
    };
  },
});

function fmtNum(v: unknown): string {
  if (typeof v === "number") return v.toFixed(2);
  if (v == null) return "—";
  return String(v);
}
