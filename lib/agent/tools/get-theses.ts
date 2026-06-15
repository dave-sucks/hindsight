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
import { getPendingEntryTickers } from "@/lib/proposals/pending-entry";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import { getLatestPrices } from "@/lib/alpaca";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { NeedsAction } from "@/lib/agent/needs-action";
import {
  buildResolvedEnvelope,
  buildSupersessionMap,
  type ResolvedEnvelope,
} from "@/lib/agent/resolved-thesis";
import {
  getThesisBearCaseBullets,
  getThesisBullCaseBullets,
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";
import { classifyResearchAge } from "@/lib/agent/thesis-research/staleness";
import type { Horizon } from "@/lib/agent/horizon-policy";

const STATUS_VALUES = [
  "ACTIVE",
  "WATCHING",
  "PROMOTED",
  "INVALIDATED",
  "CLOSED",
  "ARCHIVED",
  "SUPERSEDED",
  // PASS theses now store status='PASSED' (was 'ARCHIVED'). Queryable so
  // the agent can pull declined names as institutional memory.
  "PASSED",
] as const;

const HORIZONS = ["CATALYST", "TARGET", "TRADE", "COMPOUNDER"] as const;

const schema = z.object({
  status: z
    .array(z.enum(STATUS_VALUES))
    .optional()
    .describe(
      "Filter by status. Default = ['ACTIVE', 'WATCHING'] (the live coverage book). Pass explicitly to include INVALIDATED/CLOSED/SUPERSEDED/PASSED for historical lookups (PASSED = researched-and-declined names).",
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
  include_research: z
    .boolean()
    .optional()
    .describe(
      "Include the LOWER-PRIORITY deep-research sections (researchData + recentCatalysts + fundamentals + latestEarnings + catalystsAndEvents + analystConsensus + insiderTechnical) per thesis. Default false. Note that snapshot + bullCase + bearCase are ALREADY in the default response (they're the three sections agents need most), as is `researchAge` (the freshness annotation). Set this true only when refreshing a thesis (thesis-writer mode) or when the agent specifically needs the full multi-section synthesis to grade against.",
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
    "Read this analyst's durable thesis library. Default returns ACTIVE + WATCHING + PROMOTED theses (the live coverage book) with snapshot + bullCase + bearCase deep-research excerpts and a `researchAge` annotation (freshness: \"fresh\" | \"stale\" | \"missing\" + daysOld). Filter by ticker/id/status/horizon as needed. Set include_history=true to get the recent activity log per thesis — use this in tactical mode (one ticker, full history) and during housekeeping (walk every thesis). Set include_research=true to also pull the lower-priority sections (recentCatalysts, fundamentals, latestEarnings, catalystsAndEvents, analystConsensus, insiderTechnical, researchData).",
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

    // Default select skips the heavy deep-research blobs (`researchData`
    // ~3-5KB + `researchSections`). The agent opts in with
    // `include_research: true` when refreshing a thesis via the
    // thesis-writer agent, or when the synthesis is needed for grading.
    // Daily-run and tactical reads stay light by default.
    const includeResearch = args.include_research === true;
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
        coreBelief: true,
        // PR-9 flat schema: legacy plain-string narrative columns replaced
        // by JSONB sections (snapshot / bullCase / bearCase). The agent-
        // facing shape below extracts plain strings via helpers so prompts
        // and tactical-agent context keep working.
        snapshot: true,
        bullCase: true,
        bearCase: true,
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
        // 4-dim composite scoring + composite total. `composite` is the
        // single conviction number (PR-9 dropped the parallel
        // `confidenceScore` int).
        scoring: true,
        // Conviction Expression v4 — writer-side fields (read into the
        // agent's context + the resolver's actionability decision tree).
        conviction: true,
        convictionRationale: true,
        variantView: true,
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
        // `researchUpdatedAt` is ALWAYS selected (cheap timestamp column)
        // so every response can carry the computed `researchAge` field
        // for the agent. Daily-run and tactical prompts read it to decide
        // whether to dispatch a refresh before trading (Phase 2). The
        // heavy section blobs below stay gated.
        researchUpdatedAt: true,
        // Deep-research artifacts — opt in via include_research. PR-9
        // flattened `researchSections` blob into 9 first-class columns;
        // selecting all of them by name. snapshot/bullCase/bearCase are
        // already in the default select above (used by the helpers for
        // narrative extraction); the six below are the lower-priority
        // sections that only thesis-writer and the thesis sheet need.
        ...(includeResearch
          ? {
              researchData: true,
              recentCatalysts: true,
              fundamentals: true,
              latestEarnings: true,
              catalystsAndEvents: true,
              analystConsensus: true,
              insiderTechnical: true,
            }
          : {}),
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
    // PROMOTED is included so it gets the PROMOTED_AWAITING_RESOLUTION
    // signal that tells the daily-run agent to resolve it this run.
    const liveTheses = theses.filter(
      (t) =>
        t.status === "ACTIVE" ||
        t.status === "WATCHING" ||
        t.status === "PROMOTED",
    );
    const needsActionByThesisId = new Map<string, NeedsAction | null>();

    // ── Position openedAt per ACTIVE thesis (P1-14) ─────────────────────
    // TIME_ELAPSED on a HELD thesis measures "max hold N days" from when the
    // position opened, not the (possibly older) thesis row. Resolve the open
    // Position per ACTIVE (ticker) once; shared by both the needsAction and
    // resolver loops below. WATCHING/PROMOTED rows keep their createdAt clock
    // and aren't looked up. Scoped by analyst (+ environment when known) so a
    // LIVE run never reads a PAPER position's open time and vice versa.
    const positionOpenedAtByThesisId = new Map<string, Date>();
    const activeTickersForOpenedAt = Array.from(
      new Set(
        theses
          .filter((t: { status: string }) => t.status === "ACTIVE")
          .map((t: { ticker: string }) => t.ticker),
      ),
    );
    if (activeTickersForOpenedAt.length > 0) {
      try {
        const openPositions = await prisma.position.findMany({
          where: {
            userId: ctx.userId,
            symbol: { in: activeTickersForOpenedAt },
            status: "OPEN",
            ...(ctx.analystId ? { analystId: ctx.analystId } : {}),
            ...(ctx.runEnvironment ? { environment: ctx.runEnvironment } : {}),
          },
          select: { symbol: true, openedAt: true },
          orderBy: { openedAt: "desc" },
        });
        const openedAtByTicker = new Map<string, Date>();
        for (const p of openPositions) {
          if (!openedAtByTicker.has(p.symbol)) {
            openedAtByTicker.set(p.symbol, p.openedAt);
          }
        }
        for (const t of theses) {
          if (t.status !== "ACTIVE") continue;
          const openedAt = openedAtByTicker.get(t.ticker);
          if (openedAt) positionOpenedAtByThesisId.set(t.id, openedAt);
        }
      } catch (err) {
        console.warn(
          "[get_theses] open-position openedAt lookup failed; TIME_ELAPSED falls back to createdAt:",
          err,
        );
      }
    }

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
      const pendingEntryTickers = ctx.analystId
        ? await getPendingEntryTickers(ctx.analystId)
        : new Set<string>();
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
              status: t.status,
              triggers,
              createdAt: t.createdAt,
              nextReviewAt: t.nextReviewAt,
              positionOpenedAt: positionOpenedAtByThesisId.get(t.id) ?? null,
              paperTenureDays: t.paperTenureDays ?? null,
              paperRealizedPnl:
                t.paperRealizedPnl != null
                  ? Number(t.paperRealizedPnl)
                  : null,
              paperReviewCount: t.paperReviewCount ?? null,
              promotedAt: t.promotedAt ?? null,
            },
            latestUpdate: latestByThesisId.get(t.id) ?? null,
            latestQuote,
            now,
            hasPendingEntryProposal: pendingEntryTickers.has(t.ticker),
          }),
        );
      }
    }

    // ── Conviction Expression v4: supersession lookup (§6) ───────────
    // For each ticker present in the response, find the newest terminal
    // (INVALIDATED / ARCHIVED / CLOSED) or PASS row on the same analyst.
    // Used by the resolver to flag older live rows as SUPERSEDED when a
    // newer sister thesis killed them (tonight's two-ZS case).
    const uniqueTickersAll = Array.from(new Set(theses.map((t) => t.ticker)));
    let supersessionByTicker = new Map<
      string,
      ReturnType<typeof buildSupersessionMap> extends Map<string, infer V> ? V : never
    >();
    if (uniqueTickersAll.length > 0) {
      const terminalSiblings = await prisma.thesis.findMany({
        where: {
          userId: ctx.userId,
          ticker: { in: uniqueTickersAll },
          ...(ctx.analystId
            ? { researchRun: { agentConfigId: ctx.analystId } }
            : {}),
          OR: [
            { status: { in: ["INVALIDATED", "ARCHIVED", "CLOSED"] } },
            { direction: "PASS" },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, ticker: true, createdAt: true },
      });
      supersessionByTicker = buildSupersessionMap(terminalSiblings);
    }

    // ── Resolver: compute the per-row resolved envelope ──────────────
    // Reuses the live-price map already fetched for needsAction above.
    // Synchronous + cheap once the upstream queries are done.
    const resolverPriceMap: Record<string, number> = {};
    if (liveTheses.length > 0) {
      // Reuse the price lookups from the needsAction block. Repeat the
      // fetch here only if liveTheses was empty (i.e. no needsAction
      // computation ran) but theses still need resolution.
      const tickers = Array.from(new Set(liveTheses.map((t) => t.ticker)));
      try {
        const prices = await getLatestPrices(tickers, ctx.alpacaCreds);
        Object.assign(resolverPriceMap, prices);
      } catch {
        /* degraded gracefully; envelope renders with currentPrice=null */
      }
    }
    const resolverNow = new Date();
    const resolvedByThesisId = new Map<string, ResolvedEnvelope>();
    for (const t of theses) {
      const parsed = triggersArraySchema.safeParse(t.triggers);
      const parsedTriggers = (parsed.success ? parsed.data : []) as Trigger[];
      const cur = resolverPriceMap[t.ticker];
      resolvedByThesisId.set(
        t.id,
        buildResolvedEnvelope({
          thesis: {
            id: t.id,
            ticker: t.ticker,
            status: t.status,
            direction: t.direction,
            entryPrice: t.entryPrice,
            triggers: t.triggers,
            catalystDate: t.catalystDate,
            createdAt: t.createdAt,
            nextReviewAt: t.nextReviewAt,
            scoring: t.scoring,
            parsedTriggers,
            positionOpenedAt: positionOpenedAtByThesisId.get(t.id) ?? null,
          },
          currentPrice: typeof cur === "number" && cur > 0 ? cur : null,
          supersession: supersessionByTicker.get(t.ticker) ?? null,
          now: resolverNow,
        }),
      );
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
        // Conviction Expression v4 — read-time resolved envelope. The
        // agent reads `resolved.actionability` first to filter actionable
        // rows; `triggerDetail` shows trigger state vs current price;
        // `supersededBy` flags rows killed by a newer sister thesis.
        resolved: resolvedByThesisId.get(t.id) ?? null,
        // Agent must see freshness of the deep research without doing date
        // math. Horizon-tuned per STALE_DAYS_BY_HORIZON. Soft input to the
        // agent's REVIEW decision — no Layer-1 gate keys off it.
        researchAge: classifyResearchAge(
          t.researchUpdatedAt,
          t.horizon as Horizon | null,
        ),
      };
    });

    // Build ThesisCardData[] for the renderer — one card per thesis the
    // agent read. Same shape as record_thesis / update_thesis returns so
    // ThesisCardRenderer can fold them into the "Read theses" carousel.
    const cards = enriched.map((t) => {
      // PR-9: legacy 0-100 confidence → composite × 10 for the renderer
      // which still consumes the 0-100 shape. Narrative columns extracted
      // via helpers; bullCase/bearCase materialized as plain string[].
      const composite = getThesisComposite(t);
      return {
        thesis_id: t.id,
        ticker: t.ticker,
        direction: t.direction as "LONG" | "SHORT" | "PASS" | "PENDING",
        confidence_score: composite != null ? composite * 10 : 0,
        reasoning_summary: getThesisSnapshotText(t),
        thesis_bullets: getThesisBullCaseBullets(t),
        risk_flags: getThesisBearCaseBullets(t),
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
        // Phase 1 read-side fix: research-age annotation for prompt
        // rendering + future Phase-2 staleness gate. Snake-case on the
        // card surface to match other agent-facing fields.
        research_age: t.researchAge,
      };
    });

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
        : `${enriched.length} thes${enriched.length === 1 ? "is" : "es"} (${activeCount} active, ${watchingCount} watching${promotedCount > 0 ? `, ${promotedCount} promoted` : ""}).`;

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
