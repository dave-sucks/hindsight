/**
 * get_theses — read the analyst's durable thesis library with optional
 * activity history.
 *
 * Replaces the ad-hoc Thesis lookups scattered across other tools.
 * Tactical mode wants ONE thesis (by ticker or id) with its recent
 * activity. Housekeeping wants ALL HOLDING + WATCHING theses with light
 * history. Discovery wants the catalog of WATCHING-status candidates.
 *
 * Filters compose AND-style:
 *   - status:    one or more ThesisStatus values
 *   - tickers:   restrict to these tickers
 *   - ids:       restrict to these thesis ids
 *   - horizon:   one or more horizon kinds
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
import { triggerForAgent } from "@/lib/agent/triggers/format";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { computeNeedsAction } from "@/lib/agent/needs-action";
import { getDailyRangePcts } from "@/lib/alpaca";
import { readPrice } from "@/lib/market-data/quote-age";
import { derivedNextReviewAt } from "@/lib/agent/triggers/defaults";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { NeedsAction } from "@/lib/agent/needs-action";
import { listsTheStock, situationsTap, type SituationSources } from "@/lib/agent/situations";
import { loadWorkInputs } from "@/lib/agent/work-inputs";
import type { StockContext } from "@/lib/agent/stock-context";
import { stockContextFor } from "@/lib/agent/stock-context-for";
import {
  buildResolvedEnvelope,
  buildSupersessionMap,
  type ResolvedEnvelope,
} from "@/lib/agent/resolved-thesis";
import { entryRaisesAway, type EntryRaiseAway } from "@/lib/agent/entry-raises";
import { setupChecklist, nameTheSetup } from "@/lib/agent/knowledge/setup-checklist";
import { buyBlockedByFull, isFull, type AnalystCapacity, type BuyBlockedByFull } from "@/lib/agent/capacity";
import { spentBuyCrossing, type SpentBuyCrossing } from "@/lib/agent/buy-crossing";
import { getSetup } from "@/lib/agent/knowledge/setups";
import { loadSetupOverrides } from "@/lib/agent/knowledge/load-setup-overrides";
import { soldReview, RECENTLY_SOLD_WINDOW_DAYS, type SoldReview } from "@/lib/agent/sold-review";
import {
  getThesisBearCaseBullets,
  getThesisBullCaseBullets,
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";
import { classifyResearchAge } from "@/lib/agent/thesis-research/staleness";
import type { Horizon } from "@/lib/agent/horizon-policy";

const STATUS_VALUES = [
  "HOLDING",
  "WATCHING",
  "PROMOTED",
  // RETIRED is the collapsed terminal (carries retiredReason SOLD /
  // INVALIDATED / REPLACED / DROPPED). PASSED = researched-and-declined.
  // Both queryable so the agent can pull terminal/declined names as
  // institutional memory.
  "RETIRED",
  "PASSED",
] as const;

const HORIZONS = ["CATALYST", "TARGET", "TRADE", "COMPOUNDER"] as const;

const schema = z.object({
  status: z
    .array(z.enum(STATUS_VALUES))
    .optional()
    .describe(
      "Filter by status. Default = the live coverage book (HOLDING + WATCHING + PROMOTED). Pass explicitly to include RETIRED/PASSED for historical lookups (RETIRED = terminal, carries retiredReason SOLD/INVALIDATED/REPLACED/DROPPED; PASSED = researched-and-declined names).",
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
  include_history: z
    .boolean()
    .optional()
    .describe(
      "The raw activity log, returned for a read of named stocks (tickers or ids). Each full row's `context` already sums up what's been said since your last answer.",
    ),
  include_research: z
    .boolean()
    .optional()
    .describe(
      "Also return the lower-priority deep-research sections (researchData, recentCatalysts, fundamentals, latestEarnings, catalystsAndEvents, analystConsensus, insiderTechnical). The snapshot and the bull and bear cases are already on every row.",
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
  detail: z
    .enum(["actionable", "book"])
    .optional()
    .describe(
      "Row weight. \"actionable\": full rows only for stocks with work today, the rest as one-line entries in `quiet_theses`. \"book\": full rows for everything. Default: \"actionable\" on the Daily Run's unfiltered read, \"book\" everywhere else and whenever you filter by ticker or id.",
    ),
});

export const getTheses = defineTool({
  description:
    "Read this analyst's durable thesis library. Default returns HOLDING + WATCHING + PROMOTED theses (the live coverage book); each row carries the snapshot and the bull and bear cases, and says when that research was written and at what price. The raw activity log comes back when you read named stocks (tickers or ids). On the Daily Run's unfiltered read, rows arrive at two weights: theses with work to do (non-null needsAction, or PROMOTED) come back FULL in `theses`; quiet rows come back as one-line index entries in `quiet_theses` — each carrying the live price next to its entry/target/stop, so a plan the price has left behind is visible at a glance (drill down on any of them with tickers:[\"X\"] for the full row). Filter by ticker/id/status/horizon as needed. Set include_research=true to also pull the lower-priority sections (recentCatalysts, fundamentals, latestEarnings, catalystsAndEvents, analystConsensus, insiderTechnical, researchData).",
  schema,
  ui: "thesis-card" as const,
  // The cards are the "Read theses" carousel: the same rows again in the
  // renderer's shape, with the research text a second time. 14–26% of the
  // read in the recorded cases, re-sent on every later step. The screen
  // keeps them; the model reads the rows.
  //
  // The raw history comes back only on a read of named stocks: 29% of the
  // morning read on 2026-10-02, and the row's `context` already sums it up.
  // The writer's research text stays on every full row: a run left to ask
  // for it never did (now-needs-research, 0/12 with and without a line
  // saying how). Each row also says when its research was written and at
  // what price.
  forModel: (result, input) => {
    if (!result.ok) return result;
    const data = result.data as Record<string, unknown> | undefined;
    if (!data) return result;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cards, ...rest } = data;
    const named = !!((input?.tickers?.length ?? 0) > 0 || (input?.ids?.length ?? 0) > 0);
    if (!Array.isArray(rest.theses)) return { ...result, data: rest };
    const theses = (rest.theses as Array<Record<string, unknown>>).map((row) => rowForModel(row, named));
    return {
      ...result,
      data: {
        ...rest,
        theses,
        ...(!named && input?.include_history
          ? { historyNote: "The raw activity log comes back on a read of named stocks: get_theses(tickers: [\"X\"], include_history: true). Each row's `context` already sums up what's been said." }
          : {}),
      },
    };
  },

  progressLabel: (args) => {
    if (args.tickers && args.tickers.length === 1) {
      return `Reading thesis on $${args.tickers[0].toUpperCase()}`;
    }
    if (args.ids && args.ids.length === 1) {
      return `Reading thesis ${args.ids[0].slice(-8)}`;
    }
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
    const statuses = (args.status ?? ["HOLDING", "WATCHING", "PROMOTED"]).map((s) =>
      s.toString(),
    );
    const limit = Math.min(args.limit ?? 25, 50);
    const histLimit = Math.min(args.history_limit ?? 5, 50);

    // ── Row weight (2026-08-13 morning-cost fix) ────────────────────────
    // The trigger-gated daily-run design (THESIS_GAME_PLAN / MORNING_RUN_V2)
    // says only fired/due theses get reviewed — but this tool was shipping
    // the FULL book (narrative excerpts + triggers + resolved envelope,
    // ~4k tokens/thesis) on the morning run's opening read, and that
    // payload rode in the model's context for every subsequent step.
    // Measured 2026-08-13: 21 theses → ~91k tokens in one tool result →
    // ~820k of a 1.03M-token run. Under "actionable" detail, quiet rows
    // (needsAction=null, non-PROMOTED) collapse to one-line index entries.
    // Any explicit scope (ticker/id/status/horizon filter, history or
    // research includes) is a deliberate drill-down and stays full-weight,
    // as does every non-MORNING_PLAN caller.
    // A ticker/id-targeted read is ALWAYS a full-detail drill-down, even if
    // the caller (or a model copying its earlier args) also passes
    // detail:"actionable" — otherwise the drill-down the prompt recommends
    // could never reach the full row (review finding #4).
    const explicitTarget = !!(
      (args.tickers && args.tickers.length > 0) ||
      (args.ids && args.ids.length > 0)
    );
    // History and research come back only on a read of named stocks, so
    // asking for them on the whole book is not a reason to send every row
    // full: 27 of 40 morning opening reads in September did exactly that,
    // because this tool's own description invited it, and each read ran
    // 180,000-330,000 characters (docs/plans/AGENT_ARCHITECTURE.md, 2.3).
    const explicitScope =
      explicitTarget ||
      !!(
        (args.status && args.status.length > 0) ||
        (args.horizon && args.horizon.length > 0)
      );
    const detailMode: "actionable" | "book" = explicitTarget
      ? "book"
      : args.detail ??
        (ctx.runMode === "MORNING_PLAN" && !explicitScope ? "actionable" : "book");
    // Set when the live-quote fetch throws — forces full-book detail so a
    // data outage can't hide actionable rows behind the quiet split.
    let priceFetchFailed = false;
    // When each live price printed — so the result can say how old it is.
    const priceAsOf: Record<string, string> = {};

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
        triggers: true,
        // Fire bookkeeping for inherited rungs — resolveThesisLadder
        // overlays it so cooldown reads the same at every level.
        triggerState: true,
        catalystDate: true,
        lastReviewedAt: true,
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
        setupId: true,
        // The analyst's own setups are what a row with none may choose from
        // (DAV-285, DAV-280) — read off the row, not a second query.
        researchRun: { select: { agentConfig: { select: { setupIds: true } } } },
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
    if (args.include_history && explicitTarget && theses.length > 0) {
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

    // The price when the research was written: the writer's latest save on
    // each stock. The research text and the score are as old as that visit
    // (SYK on 2026-10-02: written at $348, the stock at $273, 51 days on), so
    // the row says so next to them.
    const researchPriceByThesis = new Map<string, number>();
    if (theses.length > 0) {
      const writerSaves = await prisma.thesisUpdate.findMany({
        where: { thesisId: { in: theses.map((t) => t.id) }, priceAtTime: { not: null }, run: { mode: "THESIS_WRITER" } },
        orderBy: { timestamp: "desc" },
        distinct: ["thesisId"],
        select: { thesisId: true, priceAtTime: true },
      });
      for (const u of writerSaves) if (u.priceAtTime != null) researchPriceByThesis.set(u.thesisId, u.priceAtTime);
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
        t.status === "HOLDING" ||
        t.status === "WATCHING" ||
        t.status === "PROMOTED",
    );

    // ── What the work flag reads, loaded once (lib/agent/work-inputs.ts) ──
    // The live price, the resolved ladder (own triggers plus what the stock
    // inherits — a holding protected by an inherited floor must not read as
    // unprotected), the open position, the chart numbers, the activity back
    // to the newest answer, the declined sale and the account's equity. The
    // sheet and complete_run read the same loader, so the flag is the same
    // everywhere. The rest of this read takes its numbers from here.
    const load = await loadWorkInputs(
      theses.map((t) => t.id),
      { userId: ctx.userId, analystId: ctx.analystId, runEnvironment: ctx.runEnvironment, alpacaCreds: ctx.alpacaCreds },
    );
    const livePrice = load.livePrice;
    Object.assign(priceAsOf, load.priceAsOf);
    if (load.priceFetchFailed) priceFetchFailed = true;
    const ladderByThesisId = load.ladders;
    const work = (id: string) => load.inputs.get(id)?.thesis;

    // The work-flag list per live stock (lead first) and what's been said on
    // it (stock-context.ts): the block a full row carries, its open fires,
    // and any decision of the principal's no run has answered yet.
    const needsActionByThesisId = new Map<string, NeedsAction | null>();
    const needsListByThesisId = new Map<string, NeedsAction[]>();
    const contextByThesisId = new Map<string, StockContext>();
    for (const t of liveTheses) {
      const input = load.inputs.get(t.id);
      if (!input) continue;
      contextByThesisId.set(
        t.id,
        stockContextFor({ ticker: t.ticker, rows: input.activity ?? [], triggers: input.thesis.triggers, now: input.now, currentPrice: input.latestQuote?.price ?? null }),
      );
      const needs = computeNeedsAction(input);
      needsListByThesisId.set(t.id, needs);
      needsActionByThesisId.set(t.id, needs[0] ?? null);
    }

    // The buy level's moves away from the price, no structure cited
    // (DAV-253, the MSFT shape) — off the ladder-edit rows the loader read.
    const entryRaisesByThesisId = new Map<string, EntryRaiseAway[]>();
    for (const t of theses) {
      if (t.status !== "WATCHING") continue;
      const rows = load.ladderEditRows.get(t.id);
      if (!rows?.length) continue;
      const raises = entryRaisesAway({ direction: t.direction, updates: rows, now: new Date() });
      if (raises.length) entryRaisesByThesisId.set(t.id, raises);
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
          // P1-24: every terminal/declined sibling is caught by STATUS now.
          // PASSED = researched-declined (was direction='PASS'); RETIRED =
          // the collapsed terminal (incl. passed-then-terminal). The legacy
          // INVALIDATED/ARCHIVED/CLOSED values stay for dual-read until the
          // contract PR. The old `{ direction: "PASS" }` OR-clause is gone —
          // a pass now stores direction=null, so it would catch nothing; the
          // PASSED/RETIRED status entries cover both pass shapes.
          status: {
            in: ["RETIRED", "PASSED"],
          },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, ticker: true, createdAt: true },
      });
      supersessionByTicker = buildSupersessionMap(terminalSiblings);
    }

    // ── Resolver: compute the per-row resolved envelope ──────────────
    // Reuses the live-price map already fetched for needsAction above.
    // Synchronous + cheap once the upstream queries are done.
    const resolverPriceMap: Record<string, number> = livePrice;
    // Daily ranges for the plan-sanity noise check (DAV-188): one batched
    // snapshot call, only for WATCHING rows that actually carry a stop +
    // entry to compare. Fail-open — absence just skips that one check.
    const rangeTickers = Array.from(
      new Set(
        theses
          .filter(
            (t) =>
              t.status === "WATCHING" &&
              (t.direction === "LONG" || t.direction === "SHORT") &&
              t.stopLoss != null &&
              t.entryPrice != null,
          )
          .map((t) => t.ticker.toUpperCase()),
      ),
    );
    let dayRangePctByTicker: Record<string, number> = {};
    if (rangeTickers.length > 0) {
      try {
        dayRangePctByTicker = await getDailyRangePcts(
          rangeTickers,
          ctx.alpacaCreds,
        );
      } catch {
        /* fail-open — noise check silently skipped */
      }
    }

    const tickerFiltered = !!(args.tickers && args.tickers.length > 0);
    const heldTickers = theses.filter((t) => t.status === "HOLDING").map((t) => t.ticker);
    // Counted the way place_trade counts: held PLUS awaiting approval, which
    // have already taken their slot. Fail-soft to the held count.
    const queuedBuys =
      !tickerFiltered && ctx.maxOpenPositions != null && ctx.analystId
        ? await (async () => {
            try {
              return await prisma.position.count({
                where: { analystId: ctx.analystId, status: "PENDING_APPROVAL" },
              });
            } catch {
              return 0;
            }
          })()
        : 0;
    const capacity: AnalystCapacity | null =
      !tickerFiltered && ctx.maxOpenPositions != null
        ? {
            open: heldTickers.length + queuedBuys,
            max: ctx.maxOpenPositions,
            held: heldTickers,
            awaitingApproval: queuedBuys,
          }
        : null;
    const setupOverrides = await loadSetupOverrides(ctx.accountId);

    // ── A fired buy the price has left behind (DAV-303) ─────────────────
    // Read off the audit rows already loaded for the ladder-edit scan — no
    // extra query. Suppressed while the analyst is full: `buyBlockedByFull`
    // owns the row on those days, and "re-anchor to today's price" is not a
    // question worth asking a seat that cannot buy anything.
    const resolverNow = new Date();
    const spentCrossingByThesisId = new Map<string, SpentBuyCrossing>();
    if (!isFull(capacity)) {
      for (const t of theses) {
        if (t.status !== "WATCHING") continue;
        // The stock's OWN buy trigger, parsed — its predicate decides both
        // the level and which way the price has to move to have left it
        // behind (a LONG pullback buy is price-below). An inherited analyst
        // or account rule is not this stock's buy plan.
        const enter =
          (ladderByThesisId.get(t.id) ?? []).find(
            (x) => x.action === "ENTER" && ((x as { level?: string }).level ?? "THESIS") === "THESIS",
          ) ?? null;
        const cur = resolverPriceMap[t.ticker];
        const crossing = spentBuyCrossing({
          status: t.status,
          direction: t.direction,
          currentPrice: typeof cur === "number" && cur > 0 ? cur : null,
          enter: enter ? { predicate: enter.predicate, lastFiredAt: enter.lastFiredAt ?? null } : null,
          chaseLimitPct: t.setupId
            ? (getSetup(t.setupId, setupOverrides)?.entry.chaseLimitPct ?? null)
            : null,
          updates: load.ladderEditRows.get(t.id) ?? [],
          now: resolverNow,
        });
        if (crossing) spentCrossingByThesisId.set(t.id, crossing);
      }
    }

    const resolvedByThesisId = new Map<string, ResolvedEnvelope>();
    for (const t of theses) {
      const parsedTriggers = ladderByThesisId.get(t.id) ?? [];
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
            targetPrice: t.targetPrice ?? null,
            stopLoss: t.stopLoss ?? null,
            dayRangePct: dayRangePctByTicker[t.ticker.toUpperCase()] ?? null,
            atr14: work(t.id)?.atr14 ?? null,
            avgCost: work(t.id)?.avgCost ?? null,
            quantity: work(t.id)?.quantity ?? null,
            equity: load.equity,
            structure: work(t.id)?.structure ?? null,
            peakPrice: work(t.id)?.peakPrice ?? null,
            lastLadderEditAt: load.lastLadderEditAt.get(t.id) ?? null,
            entryRaisesAway: entryRaisesByThesisId.get(t.id) ?? null,
            spentBuyCrossing: spentCrossingByThesisId.get(t.id) ?? null,
            triggers: t.triggers,
            catalystDate: t.catalystDate,
            setupId: t.setupId ?? null,
            horizon: t.horizon ?? null,
            createdAt: t.createdAt,
            scoring: t.scoring,
            minConfidence: ctx.minConfidence ?? null,
            parsedTriggers,
            positionOpenedAt: work(t.id)?.positionOpenedAt ?? null,
          },
          currentPrice: typeof cur === "number" && cur > 0 ? cur : null,
          priceAsOf: priceAsOf[t.ticker] ?? null,
          supersession: supersessionByTicker.get(t.ticker) ?? null,
          now: resolverNow,
        }),
      );
    }

    // ── A buy that fired into a full analyst (DAV-286) ──────────────────
    // Off the `capacity` counted above — no extra query. Skipped on a
    // ticker-filtered read, where the held list is partial.
    const blockedByThesisId = new Map<string, BuyBlockedByFull>();
    for (const t of theses) {
      const own = Array.isArray(t.triggers) ? (t.triggers as unknown as Array<{ action?: string; lastFiredAt?: string }>) : [];
      const na = needsActionByThesisId.get(t.id) ?? null;
      const blocked = buyBlockedByFull(
        {
          ticker: t.ticker,
          status: t.status,
          enterLastFiredAt: own.find((x) => x.action === "ENTER")?.lastFiredAt ?? null,
          enterLiveNow: na?.kind === "TRIGGER_MATCHING_NOW" && na.action === "ENTER",
        },
        capacity,
        new Date(),
      );
      if (blocked) blockedByThesisId.set(t.id, blocked);
    }

    // Actionable-detail split: full rows for the work list, one-line index
    // entries for the quiet rest; "book" mode, and prices that failed to
    // load, keep everything full. Which stocks are work is
    // lib/agent/situations.ts `listsTheStock`, read off what the read
    // already computed.
    const sourcesFor = (t: (typeof theses)[number]): SituationSources => {
      const r = resolvedByThesisId.get(t.id);
      return {
        needs: needsListByThesisId.get(t.id) ?? [],
        triggers: ladderByThesisId.get(t.id) ?? [],
        status: t.status,
        direction: t.direction,
        planSanity: r?.planSanity ?? null,
        actionability: r?.actionability ?? null,
        progressToTarget: r?.progressToTarget ?? null,
        buyBlockedByFull: blockedByThesisId.has(t.id),
        nameTheSetup: nameTheSetup(t, t.researchRun?.agentConfig?.setupIds ?? null) !== null,
        unansweredDecision: contextByThesisId.get(t.id)?.unansweredDecision != null,
      };
    };
    const listedIds = new Set<string>();
    for (const t of theses) {
      const sources = sourcesFor(t);
      if (listsTheStock(sources)) listedIds.add(t.id);
      situationsTap.record?.({ thesisId: t.id, ticker: t.ticker, needsInput: load.inputs.get(t.id) ?? null, sources });
    }
    const isFullDetail = (t: (typeof theses)[number]): boolean =>
      detailMode === "book" || priceFetchFailed || listedIds.has(t.id);

    const fullTheses = theses.filter((t) => isFullDetail(t));
    const quietTheses = theses.filter((t) => !isFullDetail(t));

    // Compact index row — the roster line for a thesis nothing fired on.
    // Enough to reason about exposure and to decide whether to drill down
    // (get_theses(tickers: ["X"]) returns the full row), nothing more.
    const quietRows = quietTheses.map((t) => ({
      id: t.id,
      ticker: t.ticker,
      status: t.status,
      direction: t.direction,
      horizon: t.horizon,
      conviction: t.conviction ?? null,
      composite: getThesisComposite(t),
      coreBelief: t.coreBelief,
      entryPrice: t.entryPrice,
      targetPrice: t.targetPrice,
      stopLoss: t.stopLoss,
      // The live price belongs NEXT TO the plan numbers, even on a quiet
      // row. Without it the roster line reads "buy at $262 · waiting for
      // trigger" on a stock trading at $184 — plan numbers with nothing to
      // judge them against, which is how KLAC/SNPS/NTNX sat mis-priced for
      // months (2026-08-23 audit). One number per row; the resolver already
      // fetched it, so this costs a fetch of nothing.
      currentPrice: resolvedByThesisId.get(t.id)?.currentPrice ?? null,
      // Derived, not stored (DAV-221): last actual look + the cadence on
      // the resolved ladder. Null = no scheduled review (soft watch).
      reviewDueAt: derivedNextReviewAt({
        status: t.status,
        lastReviewedAt: t.lastReviewedAt,
        createdAt: t.createdAt,
        triggers: ladderByThesisId.get(t.id) ?? [],
        horizon: t.horizon,
      }),
      catalystDate: t.catalystDate,
      // Resolved ladder, not the stored column — a thesis protected
      // entirely by inherited rungs is not a zero-trigger thesis.
      triggerCount: (ladderByThesisId.get(t.id) ?? []).length,
      researchAge: classifyResearchAge(
        t.researchUpdatedAt,
        t.horizon as Horizon | null,
        t.status,
      ),
      resolvedActionability: resolvedByThesisId.get(t.id)?.actionability ?? null,
      needsAction: null,
      // The principal's newest note, one line (docs/plans/AGENT_CONTEXT.md §3.2).
      ...(contextByThesisId.get(t.id)?.principalNote ? { principalNote: contextByThesisId.get(t.id)!.principalNote } : {}),
    }));

    const enriched = fullTheses.map((t) => {
      // Resolved ladder, not the stored column — see quietRows above.
      const triggerCount = (ladderByThesisId.get(t.id) ?? []).length;
      return {
        // What's been said on the stock, first — the principal's decisions,
        // the last two answers, the fires no agent has answered. Read before
        // the numbers (docs/plans/AGENT_CONTEXT.md §3.2). Null when nothing
        // has been said in the lines this read reached.
        context: contextByThesisId.get(t.id)?.text ?? null,
        ...t,
        // The stock's own triggers, each as its sentence and id.
        triggers: (Array.isArray(t.triggers) ? (t.triggers as Trigger[]) : []).map((x) => triggerForAgent(x, t.status === "HOLDING")),
        triggerCount,
        history: historyByThesis.get(t.id) ?? [],
        needsAction: needsActionByThesisId.get(t.id) ?? null,
        // Conviction Expression v4 — read-time resolved envelope. The
        // agent reads `resolved.actionability` first to filter actionable
        // rows; `triggerDetail` shows trigger state vs current price;
        // `supersededBy` flags rows killed by a newer sister thesis.
        resolved: resolvedByThesisId.get(t.id) ?? null,
        // The setup the plan was written on, compact (DAV-253): a held
        // name's review runs its setup's checklist — failure signs, the
        // horizon's manage rule, the time limit — instead of the horizon
        // glossary. Null on rows written before setups were named.
        setup: setupChecklist(t.setupId, t.horizon, setupOverrides),
        // No setup named yet (DAV-285): the ask and the seat's choices, so
        // the next review names one instead of never.
        nameTheSetup: nameTheSetup(t, t.researchRun?.agentConfig?.setupIds ?? null, setupOverrides),
        // Its buy fired (or is live) and the analyst is full: the portfolio
        // decision, on the row (DAV-286). Null otherwise.
        buyBlockedByFull: blockedByThesisId.get(t.id)?.text ?? null,
        researchRun: undefined,
        // Agent must see freshness of the deep research without doing date
        // math. Horizon-tuned per STALE_DAYS_BY_HORIZON. Soft input to the
        // agent's REVIEW decision — no Layer-1 gate keys off it.
        researchAge: classifyResearchAge(
          t.researchUpdatedAt,
          t.horizon as Horizon | null,
          t.status,
        ),
        // P1-28 (L2): unapproved close proposals on this held position (Order
        // ledger) — rejected by the user OR ignored to expiry. >0 means "you
        // proposed this exit and the user declined N×" — don't re-propose
        // unless the thesis materially changed. 0 for non-HOLDING rows.
        unapprovedExitCount: load.unapprovedExitCount.get(t.id) ?? 0,
        researchPriceThen: researchPriceByThesis.get(t.id) ?? null,
        // P1-39 (principal ruling 2026-08-16): held-through-floor CONTEXT —
        // recent protective (STOP) declines in the last 7d + the principal's
        // verbatim reject message + the recent low (lowest low since the last
        // ladder edit; recent HIGH for SHORT). Informational only: use it to
        // enrich the daily exit-proposal rationale ("3rd day under your $860
        // floor; recent low $842; suggest $840 if you want the line moved").
        // NEVER a license to edit the floor — protective levels ratchet one
        // way (agents may raise, never lower); moving a line down is the
        // principal's manual act. null when no recent protective declines.
        heldThroughFloor: (() => {
          const ht = load.declines.get(t.id);
          if (!ht) return null;
          // Only surface while the breach is LIVE — price still on the losing
          // side of the ladder's tightest protective floor. Once price
          // recovers above the line, the floor held and the held-through
          // framing is false; the next breach is a fresh, meaningful ask.
          // Reuses the resolver's already-computed floor + live price (no
          // second fetch). Can't prove the breach (no floor rung, or quotes
          // degraded) → omit rather than assert something unverified.
          const r = resolvedByThesisId.get(t.id);
          const floorPrice = r?.ladderHealth?.floor?.price ?? null;
          const price = r?.currentPrice ?? null;
          if (floorPrice == null || price == null || price <= 0) return null;
          const stillBreached =
            t.direction === "SHORT" ? price >= floorPrice : price <= floorPrice;
          if (!stillBreached) return null;
          return {
            floorPrice,
            heldThroughCount: ht.declineCount,
            rejectMessage: ht.rejectMessage,
            recentLow: load.recentLow.get(t.id) ?? null,
          };
        })(),
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
        // P1-24: LONG | SHORT | null (null = unresearched seed; a pass stores
        // direction=null and is identified by status=PASSED).
        direction: t.direction as "LONG" | "SHORT" | null,
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
          | "HOLDING"
          | "WATCHING"
          | "PROMOTED"
          // RETIRED = terminal (retiredReason); PASSED = researched-declined
          // (a pass stores direction=null; status is the pass signal).
          | "RETIRED"
          | "PASSED",
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

    // ── The one look a sold stock gets (DAV-240) ────────────────────────
    // A sale joins this run's work list once, with its own facts, and the run
    // answers with the verbs it already has: keep watching with a re-entry
    // level, keep watching on a cadence, keep watching with nothing, or let it
    // go. Its own small query — a sold row is not part of the live book, and
    // pulling RETIRED rows into the main read would drag every one of them
    // through the resolver, the quote fetch and needsAction. Skipped on a
    // ticker-filtered drill-down and for callers that asked for an explicit
    // status scope. Fail-soft: the book still returns if this throws.
    const soldToReview: Array<{ thesis_id: string; ticker: string; sold_on: string; days_ago: number; ask: string }> = [];
    if (!tickerFiltered && !(args.status && args.status.length > 0) && ctx.analystId) {
      try {
        const since = new Date(resolverNow.getTime() - RECENTLY_SOLD_WINDOW_DAYS * 86_400_000);
        const soldRows = await prisma.thesis.findMany({
          where: {
            userId: ctx.userId,
            status: "RETIRED",
            retiredReason: "SOLD",
            closedAt: { gte: since },
            researchRun: { agentConfigId: ctx.analystId },
          },
          orderBy: { closedAt: "desc" },
          take: 20,
          select: {
            id: true,
            ticker: true,
            closedAt: true,
            closeReason: true,
            catalystDate: true,
            updates: {
              where: { type: { in: ["UPDATED", "REVIEWED", "STATUS_CHANGED"] } },
              orderBy: { timestamp: "desc" },
              take: 1,
              select: { timestamp: true },
            },
          },
        });
        const soldPositions = soldRows.length
          ? await prisma.position.findMany({
              where: {
                analystId: ctx.analystId,
                symbol: { in: soldRows.map((r) => r.ticker) },
                status: "CLOSED",
                closedAt: { gte: since },
              },
              orderBy: { closedAt: "desc" },
              select: {
                symbol: true,
                closePrice: true,
                realizedPnl: true,
                avgCost: true,
                quantity: true,
                // The attestation lives on the closing Order, not the
                // Position — LIVE closes are approval-gated, so the agent
                // attests when it proposes.
                orders: {
                  where: { intent: "CLOSE", status: "FILLED" },
                  orderBy: { filledAt: "desc" },
                  take: 1,
                  select: { closeBeliefSurvived: true },
                },
              },
            })
          : [];
        const posBySymbol = new Map(soldPositions.map((p) => [p.symbol, p]));
        for (const r of soldRows) {
          const pos = posBySymbol.get(r.ticker);
          const cost = pos ? Number(pos.avgCost) * Number(pos.quantity) : 0;
          const realized = pos?.realizedPnl != null ? Number(pos.realizedPnl) : null;
          const review: SoldReview | null = soldReview({
            ticker: r.ticker,
            status: "RETIRED",
            retiredReason: "SOLD",
            closedAt: r.closedAt,
            closeReason: r.closeReason,
            exitPrice: pos?.closePrice != null ? Number(pos.closePrice) : null,
            realizedPnl: realized,
            realizedPnlPct: realized != null && cost > 0 ? (realized / cost) * 100 : null,
            beliefSurvived: pos?.orders?.[0]?.closeBeliefSurvived ?? null,
            catalystDate: r.catalystDate,
            // The close's own bookkeeping lands in the same second as the
            // close; only a row written AFTER it is an answer.
            answered: !!(
              r.updates[0] &&
              r.closedAt &&
              r.updates[0].timestamp.getTime() > r.closedAt.getTime() + 5_000
            ),
            now: resolverNow,
          });
          if (review) {
            soldToReview.push({
              thesis_id: r.id,
              ticker: r.ticker,
              sold_on: review.soldOn,
              days_ago: review.daysAgo,
              ask: review.text,
            });
          }
        }
      } catch (err) {
        console.warn("[get_theses] sold-review scan failed; the book still returns:", err);
      }
    }

    const activeCount = theses.filter(
      (t) => t.status === "HOLDING",
    ).length;
    const watchingCount = theses.filter(
      (t) => t.status === "WATCHING",
    ).length;
    const promotedCount = theses.filter(
      (t) => t.status === "PROMOTED",
    ).length;
    const summary =
      theses.length === 0
        ? "No theses match those filters."
        : `${theses.length} thes${theses.length === 1 ? "is" : "es"} (${activeCount} active, ${watchingCount} watching${promotedCount > 0 ? `, ${promotedCount} promoted` : ""})${
            quietRows.length > 0
              ? ` — ${enriched.length} actionable in full, ${quietRows.length} quiet as index rows`
              : ""
          }.`;
    // A price that is missing or old is said in words (lib/market-data/
    // quote-age) — it used to come back as a blank or as if it were live.
    const priceWarnings = Array.from(new Set(liveTheses.map((t) => t.ticker)))
      .map((ticker) => {
        const price = resolverPriceMap[ticker];
        const at = priceAsOf[ticker];
        return readPrice({
          ticker,
          quote: typeof price === "number" && price > 0 ? { c: price, t: at ? new Date(at).getTime() / 1000 : undefined } : null,
          now: resolverNow,
        }).warning;
      })
      .filter((w): w is string => w != null);
    const summaryWithSold =
      (priceWarnings.length > 0 ? `⚠ ${priceWarnings.join(" ")} ` : "") +
      (soldToReview.length > 0
        ? `${summary} ${soldToReview.length} recently sold stock${soldToReview.length === 1 ? "" : "s"} (${soldToReview.map((x) => `$${x.ticker}`).join(", ")}) still need${soldToReview.length === 1 ? "s" : ""} a keep-watching-or-let-it-go decision.`
        : summary);

    return {
      summary: summaryWithSold,
      data: {
        ...(priceWarnings.length > 0 ? { priceWarnings } : {}),
        count: theses.length,
        active: activeCount,
        watching: watchingCount,
        // Full rows: the work list (needsAction non-null / PROMOTED), or
        // the whole book under detail="book".
        theses: enriched,
        // One-line roster entries for quiet rows (actionable mode only —
        // empty array under "book"). Drill down on any of them with
        // get_theses(tickers: ["X"]).
        quiet_theses: quietRows,
        ...(quietRows.length > 0
          ? {
              note:
                `${quietRows.length} quiet thes${quietRows.length === 1 ? "is" : "es"} returned as index rows (nothing fired, no review due — the trigger system already evaluated them). ` +
                `They need no touch this run. To read one in full: get_theses(tickers: ["<TICKER>"]).`,
            }
          : {}),
        // Stocks sold in the last two weeks that no run has answered for
        // yet (DAV-240). One look each, then they clear.
        ...(soldToReview.length > 0 ? { sold_to_review: soldToReview } : {}),
        // ThesisCardData[] for ThesisCardRenderer — drives the
        // "Read theses" carousel in the chat (full-detail rows only).
        cards,
      },
      sources: [],
    };
  },
});

