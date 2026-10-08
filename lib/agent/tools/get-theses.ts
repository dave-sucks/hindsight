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
import { readPrice } from "@/lib/market-data/quote-age";
import { chartFacts } from "@/lib/market-data/indicator-snapshot";
import { derivedNextReviewAt } from "@/lib/agent/triggers/defaults";
import type { Trigger } from "@/lib/agent/triggers/types";
import { guidanceCodes, guidanceFor, listsTheStock, situationsFor, situationsTap, type SituationCode } from "@/lib/agent/situations";
import { loadStockFacts, type StockFacts } from "@/lib/agent/stock-facts";
import { setupChecklist, nameTheSetup } from "@/lib/agent/knowledge/setup-checklist";
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
    "Read this analyst's durable thesis library. Default returns HOLDING + WATCHING + PROMOTED theses (the live coverage book); each row carries the snapshot and the bull and bear cases, and says when that research was written and at what price. The raw activity log comes back when you read named stocks (tickers or ids). On the Daily Run's unfiltered read, rows arrive at two weights: theses with work to do (non-null needsAction, or PROMOTED) come back FULL in `theses`; `needsAction` is a row's lead, `situations` lists every situation the stock is in, and `guidance` says once per read what each situation asks and what answers it; quiet rows come back as one-line index entries in `quiet_theses` — each carrying the live price next to its entry/target/stop, so a plan the price has left behind is visible at a glance (drill down on any of them with tickers:[\"X\"] for the full row). Filter by ticker/id/status/horizon as needed. Set include_research=true to also pull the lower-priority sections (recentCatalysts, fundamentals, latestEarnings, catalystsAndEvents, analystConsensus, insiderTechnical, researchData).",
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
    // The one builder (step 8): a full row and a quiet row each go through
    // rowForModel, sized; today a quiet row is itself.
    const theses = (rest.theses as Array<Record<string, unknown>>).map((row) => rowForModel(row, { named, size: "full" }));
    const quiet = Array.isArray(rest.quiet_theses) ? (rest.quiet_theses as Array<Record<string, unknown>>).map((row) => rowForModel(row, { named, size: "line" })) : rest.quiet_theses;
    return {
      ...result,
      data: {
        ...rest,
        theses,
        ...(Array.isArray(quiet) ? { quiet_theses: quiet } : {}),
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

    // When the research was written and the price then: the writer's latest
    // save on each stock, its date and its price from the same row. The
    // research text and the score are as old as that visit (SYK on
    // 2026-10-02: written at $348, the stock at $273, 51 days on). A later
    // save that touched a research field is an edit, not a rewrite (SYK
    // 2026-10-08 read "Written 2026-10-07 at $348.15", the August price
    // under an October date).
    const researchWrittenByThesis = new Map<string, { at: Date; price: number }>();
    if (theses.length > 0) {
      const writerSaves = await prisma.thesisUpdate.findMany({
        where: { thesisId: { in: theses.map((t) => t.id) }, priceAtTime: { not: null }, run: { mode: "THESIS_WRITER" } },
        orderBy: { timestamp: "desc" },
        distinct: ["thesisId"],
        select: { thesisId: true, priceAtTime: true, timestamp: true },
      });
      for (const u of writerSaves) if (u.priceAtTime != null) researchWrittenByThesis.set(u.thesisId, { at: u.timestamp, price: u.priceAtTime });
    }

    // The live stocks (held, watched, promoted): the ones whose missing or
    // old price the result says in words.
    const liveTheses = theses.filter(
      (t) =>
        t.status === "HOLDING" ||
        t.status === "WATCHING" ||
        t.status === "PROMOTED",
    );

    // ── A stock's facts, loaded once (lib/agent/stock-facts.ts) ─────────
    // The live price and the work-flag list (work-inputs.ts), what's been
    // said on each stock, the resolved envelope, a buy into a full analyst
    // and the situation sources. The thesis sheet reads the same function,
    // so it shows what this read shows. A read filtered to some tickers has
    // a partial held list, so it counts the analyst's slots from its
    // positions, as the sheet does.
    const tickerFiltered = !!(args.tickers && args.tickers.length > 0);
    const facts = await loadStockFacts(theses, {
      userId: ctx.userId,
      analystId: ctx.analystId,
      runEnvironment: ctx.runEnvironment,
      alpacaCreds: ctx.alpacaCreds,
      accountId: ctx.accountId,
      minConfidence: ctx.minConfidence,
      maxOpenPositions: ctx.maxOpenPositions,
      slots: tickerFiltered ? "positions" : "rows",
    });
    const load = facts.load;
    Object.assign(priceAsOf, load.priceAsOf);
    if (load.priceFetchFailed) priceFetchFailed = true;
    const resolverPriceMap: Record<string, number> = load.livePrice;
    const ladderByThesisId = load.ladders;
    const needsActionByThesisId = new Map(Array.from(facts.needs, ([id, list]) => [id, list[0] ?? null] as const));
    const contextByThesisId = facts.context;
    const resolvedByThesisId = facts.resolved;
    const blockedByThesisId = facts.blocked;
    const setupOverrides = facts.setupOverrides;
    const resolverNow = facts.now;
    const situationsOf = (id: string): SituationCode[] => {
      const src = facts.sources.get(id);
      return src ? situationsFor(src) : [];
    };

    // Actionable-detail split: full rows for the work list, one-line index
    // entries for the quiet rest; "book" mode, and prices that failed to
    // load, keep everything full. Which stocks are work is
    // lib/agent/situations.ts `listsTheStock`, read off the facts.
    const listedIds = new Set<string>();
    for (const t of theses) {
      const sources = facts.sources.get(t.id)!;
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
      situations: situationsOf(t.id),
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
        // Every situation the stock is in, the lead's first; `guidance` on
        // the result says what each asks.
        situations: situationsOf(t.id),
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
        researchWritten: (() => {
          const w = researchWrittenByThesis.get(t.id);
          return w ? { on: w.at.toISOString().slice(0, 10), price: w.price, daysAgo: Math.floor((Date.now() - w.at.getTime()) / 86_400_000) } : null;
        })(),
        // P1-39 (principal ruling 2026-08-16): held-through-floor CONTEXT —
        // recent protective (STOP) declines in the last 7d + the principal's
        // verbatim reject message + the recent low (lowest low since the last
        // ladder edit; recent HIGH for SHORT). Informational only: use it to
        // enrich the daily exit-proposal rationale ("3rd day under your $860
        // floor; recent low $842; suggest $840 if you want the line moved").
        // NEVER a license to edit the floor — protective levels ratchet one
        // way (agents may raise, never lower); moving a line down is the
        // principal's manual act. null when no recent protective declines.
        heldThroughFloor: facts.heldThroughFloor.get(t.id) ?? null,
        // The facts the row lacked (step 8): the open position, the orders
        // awaiting approval, the price with the day's change, the chart
        // numbers the trigger check reads, and the rules the stock inherits
        // from the analyst and the account. Saved for the screen and the
        // run; rowForModel decides what the model reads of them.
        ...rowFacts(t, load, resolverPriceMap[t.ticker] ?? null),
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
    const soldToReview: Array<{ thesis_id: string; ticker: string; sold_on: string; days_ago: number; ask: string; situations: SituationCode[] }> = [];
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
              situations: ["SOLD_ONE_REVIEW"],
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

    // What each situation on the work list asks, once per read, in rank
    // order (lib/agent/situations.ts). A promoted stock calls for the
    // promotion's text alone; quiet rows are not today's work.
    const guidance = guidanceFor([
      ...fullTheses.flatMap((t) => guidanceCodes(t.status, situationsOf(t.id))),
      ...soldToReview.flatMap((x) => x.situations),
    ]);

    return {
      summary: summaryWithSold,
      data: {
        ...(priceWarnings.length > 0 ? { priceWarnings } : {}),
        count: theses.length,
        active: activeCount,
        watching: watchingCount,
        ...(Object.keys(guidance).length > 0 ? { guidance } : {}),
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
 * The facts a full row has carried since step 8's first pull request. The
 * saved row keeps them; the model's read of them is the next pull request's,
 * so until then the builder leaves them off and the read is as it was.
 */
export const ROW_FACTS = ["position", "proposals", "price", "chart", "inheritedTriggers"] as const;

/**
 * The facts for one row, off the one load (work-inputs.ts). Numbers and
 * dates, no sentences: the builder writes the words.
 */
function rowFacts(
  t: { id: string; ticker: string; status: string },
  load: StockFacts["load"],
  currentPrice: number | null,
): Record<(typeof ROW_FACTS)[number], unknown> {
  const pos = load.positions.get(t.id);
  const snap = load.indicators.get(t.ticker.toUpperCase());
  const dayChange = load.dayChange[t.ticker];
  return {
    position: pos ? { quantity: pos.quantity, avgCost: pos.avgCost, openedAt: pos.openedAt, peakPrice: pos.peakPrice } : null,
    proposals: load.proposals.get(t.id) ?? [],
    price:
      currentPrice != null && currentPrice > 0
        ? { current: currentPrice, dayChangePct: typeof dayChange === "number" ? dayChange : null, asOf: load.priceAsOf[t.ticker] ?? null }
        : null,
    chart: snap ? chartFacts(snap, currentPrice) : null,
    // The ladder's inherited rungs, each as its sentence with the level it
    // comes from; the stock's own are `triggers`.
    inheritedTriggers: (load.ladders.get(t.id) ?? [])
      .filter((x) => ((x as { level?: string }).level ?? "THESIS") !== "THESIS")
      .map((x) => ({ ...triggerForAgent(x, t.status === "HOLDING"), level: (x as { level?: string }).level })),
  };
}

/** How much of a row the model reads: a quiet stock's line, a stock in a situation's short row, or the full row. */
export type RowSize = "line" | "short" | "full";

/**
 * One row as the model reads it (see forModel above), the one builder for
 * every size (step 8). The screen and a saved run keep the whole row.
 * Today: "line" is the quiet row as saved; "short" and "full" are the full
 * row as saved, less bookkeeping and the facts above.
 */
export function rowForModel(row: Record<string, unknown>, opts: { named: boolean; size: RowSize }): Record<string, unknown> {
  const { named, size } = opts;
  if (size === "line") return { ...row };
  const out: Record<string, unknown> = { ...row };
  for (const k of ROW_FACTS) delete out[k];
  // The evaluator's fire bookkeeping for inherited triggers; the run reads
  // what fired from needsAction and context.
  delete out.triggerState;
  for (const k of NOT_FOR_THE_MODEL) {
    const v = out[k];
    if (v == null || (Array.isArray(v) && v.length === 0) || v === 0) delete out[k];
  }
  // The writer's save gives the date and the price together; a later edit of
  // a research field is said as an edit, never as the date of the writing.
  const updated = typeof row.researchUpdatedAt === "string" ? row.researchUpdatedAt.slice(0, 10) : row.researchUpdatedAt instanceof Date ? row.researchUpdatedAt.toISOString().slice(0, 10) : null;
  const w = row.researchWritten as { on: string; price: number; daysAgo: number } | null | undefined;
  const ago = (n: number) => `${n} day${n === 1 ? "" : "s"} ago`;
  const age = (row.researchAge as { daysOld?: number | null } | undefined)?.daysOld;
  out.research = w
    ? `Written ${w.on} at $${w.price}, ${ago(w.daysAgo)}${updated && updated > w.on ? `, edited ${updated}` : ""}.`
    : updated
      ? `Written ${updated}${age != null ? `, ${ago(age)}` : ""}.`
      : "No research written yet.";
  delete out.researchWritten;
  delete out.researchUpdatedAt;
  if (!named) delete out.history;
  return out;
}
