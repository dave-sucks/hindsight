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
import { getStockQuote } from "@/lib/actions/finnhub.actions";

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
  ui: "thesis-card" as const,

  progressLabel: (args) => {
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
          card: thesisToCardData(existing),
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
    await writeThesisUpdate({
      thesisId: existing.id,
      type: updateType,
      summary,
      rationale: args.rationale,
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
