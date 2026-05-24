/**
 * GET /api/theses/:id/triggers
 *
 * Returns the structured trigger array attached to one thesis, plus the
 * scheduling metadata that drives daily-run review (horizon,
 * nextReviewAt, targetSizePct, scalingPlan, maxHoldDays, catalystDate).
 *
 * Powers the Triggers section inside ThesisSheet. Scoped to the
 * requesting user.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import { getAccountId } from "@/lib/auth/account";

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
      horizon: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      targetSizePct: true,
      scalingPlan: true,
      catalystDate: true,
      maxHoldDays: true,
      nextReviewAt: true,
      triggers: true,
      // Structural belief fields (load-bearing — trade-evaluator reads these
      // on close; tactical agent reads them on trigger fire). Surfaced to the
      // sheet so the user can see what the agent actually committed to.
      coreBelief: true,
      keyAssumptions: true,
      invalidationConds: true,
      // Scoring rubric + composite. `composite` is the single conviction
      // number after PR-9 (the legacy `confidenceScore` int was dropped).
      // `fullResearch` is still selected for the transitional fallback path
      // below; both drop together in PR-5.
      scoring: true,
      fullResearch: true,
      // 9 narrative sections (PR-9 flat schema). Three retypes of legacy
      // fields (snapshot ↔ reasoningSummary, bullCase ↔ thesisBullets,
      // bearCase ↔ riskFlags) + 6 new sections. Each is JSONB with a
      // text-and-citations or bullets-with-citations shape.
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
      researchRun: { select: { agentConfigId: true } },
    },
  });

  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = triggersArraySchema.safeParse(thesis.triggers);
  const triggers = parsed.success ? parsed.data : [];

  // Position lookup — only relevant when status='ACTIVE' and there's an
  // open Position scoped to this analyst on this ticker. Powers the
  // sheet header's holding row. Live-quote-derived fields (currentPrice,
  // marketValue, unrealizedPnl) are null here; the sheet refines them
  // client-side once /api/theses/[id]/quote returns (PR for split routes,
  // 2026-05-19 — the Finnhub call was blocking the entire sheet for ~1-2s).
  type PositionInfo = {
    quantity: number;
    avgCost: number;
    openedAt: string;
    daysHeld: number;
  };

  let position: PositionInfo | null = null;
  if (thesis.status === "ACTIVE" && thesis.researchRun?.agentConfigId) {
    const pos = await prisma.position.findFirst({
      where: {
        accountId,
        analystId: thesis.researchRun.agentConfigId,
        symbol: thesis.ticker,
        status: "OPEN",
      },
      select: {
        quantity: true,
        avgCost: true,
        openedAt: true,
      },
    });
    if (pos) {
      const daysHeld = Math.max(
        0,
        Math.floor((Date.now() - pos.openedAt.getTime()) / 86_400_000),
      );
      position = {
        quantity: Number(pos.quantity),
        avgCost: Number(pos.avgCost),
        openedAt: pos.openedAt.toISOString(),
        daysHeld,
      };
    }
  }

  // The most-recent-TRIGGER_FIRED lookup that previously lived here was
  // removed 2026-05-19. The TriggerFiredBanner it drove was deleted from
  // the sheet header on 2026-05-18 — the same data is still visible inside
  // the Activity timeline at the bottom, which has its own query. Cuts
  // ~100-200ms off every sheet open.

  // Pull scoring from the top-level column (PR-1 canonical), falling back
  // to the legacy `fullResearch.scoring` / `fullResearch.scoringComposite`
  // nesting for rows minted before the 2026-05-18 backfill. The fallback
  // path goes away in PR-4 when `fullResearch` is dropped.
  //
  // The new shape folds composite into the scoring object as a peer key
  // alongside the 4 dimensions, so the UI receives `scoring.composite`
  // directly. The legacy path materializes the same shape for parity.
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
    closedAt: thesis.closedAt,
    closeReason: thesis.closeReason,
    invalidatedAt: thesis.invalidatedAt,
    invalidReason: thesis.invalidReason,
    horizon: thesis.horizon,
    entryPrice: thesis.entryPrice,
    targetPrice: thesis.targetPrice,
    stopLoss: thesis.stopLoss,
    targetSizePct: thesis.targetSizePct,
    scalingPlan: thesis.scalingPlan,
    catalystDate: thesis.catalystDate,
    maxHoldDays: thesis.maxHoldDays,
    nextReviewAt: thesis.nextReviewAt,
    triggers,
    position,
    // Structural belief — durable claim + falsifiable premises + things
    // that would prove it wrong.
    coreBelief: thesis.coreBelief,
    keyAssumptions: thesis.keyAssumptions ?? [],
    invalidationConds: thesis.invalidationConds ?? [],
    // 4-dim composite scoring. `composite` is the SINGLE conviction
    // number after PR-9 (legacy `confidenceScore` int dropped). Both
    // place_trade gates read it.
    scoring,
    scoringComposite,
    // 9 narrative sections (PR-9 flat schema). null when the section
    // hasn't been populated — UI renderer skips null sections.
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
  });
}
