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
import { isSystemicRejection } from "@/lib/proposals/maybe-await-approval";
import {
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import { getBars, getDailyRangePcts, getLatestPrices } from "@/lib/alpaca";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { NeedsAction } from "@/lib/agent/needs-action";
import {
  buildResolvedEnvelope,
  buildSupersessionMap,
  type ResolvedEnvelope,
} from "@/lib/agent/resolved-thesis";
import { isLadderEditUpdate } from "@/lib/agent/ladder-health";
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

/**
 * P1-39: how far back a rejected/expired protective (STOP) close proposal
 * counts as "the principal recently held this name through its floor."
 * Post-#513 the exit stream re-surfaces ~daily while a breach persists, so
 * the window self-refreshes; an old decline with no fresh proposals behind
 * it ages out. Feeds the informational `heldThroughFloor` row field only.
 */
// Single source: lib/proposals/held-through-context.ts — the DIRECT
// (no-agent) proposal path mirrors this batch computation there (DAV-194).
import { HELD_THROUGH_WINDOW_DAYS } from "@/lib/proposals/held-through-context";

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
  detail: z
    .enum(["actionable", "book"])
    .optional()
    .describe(
      "Row weight. \"actionable\" returns FULL rows (narrative excerpts, triggers, resolved envelope) only for theses with a non-null needsAction or status=PROMOTED; every quiet row comes back as a one-line index entry in `quiet_theses` (ticker, status, the plan levels WITH the live price beside them, next review, core belief). \"book\" returns full rows for everything. Default: \"actionable\" on the Daily Run's unfiltered read (the trigger system already decided what needs work today — 2026-08-13 cost fix: full-book reads were ~4k tokens/thesis × every step), \"book\" everywhere else and whenever you filter by ticker/id (drill-down is always full).",
    ),
});

/** A principal review decision surfaced to the agent (P1-29 — the learning loop). */
export interface PrincipalDirective {
  decision: "REJECTED" | "APPROVED" | "EDITED";
  /** The principal's verbatim message (null on a no-message reject). */
  message: string | null;
  /** ISO timestamp of the decision. */
  at: string;
}

/**
 * Classify a thesis's MOST-RECENT ThesisUpdate row as an unaddressed principal
 * decision, or null when the top-of-log row is an agent action. "Unaddressed"
 * is implicit in being the top row: any agent follow-up would have replaced it
 * (same latest-on-top contract TRIGGER_FIRED uses), so this self-clears once
 * the agent acts. A reject WITH a message also flags the thesis for review at
 * reject time (nextReviewAt=now), so it arrives as REVIEW_DUE and the agent
 * reads this note during the review — there's no separate forcing needsAction.
 */
function classifyPrincipalDirective(
  u:
    | { type: string; rationale: string | null; fieldChanges: unknown; timestamp: Date }
    | null
    | undefined,
): PrincipalDirective | null {
  if (!u) return null;
  const at = u.timestamp.toISOString();

  if (u.type === "PROPOSAL_REJECTED") {
    const msg = typeof u.rationale === "string" ? u.rationale : null;
    // A no-message reject stores a "[REJECTED:USER] …" sentinel rationale —
    // surface it as a bare reject (null message); a real written message rides through.
    const hasMessage = msg != null && !msg.startsWith("[REJECTED:USER]");
    return { decision: "REJECTED", message: hasMessage ? msg : null, at };
  }

  if (u.type === "PROPOSAL_APPROVED") {
    // Only surface approvals that CHANGED the order (e.g. upsized 6→12); a plain
    // approve carries no instruction worth surfacing.
    const fc = u.fieldChanges as
      | { proposal?: { to?: { edited?: boolean; quantity?: number; proposedQuantity?: number } } }
      | null;
    const to = fc?.proposal?.to;
    if (!to?.edited) return null;
    const msg =
      to.proposedQuantity != null && to.quantity != null
        ? `Approved, resized ${to.proposedQuantity}→${to.quantity} shares (principal raised the size).`
        : "Approved with edits.";
    return { decision: "APPROVED", message: msg, at };
  }

  if (
    u.type === "UPDATED" &&
    typeof u.rationale === "string" &&
    u.rationale.startsWith("[USER]")
  ) {
    return {
      decision: "EDITED",
      message: u.rationale.replace(/^\[USER\]\s*/, ""),
      at,
    };
  }

  return null;
}

