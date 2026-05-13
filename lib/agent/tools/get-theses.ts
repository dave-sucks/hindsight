/**
 * get_theses — read the analyst's durable thesis library with optional
 * activity history.
 *
 * Replaces the ad-hoc Thesis lookups scattered across other tools.
 * Tactical mode wants ONE thesis (by ticker or id) with its recent
 * activity. Housekeeping wants ALL ACTIVE + WATCHING theses with light
 * history. Discovery wants the catalog of WATCHING-status candidates.
 *
 * Filters compose AND-style:
 *   - status:    one or more ThesisStatus values
 *   - tickers:   restrict to these tickers
 *   - ids:       restrict to these thesis ids
 *   - horizon:   one or more horizon kinds
 *   - watching_review_due_only: when true, return only WATCHING theses
 *                whose nextReviewAt has passed (housekeeping signal)
 *
 * Pagination: capped hard at 50 theses per call. The agent doesn't need
 * to see hundreds; if the analyst has that many open theses something is
 * wrong upstream.
 *
 * History: opt-in via include_history. When true, returns the most recent
 * N ThesisUpdate rows per thesis (newest first). Default N = 5; raise via
 * history_limit if you need more context.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { computeNeedsAction } from "@/lib/agent/needs-action";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import { getLatestPrices } from "@/lib/alpaca";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { NeedsAction } from "@/lib/agent/needs-action";

const STATUS_VALUES = [
  "ACTIVE",
  "WATCHING",
  "PROMOTED",
  "INVALIDATED",
  "CLOSED",
  "ARCHIVED",
  "SUPERSEDED",
] as const;

const HORIZONS = ["CATALYST", "TARGET", "TRADE", "COMPOUNDER"] as const;

const schema = z.object({
  status: z
    .array(z.enum(STATUS_VALUES))
    .optional()
    .describe(
      "Filter by status. Default = ['ACTIVE', 'WATCHING'] (the live coverage book). Pass explicitly to include INVALIDATED/CLOSED/SUPERSEDED for historical lookups.",
    ),
  tickers: z
    .array(z.string())
    .optional()
    .describe("Restrict to these tickers (case-insensitive)."),
  ids: z
    .array(z.string())
    .optional()
    .describe("Restrict to these thesis ids."),
  horizon: z
    .array(z.enum(HORIZONS))
    .optional()
    .describe("Restrict to these horizon kinds."),
  watching_review_due_only: z
    .boolean()
    .optional()
    .describe(
      "When true, return only WATCHING theses whose nextReviewAt has passed. Used by housekeeping to find watch items needing attention.",
    ),
  include_history: z
    .boolean()
    .optional()
    .describe(
      "Include recent ThesisUpdate rows per thesis. Default false. Set true for tactical mode and per-thesis review.",
    ),
  history_limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max ThesisUpdate rows per thesis when include_history is true. Default 5."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max theses to return. Default 25, hard cap 50."),
});

export const getTheses = defineTool({
  description:
    "Read this analyst's durable thesis library. Default returns ACTIVE + WATCHING theses (the live coverage book). Filter by ticker/id/status/horizon as needed. Set include_history=true to get the recent activity log per thesis — use this in tactical mode (one ticker, full history) and during housekeeping (walk every thesis).",
  schema,
  ui: "thesis-card" as const,

  progressLabel: (args) => {
    if (args.tickers && args.tickers.length === 1) {
      return `Reading thesis on $${args.tickers[0].toUpperCase()}`;
    }
    if (args.ids && args.ids.length === 1) {
      return `Reading thesis ${args.ids[0].slice(-8)}`;
    }
    if (args.watching_review_due_only) return "Watching: items due for review";
    return "Reading thesis library";
  },

  execute: async (args, ctx) => {
    if (!ctx.analystId && !ctx.userId) {
      return {
        summary: "No analyst context — cannot read theses.",
        data: { count: 0, theses: [] },
        sources: [],
      };
    }

    // Default scope is the live coverage book = the rows the closeout
    // contract expects a tool call on this run: ACTIVE (held) + WATCHING
    // (waiting for entry trigger) + PROMOTED (waiting for first-live-run
    // decision). All three need to surface by default; the agent has to
    // resolve every PROMOTED row this run or fail the closeout gate.
    const statuses = (args.status ?? ["ACTIVE", "WATCHING", "PROMOTED"]).map((s) =>
      s.toString(),
    );
    const limit = Math.min(args.limit ?? 25, 50);
    const histLimit = Math.min(args.history_limit ?? 5, 50);

    // Scope by analyst when present (the right thing for normal calls);
    // fall back to userId scope for any builder/editor or system call
    // path that lacks analystId. Never return cross-user theses.
    const where: object = {
      userId: ctx.userId,
      status: { in: statuses },
      ...(ctx.analystId
        ? { researchRun: { agentConfigId: ctx.analystId } }
        : {}),
      ...(args.tickers && args.tickers.length > 0
        ? {
            ticker: {
              in: args.tickers.map((t) => t.toUpperCase()),
              mode: "insensitive" as const,
            },
          }
        : {}),
      ...(args.ids && args.ids.length > 0 ? { id: { in: args.ids } } : {}),
      ...(args.horizon && args.horizon.length > 0
        ? { horizon: { in: args.horizon } }
        : {}),
      ...(args.watching_review_due_only
        ? {
            status: "WATCHING",
            nextReviewAt: { lte: new Date() },
          }
        : {}),
    };

    const theses = await prisma.thesis.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        ticker: true,
        direction: true,
        status: true,
        horizon: true,
        confidenceScore: true,
        coreBelief: true,
        reasoningSummary: true,
        thesisBullets: true,
        riskFlags: true,
        keyAssumptions: true,
        invalidationConds: true,
        entryPrice: true,
        targetPrice: true,
        stopLoss: true,
        targetSizePct: true,
        triggers: true,
        scalingPlan: true,
        catalystDate: true,
        maxHoldDays: true,
        nextReviewAt: true,
        sourceSignalIds: true,
        sourceKind: true,
        createdAt: true,
        updatedAt: true,
        invalidatedAt: true,
        invalidReason: true,
        closedAt: true,
        closeReason: true,
        parentThesisId: true,
        promotedAt: true,
        paperTenureDays: true,
        paperRealizedPnl: true,
        paperReviewCount: true,
      },
    });

    // History: one batched query, grouped per thesis on return. Avoids the
    // N+1 we'd get from a per-thesis findMany, even at limit=50.
    let historyByThesis = new Map<string, unknown[]>();
    if (args.include_history && theses.length > 0) {
      const allHistory = await prisma.thesisUpdate.findMany({
        where: { thesisId: { in: theses.map((t) => t.id) } },
        orderBy: { timestamp: "desc" },
        // Pull histLimit * count to be safe; we'll trim per thesis below.
        // The composite index on (thesisId, timestamp DESC) keeps this cheap.
        take: histLimit * theses.length,
        select: {
          id: true,
          thesisId: true,
          timestamp: true,
          type: true,
          summary: true,
          rationale: true,
          fieldChanges: true,
          priceAtTime: true,
          positionAtTime: true,
          triggerId: true,
          signalIds: true,
          runId: true,
          tradeId: true,
        },
      });
      historyByThesis = new Map();
      for (const t of theses) historyByThesis.set(t.id, []);
      for (const h of allHistory) {
        const arr = historyByThesis.get(h.thesisId);
        if (arr && arr.length < histLimit) arr.push(h);
      }
    }

    // ── needsAction (Fix #2) ───────────────────────────────────────────
    // For every ACTIVE/WATCHING thesis row in this response, compute the
    // per-thesis needsAction annotation: TRIGGER_FIRED / TRIGGER_MATCHING_NOW
    // / REVIEW_DUE / null. The agent reads this field to decide which
    // theses need touching today; nulls don't need attention.
    //
    // Two batched dependencies:
    //   1. Most-recent ThesisUpdate per thesis — drives TRIGGER_FIRED
    //      (an unanswered fire is one whose row is still on top of the
    //      activity log).
    //   2. Live quote per unique ticker — drives TRIGGER_MATCHING_NOW
    //      via shouldFire on price-side predicates. Fetched only when
    //      we have at least one ACTIVE/WATCHING row to evaluate; quote
    //      failures degrade gracefully (matching-now skipped, the
    //      cron's 5-min path still catches it later).
    //
    // Terminal-status theses (INVALIDATED/CLOSED/SUPERSEDED) skip the
    // computation — needsAction stays null there.
    const liveTheses = theses.filter(
      (t) => t.status === "ACTIVE" || t.status === "WATCHING",
    );
    const needsActionByThesisId = new Map<string, NeedsAction | null>();

    if (liveTheses.length > 0) {
      // Latest ThesisUpdate per thesis — one batched query.
      const latestUpdates = await prisma.thesisUpdate.findMany({
        where: { thesisId: { in: liveTheses.map((t) => t.id) } },
        orderBy: { timestamp: "desc" },
        distinct: ["thesisId"],
        select: {
          thesisId: true,
          type: true,
          triggerId: true,
          timestamp: true,
        },
      });
      const latestByThesisId = new Map(
        latestUpdates.map((u) => [u.thesisId, u]),
      );

      // Live quotes — one Alpaca call per unique ticker.
      const uniqueTickers = Array.from(
        new Set(liveTheses.map((t) => t.ticker)),
      );
      let priceByTicker: Record<string, number> = {};
      try {
        priceByTicker = await getLatestPrices(uniqueTickers, ctx.alpacaCreds);
      } catch (err) {
        console.warn(
          "[get_theses] live quote fetch failed; matching-now skipped:",
          err,
        );
      }

      const now = new Date();
      for (const t of liveTheses) {
        const parsed = triggersArraySchema.safeParse(t.triggers);
        const triggers: Trigger[] = parsed.success
          ? (parsed.data as Trigger[])
          : [];
        const price = priceByTicker[t.ticker];
        const latestQuote =
          typeof price === "number" && price > 0
            ? { price, changePct: 0 }
            : null;
        needsActionByThesisId.set(
          t.id,
          computeNeedsAction({
            thesis: {
              id: t.id,
              direction: t.direction,
              triggers,
              createdAt: t.createdAt,
              nextReviewAt: t.nextReviewAt,
            },
            latestUpdate: latestByThesisId.get(t.id) ?? null,
            latestQuote,
            now,
          }),
        );
      }
    }

    const enriched = theses.map((t) => {
      const triggerCount = Array.isArray(t.triggers)
        ? (t.triggers as unknown[]).length
        : 0;
      return {
        ...t,
        triggerCount,
        history: historyByThesis.get(t.id) ?? [],
        needsAction: needsActionByThesisId.get(t.id) ?? null,
      };
    });

    // Build ThesisCardData[] for the renderer — one card per thesis the
    // agent read. Same shape as record_thesis / update_thesis returns so
    // ThesisCardRenderer can fold them into the "Read theses" carousel.
    const cards = enriched.map((t) => ({
      thesis_id: t.id,
      ticker: t.ticker,
      direction: t.direction as "LONG" | "SHORT" | "PASS" | "PENDING",
      confidence_score: t.confidenceScore,
      reasoning_summary: t.reasoningSummary,
      thesis_bullets: t.thesisBullets ?? [],
      risk_flags: t.riskFlags ?? [],
      entry_price: t.entryPrice ?? null,
      target_price: t.targetPrice ?? null,
      stop_loss: t.stopLoss ?? null,
      hold_duration: undefined,
      signal_types: [],
      company_name: null,
      exchange: null,
      fundamentals: null,
      status: t.status as
        | "ACTIVE"
        | "WATCHING"
        | "PROMOTED"
        | "INVALIDATED"
        | "CLOSED"
        | "SUPERSEDED",
      // PROMOTED-only context fields. Null on non-PROMOTED rows.
      promoted_at: t.promotedAt ? t.promotedAt.toISOString() : null,
      paper_tenure_days: t.paperTenureDays ?? null,
      paper_realized_pnl: t.paperRealizedPnl ?? null,
      paper_review_count: t.paperReviewCount ?? null,
      // Surface the per-thesis needsAction annotation so the
      // ThesisCardRenderer / read-theses-table can show an alert chip
      // on rows that need work today.
      needs_action: t.needsAction ?? null,
    }));

    const activeCount = enriched.filter((t) => t.status === "ACTIVE").length;
    const watchingCount = enriched.filter(
      (t) => t.status === "WATCHING",
    ).length;
    const promotedCount = enriched.filter(
      (t) => t.status === "PROMOTED",
    ).length;
    const summary =
      enriched.length === 0
        ? "No theses match those filters."
        : `${enriched.length} thes${enriched.length === 1 ? "is" : "es"} (${activeCount} active, ${watchingCount} watching${promotedCount > 0 ? `, ${promotedCount} promoted awaiting live entry` : ""}).`;

    return {
      summary,
      data: {
        count: enriched.length,
        active: activeCount,
        watching: watchingCount,
        theses: enriched,
        // ThesisCardData[] for ThesisCardRenderer — drives the
        // "Read theses" carousel in the chat.
        cards,
      },
      sources: [],
    };
  },
});
