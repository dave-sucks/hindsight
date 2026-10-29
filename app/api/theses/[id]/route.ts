/**
 * GET /api/theses/:id
 *
 * The DURABLE thesis dossier — everything the sheet needs to render its
 * structure, straight from Postgres in ONE fast query with ZERO third-party
 * calls. This is the endpoint that gates the sheet's first paint: header text,
 * core belief, trade block, triggers, scoring, the 9 narrative sections, and
 * durable position metadata (qty / avg cost / days held / pending proposal).
 *
 * The LIVE market layer — quote, candles, coverage, and the price-dependent
 * `resolved` actionability envelope — is fetched separately and hydrated in
 * after this paints, so the slowest vendor never blocks the readable dossier:
 *   • /api/theses/:id/quote            → live price + PnL + resolved envelope
 *   • /api/stocks/candles?symbols=…    → price chart
 *   • /api/theses/:id/analyst-coverage → consensus widget
 *
 * Scoped to the requesting user. Replaced the overloaded
 * /api/theses/:id/triggers?full=1 call, which coupled first paint to Alpaca +
 * FMP + Finnhub all resolving.
 */

import { NextResponse } from "next/server";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import {
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import { canonicalLevels } from "@/lib/agent/triggers/price-levels";
import { derivedNextReviewAt } from "@/lib/agent/triggers/defaults";
import { pickProposalOrder } from "@/lib/trade-status";
import type { ThesisPendingProposal } from "@/lib/types/thesis-sheet";
import { recentAnswers } from "@/lib/agent/stock-context";
import { ACTIVITY_LINES, ACTIVITY_SELECT } from "@/lib/agent/stock-context-for";
import { writeupComing } from "@/lib/proposals/auto-writeup";
import { writtenUpPrice } from "@/lib/thesis/written-up";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: {
      id: true,
      ticker: true,
      direction: true,
      status: true,
      closedAt: true,
      closeReason: true,
      invalidatedAt: true,
      invalidReason: true,
      retiredReason: true,
      horizon: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      catalystDate: true,
      lastReviewedAt: true,
      triggers: true,
      // Fire bookkeeping for INHERITED rungs — resolveThesisLadder overlays
      // it so the sheet's "Fired …" line reads the same field at every level.
      triggerState: true,
      // Structural belief fields (load-bearing — trade-evaluator reads these
      // on close; tactical agent reads them on trigger fire). Surfaced to the
      // sheet so the user can see what the agent actually committed to.
      coreBelief: true,
      keyAssumptions: true,
      invalidationConds: true,
      // Scoring rubric + composite. `composite` is the single conviction
      // number after PR-9. `fullResearch` is the transitional fallback.
      scoring: true,
      fullResearch: true,
      // 9 narrative sections (PR-9 flat schema).
      snapshot: true,
      recentCatalysts: true,
      fundamentals: true,
      latestEarnings: true,
      catalystsAndEvents: true,
      bullCase: true,
      bearCase: true,
      analystConsensus: true,
      insiderTechnical: true,
      researchUpdatedAt: true,
      sourceKind: true,
      sourceRationale: true,
      sourceSignalIds: true,
      parentThesisId: true,
      // Conviction Expression v4 — writer-side fields.
      conviction: true,
      convictionRationale: true,
      variantView: true,
      createdAt: true,
      researchRun: {
        select: {
          agentConfigId: true,
          // Name surfaces in the sheet's Trade Structure row — "who owns
          // this thesis" was previously invisible on the sheet.
          agentConfig: { select: { name: true } },
        },
      },
    },
  });

  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The ladder actually in force: this thesis's own rungs plus everything
  // it inherits from its analyst and the account —
  // one rung per bucket, most-specific level wins. Each carries `level` +
  // `inherited` so the sheet can render inherited rungs dotted and
  // read-only. Same resolver the 5-minute evaluator uses, so what the
  // sheet draws is what actually fires. See lib/agent/triggers/levels.
  const levelSources = await loadLevelSources(
    thesis.researchRun?.agentConfigId ? [thesis.researchRun.agentConfigId] : [],
  );
  const triggers = resolveThesisLadder(
    thesis,
    thesis.researchRun?.agentConfigId
      ? levelSources.get(thesis.researchRun.agentConfigId)
      : undefined,
    `thesis=${thesis.id}`,
  );

  // Position lookup — the open/pending or (for a retired thesis) closed
  // Position scoped to this analyst on this ticker. Durable metadata only;
  // live-quote-derived fields (currentPrice, marketValue, unrealizedPnl) are
  // filled in by /api/theses/[id]/quote after this paints.
  type PositionInfo = {
    /** High-water mark (low-water on a short) — places a trailing floor. */
    peakPrice?: number | null;
    id: string;
    quantity: number;
    avgCost: number;
    openedAt: string;
    daysHeld: number;
    closed: boolean;
    closedAt: string | null;
    closePrice: number | null;
    realizedPnl: number | null;
    realizedPnlPct: number | null;
    closeReason: string | null;
    outcome: string | null;
    pendingProposal: ThesisPendingProposal | null;
  };

  // The analysts' notes on this stock: the list every run is handed
  // (recentAnswers over the same newest Activity lines, stock-context.ts), so
  // what the Overview shows is what the agents read. Newest first.
  const notes = await prisma.thesisUpdate
    .findMany({
      where: { thesisId: thesis.id },
      orderBy: { timestamp: "desc" },
      take: ACTIVITY_LINES,
      select: ACTIVITY_SELECT,
    })
    .then((rows) => recentAnswers(rows.map((r) => ({ ...r, runMode: r.run?.mode ?? null }))))
    .catch(() => []);


  // The write-up's own date: the newest row a research-writer run saved, never
  // a later run's edit. Its price is the writer's own pull ("Data pulled").
  const writtenUpRow = await prisma.thesisUpdate
    .findFirst({
      where: { thesisId: thesis.id, run: { mode: "THESIS_WRITER" } },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true, priceAtTime: true, type: true, runId: true },
    })
    .catch(() => null);
  const writerPull = writtenUpRow?.runId
    ? await prisma.runEvent
        .findFirst({ where: { runId: writtenUpRow.runId, type: "writer_phase", title: "Data pulled" }, select: { payload: true } })
        .catch(() => null)
    : null;

  let position: PositionInfo | null = null;
  // The trade page pins its own row (`?position=`): the one trade it is
  // about, whatever the thesis's status has since become. The sheet takes
  // the thesis's current trade: open or proposed first, else the last one
  // closed, so a thesis that went back to Watching after a sale still shows
  // the trade it had and the way to it.
  const pinnedPositionId = new URL(req.url).searchParams.get("position");
  const lookupAnalystId = thesis.researchRun?.agentConfigId ?? null;
  if (pinnedPositionId || lookupAnalystId) {
    const select = {
        id: true,
        status: true,
        outcome: true,
        quantity: true,
        avgCost: true,
        peakPrice: true,
        openedAt: true,
        closedAt: true,
        closePrice: true,
        realizedPnl: true,
        closeReason: true,
        // The order the trade block describes — either awaiting your
        // decision (AWAITING_APPROVAL) or already approved and sitting at
        // Alpaca waiting to fill (PENDING). Both keep the block; only the
        // first still offers a Review control. Both statuses can be
        // outstanding at once (a trim proposed while an add is still
        // filling), so take a few and let pickProposalOrder rank them —
        // take: 1 would let the newer submitted order hide the decision
        // you still owe.
        orders: {
          where: { status: { in: ["AWAITING_APPROVAL", "PENDING"] } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            status: true,
            intent: true,
            quantity: true,
            expiresAt: true,
            rationale: true,
          },
        },
    } satisfies Prisma.PositionSelect;
    const wheres: Prisma.PositionWhereInput[] = pinnedPositionId
      ? [{ id: pinnedPositionId, accountId, symbol: thesis.ticker }]
      : [
          { accountId, analystId: lookupAnalystId!, symbol: thesis.ticker, status: { in: ["OPEN", "PENDING_APPROVAL"] } },
          { accountId, analystId: lookupAnalystId!, symbol: thesis.ticker, status: "CLOSED" },
        ];
    let pos: Prisma.PositionGetPayload<{ select: typeof select }> | null = null;
    for (const where of wheres) {
      pos = await prisma.position.findFirst({ where, orderBy: { openedAt: "desc" }, select });
      if (pos) break;
    }
    if (pos) {
      const closed = pos.status === "CLOSED";
      // To the sale once closed, to today while held.
      const daysHeld = Math.max(
        0,
        Math.floor(
          ((closed && pos.closedAt ? pos.closedAt.getTime() : Date.now()) - pos.openedAt.getTime()) /
            86_400_000,
        ),
      );
      const picked = pickProposalOrder(pos.orders ?? []);
      const writing = picked ? await writeupComing(picked.order.id) : false;
      const cost = Number(pos.avgCost) * Number(pos.quantity);
      position = {
        id: pos.id,
        quantity: Number(pos.quantity),
        avgCost: Number(pos.avgCost),
        peakPrice: pos.peakPrice != null ? Number(pos.peakPrice) : null,
        openedAt: pos.openedAt.toISOString(),
        daysHeld,
        closed,
        closedAt: pos.closedAt?.toISOString() ?? null,
        closePrice: pos.closePrice != null ? Number(pos.closePrice) : null,
        realizedPnl: pos.realizedPnl != null ? Number(pos.realizedPnl) : null,
        realizedPnlPct:
          pos.realizedPnl != null && cost > 0
            ? (Number(pos.realizedPnl) / cost) * 100
            : null,
        closeReason: pos.closeReason,
        outcome: pos.outcome,
        pendingProposal: picked
          ? {
              orderId: picked.order.id,
              intent: (picked.order.intent ?? "OPEN") as ThesisPendingProposal["intent"],
              quantity: Number(picked.order.quantity),
              expiresAt: picked.order.expiresAt?.toISOString() ?? null,
              rationale: picked.order.rationale,
              executing: picked.executing,
              writing,
            }
          : null,
      };
    }
  }

  // Scoring: prefer the top-level column (PR-1 canonical), fall back to the
  // legacy fullResearch nesting for rows minted before the 2026-05-18 backfill.
  type Scoring4Dim = {
    trendStrength?: unknown;
    relativeStrength?: unknown;
    entryQuality?: unknown;
    catalystFreshness?: unknown;
    composite?: number | null;
  };
  const topLevelScoring = (thesis.scoring ?? null) as Scoring4Dim | null;
  const legacyFullResearch = (thesis.fullResearch ?? null) as
    | { scoring?: Scoring4Dim; scoringComposite?: number | null }
    | null;
  const scoring: Scoring4Dim | null =
    topLevelScoring ??
    (legacyFullResearch?.scoring
      ? {
          ...legacyFullResearch.scoring,
          composite: legacyFullResearch.scoringComposite ?? null,
        }
      : null);
  const scoringComposite =
    topLevelScoring?.composite ?? legacyFullResearch?.scoringComposite ?? null;

  return NextResponse.json({
    thesisId: thesis.id,
    ticker: thesis.ticker,
    status: thesis.status,
    // LONG | SHORT | null (a pass/seed stores null).
    direction: thesis.direction,
    createdAt: thesis.createdAt,
    closedAt: thesis.closedAt,
    closeReason: thesis.closeReason,
    invalidatedAt: thesis.invalidatedAt,
    invalidReason: thesis.invalidReason,
    retiredReason: thesis.retiredReason,
    horizon: thesis.horizon,
    entryPrice: thesis.entryPrice,
    targetPrice: thesis.targetPrice,
    stopLoss: thesis.stopLoss,
    // The levels actually in force, read off the resolved trigger list —
    // the columns above are a cache and, until the L6 backfill runs, can
    // still name a price nothing enforces. The card renders THIS and flags
    // any column with no trigger behind it. See LEVELS_AS_TRIGGERS.md.
    levels: canonicalLevels({
      triggers,
      direction: thesis.direction,
      status: thesis.status,
      avgCost: position?.avgCost ?? null,
      peakPrice: position?.peakPrice ?? null,
    }),
    catalystDate: thesis.catalystDate,
    // When an analyst last actually looked. Stored (schema:321) and, until
    // DAV-304, never sent to the sheet — so "is this being reviewed?" was
    // only answerable by querying the database.
    lastReviewedAt: thesis.lastReviewedAt,
    notes: notes.map((n) => ({
      id: n.id ?? "",
      timestamp: n.timestamp.toISOString(),
      type: n.type,
      summary: n.summary ?? "",
      rationale: n.rationale ?? null,
      fieldChanges: (n.fieldChanges ?? null) as Record<string, { from: unknown; to: unknown }> | null,
      priceAtTime: n.priceAtTime ?? null,
      positionAtTime: null,
      triggerId: n.triggerId ?? null,
      signalIds: [],
      runId: n.runId ?? null,
      tradeId: null,
    })),
    // Derived at read time from the last actual look + the cadence on the
    // resolved ladder (DAV-221). Null = no scheduled review.
    reviewDueAt: derivedNextReviewAt({
      status: thesis.status,
      lastReviewedAt: thesis.lastReviewedAt,
      createdAt: thesis.createdAt,
      triggers,
      horizon: thesis.horizon,
    }),
    triggers,
    // Owning analyst — the trigger section deep-links an ANALYST-level rung
    // back to the analyst that owns it ("edit it where it lives").
    analystId: thesis.researchRun?.agentConfigId ?? null,
    position,
    analystName: thesis.researchRun?.agentConfig?.name ?? null,
    coreBelief: thesis.coreBelief,
    keyAssumptions: thesis.keyAssumptions ?? [],
    invalidationConds: thesis.invalidationConds ?? [],
    scoring,
    scoringComposite,
    snapshot: thesis.snapshot,
    recentCatalysts: thesis.recentCatalysts,
    fundamentals: thesis.fundamentals,
    latestEarnings: thesis.latestEarnings,
    catalystsAndEvents: thesis.catalystsAndEvents,
    bullCase: thesis.bullCase,
    bearCase: thesis.bearCase,
    analystConsensus: thesis.analystConsensus,
    insiderTechnical: thesis.insiderTechnical,
    researchUpdatedAt: thesis.researchUpdatedAt
      ? thesis.researchUpdatedAt.toISOString()
      : null,
    writtenUp: writtenUpRow
      ? { at: writtenUpRow.timestamp.toISOString(), price: writtenUpPrice(writtenUpRow, writerPull?.payload ?? null) }
      : null,
    sourceKind: thesis.sourceKind,
    sourceRationale: thesis.sourceRationale,
    sourceSignalIds: thesis.sourceSignalIds,
    parentThesisId: thesis.parentThesisId,
    conviction: thesis.conviction,
    convictionRationale: thesis.convictionRationale,
    variantView: thesis.variantView,
  });
}