export const getTheses = defineTool({
  description:
    "Read this analyst's durable thesis library. Default returns HOLDING + WATCHING + PROMOTED theses (the live coverage book) with snapshot + bullCase + bearCase deep-research excerpts and a `researchAge` annotation (freshness: \"fresh\" | \"stale\" | \"missing\" + daysOld). On the Daily Run's unfiltered read, rows arrive at two weights: theses with work to do (non-null needsAction, or PROMOTED) come back FULL in `theses`; quiet rows come back as one-line index entries in `quiet_theses` — each carrying the live price next to its entry/target/stop, so a plan the price has left behind is visible at a glance (drill down on any of them with tickers:[\"X\"] for the full row). Filter by ticker/id/status/horizon as needed. Set include_history=true to get the recent activity log per thesis — use this in tactical mode (one ticker, full history) and during housekeeping (walk every thesis). Set include_research=true to also pull the lower-priority sections (recentCatalysts, fundamentals, latestEarnings, catalystsAndEvents, analystConsensus, insiderTechnical, researchData).",
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
    const explicitScope =
      explicitTarget ||
      !!(
        (args.status && args.status.length > 0) ||
        (args.horizon && args.horizon.length > 0) ||
        args.watching_review_due_only ||
        args.include_history ||
        args.include_research
      );
    const detailMode: "actionable" | "book" = explicitTarget
      ? "book"
      : args.detail ??
        (ctx.runMode === "MORNING_PLAN" && !explicitScope ? "actionable" : "book");
    // Set when the live-quote fetch throws — forces full-book detail so a
    // data outage can't hide actionable rows behind the quiet split.
    let priceFetchFailed = false;

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
        // Fire bookkeeping for inherited rungs — resolveThesisLadder
        // overlays it so cooldown reads the same at every level.
        triggerState: true,
        scalingPlan: true,
        catalystDate: true,
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
        t.status === "HOLDING" ||
        t.status === "WATCHING" ||
        t.status === "PROMOTED",
    );

    // ── The resolved ladder per thesis (the trigger cascade) ────────────
    // Every trigger consumer below reads from here rather than parsing
    // `t.triggers` directly, so the agent reasons about the ladder that
    // actually fires — its own rungs PLUS what it inherits from the
    // analyst, the account and the standing code minimums.
    //
    // This is load-bearing for ladder health, not just display: a holding
    // whose floor is inherited rather than stored would otherwise read as
    // UNPROTECTED_GAIN and the agent would be nagged to fix a ladder that
    // is already correct. The query is scoped to ctx.analystId, so one
    // lookup covers every row.
    const levelSources = ctx.analystId
      ? (await loadLevelSources([ctx.analystId])).get(ctx.analystId)
      : undefined;
    const ladderByThesisId = new Map<string, Trigger[]>(
      theses.map((t) => [
        t.id,
        resolveThesisLadder(t, levelSources, `thesis=${t.id}`) as Trigger[],
      ]),
    );
    const needsActionByThesisId = new Map<string, NeedsAction | null>();
    // P1-29 (L2): the most-recent unaddressed PRINCIPAL decision per thesis
    // (reject / approve-with-edit / direct edit), surfaced verbatim so the
    // agent reads the instruction directly instead of inferring it from a count.
    const principalDirectiveByThesisId = new Map<string, PrincipalDirective | null>();

    // ── Position openedAt per ACTIVE thesis (P1-14) ─────────────────────
    // TIME_ELAPSED on a HELD thesis measures "max hold N days" from when the
    // position opened, not the (possibly older) thesis row. Resolve the open
    // Position per ACTIVE (ticker) once; shared by both the needsAction and
    // resolver loops below. WATCHING/PROMOTED rows keep their createdAt clock
    // and aren't looked up. Scoped by analyst (+ environment when known) so a
    // LIVE run never reads a PAPER position's open time and vice versa.
    const positionOpenedAtByThesisId = new Map<string, Date>();
    // Paired open-position blended avgCost per HOLDING thesis — feeds the
    // RUNNING_WINNER needsAction flag + the resolver's inline P&L / progress
    // (SCALE_INTO_WINNERS.md PR3). Empty on lookup failure → winner signal is
    // null → no RUNNING_WINNER (graceful degradation).
    const avgCostByThesisId = new Map<string, number>();
    // Paired open-position water mark (high LONG / low SHORT, price-monitor-
    // maintained) — feeds the TRAILING_FROM_HIGH floor math in the
    // ladder-health block + UNPROTECTED_GAIN flag (Game Plan PR-B). Missing →
    // ladder-health falls back to the current price.
    const peakPriceByThesisId = new Map<string, number>();
    // P1-28 (L2): how many times the user has been shown a close proposal on
    // this held position and did NOT approve it — rejected OR ignored-to-expiry
    // (the user mostly ignores cards to expiry rather than clicking Reject).
    // Surfaced so the agent sees a reliable "you've proposed this exit N×, the
    // user keeps declining" signal, read from the canonical Order ledger. Pairs
    // with the Layer-1 cross-day cooldown gate in maybe-await-approval.ts.
    const unapprovedExitCountByThesisId = new Map<string, number>();
    // P1-39 (PROPOSAL_FATIGUE.md, principal ruling 2026-08-16): held-through-
    // floor CONTEXT per HOLDING thesis — recent protective (closeReason=STOP)
    // close proposals the principal rejected or let expire, plus their most
    // recent written reject message. Surfaced as an INFORMATIONAL field on
    // the full row (like unapprovedExitCount) so the agent can enrich its
    // daily exit-proposal rationale with "Nth day under your floor, recent
    // low $X, suggested new level $Y if you want the line moved." It does
    // NOT feed needsAction and it never authorizes the agent to move the
    // floor — level changes are the principal's manual act (protective
    // levels ratchet one way: agents may raise, never lower). The recent
    // low is resolved separately below (needs the ladder-edit scan first).
    const heldThroughByThesisId = new Map<
      string,
      { heldThroughCount: number; rejectMessage: string | null }
    >();
    const activeTickersForOpenedAt = Array.from(
      new Set(
        theses
          .filter(
            (t: { status: string }) =>
              t.status === "HOLDING",
          )
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
          select: {
            id: true,
            symbol: true,
            openedAt: true,
            avgCost: true,
            peakPrice: true,
          },
          orderBy: { openedAt: "desc" },
        });
        const openedAtByTicker = new Map<string, Date>();
        const positionIdByTicker = new Map<string, string>();
        const avgCostByTicker = new Map<string, number>();
        const peakPriceByTicker = new Map<string, number>();
        for (const p of openPositions) {
          if (!openedAtByTicker.has(p.symbol)) {
            openedAtByTicker.set(p.symbol, p.openedAt);
            positionIdByTicker.set(p.symbol, p.id);
            avgCostByTicker.set(p.symbol, Number(p.avgCost));
            if (p.peakPrice != null && Number.isFinite(Number(p.peakPrice))) {
              peakPriceByTicker.set(p.symbol, Number(p.peakPrice));
            }
          }
        }
        for (const t of theses) {
          if (t.status !== "HOLDING") continue;
          const openedAt = openedAtByTicker.get(t.ticker);
          if (openedAt) positionOpenedAtByThesisId.set(t.id, openedAt);
          const avgCost = avgCostByTicker.get(t.ticker);
          if (avgCost != null && Number.isFinite(avgCost)) {
            avgCostByThesisId.set(t.id, avgCost);
          }
          const peak = peakPriceByTicker.get(t.ticker);
          if (peak != null) peakPriceByThesisId.set(t.id, peak);
        }

        // Count UNAPPROVED close proposals per open position (Order ledger):
        // staged proposals (expiresAt set = the user actually saw a card) that
        // ended REJECTED-by-user OR EXPIRED. Excludes systemic tombstones.
        const openPositionIds = Array.from(positionIdByTicker.values());
        if (openPositionIds.length > 0) {
          const unapprovedCloses = await prisma.order.findMany({
            where: {
              positionId: { in: openPositionIds },
              side: "SELL",
              intent: "CLOSE",
              status: { in: ["REJECTED", "EXPIRED"] },
              expiresAt: { not: null },
            },
            orderBy: { createdAt: "desc" },
            select: {
              positionId: true,
              rejectionMessage: true,
              closeReason: true,
              createdAt: true,
            },
          });
          const countByPositionId = new Map<string, number>();
          // P1-39: recent protective declines per position — the held-through
          // signal. Window matches "the principal saw this exit recently and
          // still holds"; post-#513 the exit stream re-surfaces ~daily, so the
          // window self-refreshes while the breach persists.
          const heldThroughCutoff = new Date(
            Date.now() - HELD_THROUGH_WINDOW_DAYS * 86_400_000,
          );
          const heldThroughByPositionId = new Map<
            string,
            { heldThroughCount: number; rejectMessage: string | null }
          >();
          for (const o of unapprovedCloses) {
            // Exclude systemic tombstones (dedup, P1-28 cooldown) — only a real
            // decline (rejection or ignored expiry) counts. Sync w/ the L1 gate.
            if (isSystemicRejection(o.rejectionMessage)) continue;
            countByPositionId.set(
              o.positionId,
              (countByPositionId.get(o.positionId) ?? 0) + 1,
            );
            // Protective declines only (STOP-tagged): a declined TARGET exit
            // means "let it run" — a different, benign hold. Rows are newest-
            // first, so the first message seen is the most recent one.
            if (o.closeReason === "STOP" && o.createdAt >= heldThroughCutoff) {
              const prev = heldThroughByPositionId.get(o.positionId);
              heldThroughByPositionId.set(o.positionId, {
                heldThroughCount: (prev?.heldThroughCount ?? 0) + 1,
                rejectMessage: prev?.rejectMessage ?? o.rejectionMessage ?? null,
              });
            }
          }
          for (const t of theses) {
            if (t.status !== "HOLDING") continue;
            const posId = positionIdByTicker.get(t.ticker);
            const n = posId ? countByPositionId.get(posId) ?? 0 : 0;
            if (n > 0) unapprovedExitCountByThesisId.set(t.id, n);
            const heldThrough = posId
              ? heldThroughByPositionId.get(posId)
              : undefined;
            if (heldThrough) heldThroughByThesisId.set(t.id, heldThrough);
          }
        }
      } catch (err) {
        console.warn(
          "[get_theses] open-position openedAt/rejected-exit lookup failed; TIME_ELAPSED falls back to createdAt:",
          err,
        );
      }
    }

    // ── Last ladder edit per HOLDING thesis (Game Plan PR-B) ────────────
    // Feeds ladderHealth.daysSinceLadderEdit — "how stale is the game plan."
    // One batched scan of recent CREATED/UPDATED audit rows, filtered in JS
    // by isLadderEditUpdate (fieldChanges touching triggers/fireMode/stopLoss;
    // TRIGGER_FIRED and rubber-stamp REVIEWED rows deliberately never count).
    // The scan is capped: when it comes back truncated AND a thesis has no
    // match, we can't distinguish "never edited" from "edited before the
    // window" → leave null (the block omits the field). When the scan is
    // complete and no match exists, the ladder was born with the thesis →
    // anchor to thesis.createdAt.
    const lastLadderEditAtByThesisId = new Map<string, Date>();
    const holdingIds = theses
      .filter((t) => t.status === "HOLDING")
      .map((t) => t.id);
    if (holdingIds.length > 0) {
      try {
        const scanTake = Math.min(40 * holdingIds.length, 300);
        const auditRows = await prisma.thesisUpdate.findMany({
          where: {
            thesisId: { in: holdingIds },
            type: { in: ["CREATED", "UPDATED"] },
          },
          orderBy: { timestamp: "desc" },
          take: scanTake,
          select: {
            thesisId: true,
            type: true,
            timestamp: true,
            fieldChanges: true,
          },
        });
        const scanTruncated = auditRows.length >= scanTake;
        const matched = new Set<string>();
        for (const r of auditRows) {
          if (matched.has(r.thesisId)) continue;
          if (isLadderEditUpdate(r.type, r.fieldChanges)) {
            lastLadderEditAtByThesisId.set(r.thesisId, r.timestamp);
            matched.add(r.thesisId);
          }
        }
        if (!scanTruncated) {
          for (const t of theses) {
            if (t.status === "HOLDING" && !matched.has(t.id)) {
              lastLadderEditAtByThesisId.set(t.id, t.createdAt);
            }
          }
        }
      } catch (err) {
        console.warn(
          "[get_theses] ladder-edit scan failed; daysSinceLadderEdit omitted:",
          err,
        );
      }
    }

    // ── Recent low per held-through thesis (P1-39) ──────────────────────
    // The trail-to line for HELD_THROUGH_FLOOR: lowest daily low (LONG; the
    // recent HIGH for SHORT) since the ladder was last edited — the window
    // PROPOSAL_FATIGUE.md §7 Q1 names as the starting point. Clamped to
    // [5, 30] days: the 5-day minimum guarantees at least one trading session
    // is in range even when the window spans a long weekend or a market
    // holiday (a 2-day window on the Tuesday after a Monday holiday contains
    // zero sessions), and the 30-day cap keeps an ancient ladder from
    // suggesting a months-old low. Only the
    // held-through candidates are fetched (typically 0-3 tickers); bar-fetch
    // failure degrades to recentLow=null (the flag still fires, the agent
    // falls back to fresh data / judgment).
    const recentLowByThesisId = new Map<string, number>();
    const heldThroughCandidates = theses.filter(
      (t) => t.status === "HOLDING" && heldThroughByThesisId.has(t.id),
    );
    if (heldThroughCandidates.length > 0) {
      const nowMs = Date.now();
      await Promise.all(
        heldThroughCandidates.map(async (t) => {
          try {
            const since = lastLadderEditAtByThesisId.get(t.id);
            const daysBack = since
              ? Math.ceil((nowMs - since.getTime()) / 86_400_000)
              : 30;
            const clampedDays = Math.min(Math.max(daysBack, 5), 30);
            const start = new Date(nowMs - clampedDays * 86_400_000)
              .toISOString()
              .slice(0, 10);
            const end = new Date(nowMs).toISOString().slice(0, 10);
            const bars = await getBars(
              t.ticker,
              { start, end },
              ctx.alpacaCreds,
            );
            const isLong = t.direction !== "SHORT";
            const extremes = bars
              .map((b) => (isLong ? b.low ?? b.close : b.high ?? b.close))
              .filter((v): v is number => typeof v === "number" && v > 0);
            if (extremes.length > 0) {
              recentLowByThesisId.set(
                t.id,
                isLong ? Math.min(...extremes) : Math.max(...extremes),
              );
            }
          } catch (err) {
            console.warn(
              `[get_theses] recent-low fetch failed for ${t.ticker}; HELD_THROUGH_FLOOR degrades to recentLow=null:`,
              err,
            );
          }
        }),
      );
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
          // P1-29 (L2): rationale + fieldChanges let us classify whether the
          // top-of-log row is an unaddressed PRINCIPAL decision (reject /
          // approve-with-edit / direct edit) and extract the verbatim message.
          rationale: true,
          fieldChanges: true,
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
        // Review finding #3: when quotes are down, every price-dependent
        // needsAction kind (TRIGGER_MATCHING_NOW / UNPROTECTED_GAIN /
        // RUNNING_WINNER) degrades to null — under actionable detail that
        // would silently collapse the whole winner book to quiet index rows
        // on exactly the mornings data is flaky. Fail OPEN: degraded data
        // forces full-book detail (see isFullDetail below).
        priceFetchFailed = true;
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
        const triggers: Trigger[] = ladderByThesisId.get(t.id) ?? [];
        const price = priceByTicker[t.ticker];
        const latestQuote =
          typeof price === "number" && price > 0
            ? { price, changePct: 0 }
            : null;
        // P1-29: surface the most-recent unaddressed principal decision on the
        // row (verbatim). A reject-with-comment also flags the thesis for review
        // at reject time (nextReviewAt=now in rejectProposal), so it arrives as
        // needsAction=REVIEW_DUE and the agent reads this note during the review
        // — no separate forcing needsAction kind.
        principalDirectiveByThesisId.set(
          t.id,
          classifyPrincipalDirective(latestByThesisId.get(t.id)),
        );
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
              avgCost: avgCostByThesisId.get(t.id) ?? null,
              peakPrice: peakPriceByThesisId.get(t.id) ?? null,
              targetPrice: t.targetPrice ?? null,
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

    const resolverNow = new Date();
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
            avgCost: avgCostByThesisId.get(t.id) ?? null,
            peakPrice: peakPriceByThesisId.get(t.id) ?? null,
            lastLadderEditAt: lastLadderEditAtByThesisId.get(t.id) ?? null,
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

    // Actionable-detail split: full rows for work-list theses; one-line
    // index entries for the quiet rest. "book" mode keeps everything full.
    // Full-row criteria (review findings #2/#3):
    //   • needsAction non-null — the trigger system's work list
    //   • status PROMOTED — must be resolved this run
    //   • resolved.actionability ENTER_NOW / STALE_PAST_CATALYST /
    //     PROMOTED_DECIDE_TODAY — actionable shapes that carry NO
    //     needsAction flag (the writer's "buy at market" shape is a
    //     WATCHING row with no ENTER trigger and price ≈ entry; hiding it
    //     would strand an intended entry indefinitely)
    //   • priceFetchFailed — fail open; degraded data must not hide winners
    //   • resolved.planSanity non-empty — the plan contradicts the live
    //     tape (DAV-188: buy level far from price / target passed / stop
    //     breached). A flagged-but-quiet row is the exact "wrong through 5
    //     runs" failure this exists to end; the flag forces the full row.
    // ACTIVE_HOLD deliberately stays quiet: it's the healthy-holding
    // default, and its work signals (UNPROTECTED_GAIN / RUNNING_WINNER /
    // trigger fires) all arrive via needsAction.
    const ACTIONABLE_RESOLVED = new Set([
      "ENTER_NOW",
      "STALE_PAST_CATALYST",
      "PROMOTED_DECIDE_TODAY",
    ]);
    const isFullDetail = (t: (typeof theses)[number]): boolean =>
      detailMode === "book" ||
      priceFetchFailed ||
      t.status === "PROMOTED" ||
      (needsActionByThesisId.get(t.id) ?? null) !== null ||
      ACTIONABLE_RESOLVED.has(resolvedByThesisId.get(t.id)?.actionability ?? "") ||
      (resolvedByThesisId.get(t.id)?.planSanity?.length ?? 0) > 0;

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
      nextReviewAt: t.nextReviewAt,
      catalystDate: t.catalystDate,
      // Resolved ladder, not the stored column — a thesis protected
      // entirely by inherited rungs is not a zero-trigger thesis.
      triggerCount: (ladderByThesisId.get(t.id) ?? []).length,
      researchAge: classifyResearchAge(
        t.researchUpdatedAt,
        t.horizon as Horizon | null,
      ),
      resolvedActionability: resolvedByThesisId.get(t.id)?.actionability ?? null,
      needsAction: null,
    }));

    const enriched = fullTheses.map((t) => {
      // Resolved ladder, not the stored column — see quietRows above.
      const triggerCount = (ladderByThesisId.get(t.id) ?? []).length;
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
        // P1-28 (L2): unapproved close proposals on this held position (Order
        // ledger) — rejected by the user OR ignored to expiry. >0 means "you
        // proposed this exit and the user declined N×" — don't re-propose
        // unless the thesis materially changed. 0 for non-HOLDING rows.
        unapprovedExitCount: unapprovedExitCountByThesisId.get(t.id) ?? 0,
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
          const ht = heldThroughByThesisId.get(t.id);
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
            heldThroughCount: ht.heldThroughCount,
            rejectMessage: ht.rejectMessage,
            recentLow: recentLowByThesisId.get(t.id) ?? null,
          };
        })(),
        // P1-29 (L2): the most-recent unaddressed principal review decision on
        // this thesis — reject (verbatim message), approve-with-edit, or a
        // direct edit — surfaced so the agent reads + honors it. A reject with a
        // message also flags the thesis for review (REVIEW_DUE) at reject time,
        // so the agent reads this during that review. null when the latest
        // activity is an agent action.
        principalDirective: principalDirectiveByThesisId.get(t.id) ?? null,
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

    return {
      summary,
      data: {
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
        // ThesisCardData[] for ThesisCardRenderer — drives the
        // "Read theses" carousel in the chat (full-detail rows only).
        cards,
      },
      sources: [],
    };
  },
});
