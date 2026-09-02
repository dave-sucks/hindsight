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

export async function GET(
  _req: Request,
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
      targetSizePct: true,
      scalingPlan: true,
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
  // it inherits from its analyst, the account, and the code defaults —
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
    pendingProposal: ThesisPendingProposal | null;
  };

  let position: PositionInfo | null = null;
  const isActiveish =
    thesis.status === "HOLDING" || thesis.status === "WATCHING";
  // P1-24 B3: a sold position retires the thesis (RETIRED+SOLD). Treat RETIRED
  // as closed-side — the CLOSED lookup finds the exit for SOLD rows and
  // harmlessly returns null for DROPPED/REPLACED.
  const isClosed = thesis.status === "RETIRED";
  if ((isActiveish || isClosed) && thesis.researchRun?.agentConfigId) {
    const pos = await prisma.position.findFirst({
      where: {
        accountId,
        analystId: thesis.researchRun.agentConfigId,
        symbol: thesis.ticker,
        status: isClosed ? "CLOSED" : { in: ["OPEN", "PENDING_APPROVAL"] },
      },
      orderBy: { openedAt: "desc" },
      select: {
        id: true,
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
      },
    });
    if (pos) {
      const daysHeld = Math.max(
        0,
        Math.floor((Date.now() - pos.openedAt.getTime()) / 86_400_000),
      );
      const picked = pickProposalOrder(pos.orders ?? []);
      const cost = Number(pos.avgCost) * Number(pos.quantity);
      position = {
        id: pos.id,
        quantity: Number(pos.quantity),
        avgCost: Number(pos.avgCost),
        peakPrice: pos.peakPrice != null ? Number(pos.peakPrice) : null,
        openedAt: pos.openedAt.toISOString(),
        daysHeld,
        closed: isClosed,
        closedAt: pos.closedAt?.toISOString() ?? null,
        closePrice: pos.closePrice != null ? Number(pos.closePrice) : null,
        realizedPnl: pos.realizedPnl != null ? Number(pos.realizedPnl) : null,
        realizedPnlPct:
          pos.realizedPnl != null && cost > 0
            ? (Number(pos.realizedPnl) / cost) * 100
            : null,
        closeReason: pos.closeReason,
        pendingProposal: picked
          ? {
              orderId: picked.order.id,
              intent: (picked.order.intent ?? "OPEN") as ThesisPendingProposal["intent"],
              quantity: Number(picked.order.quantity),
              expiresAt: picked.order.expiresAt?.toISOString() ?? null,
              rationale: picked.order.rationale,
              executing: picked.executing,
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
    targetSizePct: thesis.targetSizePct,
    scalingPlan: thesis.scalingPlan,
    catalystDate: thesis.catalystDate,
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
    sourceKind: thesis.sourceKind,
    sourceRationale: thesis.sourceRationale,
    sourceSignalIds: thesis.sourceSignalIds,
    parentThesisId: thesis.parentThesisId,
    conviction: thesis.conviction,
    convictionRationale: thesis.convictionRationale,
    variantView: thesis.variantView,
  });
}