/** Fields on a live row that only ever carry bookkeeping or a state the row cannot be in. */
const NOT_FOR_THE_MODEL = ["sourceSignalIds", "sourceKind", "parentThesisId", "invalidatedAt", "invalidReason", "closedAt", "closeReason", "promotedAt", "paperTenureDays", "paperRealizedPnl", "paperReviewCount"];

/**
 * One full row as the model reads it (see forModel above). The screen and a
 * saved run keep the whole row.
 */
export function rowForModel(row: Record<string, unknown>, named: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  // The evaluator's fire bookkeeping for inherited triggers; the run reads
  // what fired from needsAction and context.
  delete out.triggerState;
  for (const k of NOT_FOR_THE_MODEL) {
    const v = out[k];
    if (v == null || (Array.isArray(v) && v.length === 0) || v === 0) delete out[k];
  }
  const written = typeof row.researchUpdatedAt === "string" ? row.researchUpdatedAt.slice(0, 10) : row.researchUpdatedAt instanceof Date ? row.researchUpdatedAt.toISOString().slice(0, 10) : null;
  const price = typeof row.researchPriceThen === "number" ? row.researchPriceThen : null;
  const age = (row.researchAge as { daysOld?: number | null } | undefined)?.daysOld;
  out.research = written
    ? `Written ${written}${price != null ? ` at $${price}` : ""}${age != null ? `, ${age} days ago` : ""}.`
    : "No research written yet.";
  delete out.researchPriceThen;
  delete out.researchUpdatedAt;
  if (!named) delete out.history;
  return out;
}
