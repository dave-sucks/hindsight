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
import { getStockQuote } from "@/lib/actions/finnhub.actions";
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
      // Scoring rubric + composite are stored in fullResearch JSON.
      fullResearch: true,
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
  // sheet header's holding row.
  type PositionInfo = {
    quantity: number;
    avgCost: number;
    openedAt: string;
    currentPrice: number | null;
    marketValue: number | null;
    unrealizedPnl: number | null;
    unrealizedPnlPct: number | null;
    daysHeld: number;
  };
  // Live quote — always fetched (was previously gated to status=ACTIVE).
  // The thesis sheet now shows current price in the header for WATCHING +
  // ACTIVE + terminal rows, mirroring the stock-page header pattern. One
  // quote per sheet open; failure is non-fatal — the header just hides
  // the price block.
  const liveQuote = await getStockQuote(thesis.ticker).catch(() => null);
  const currentPrice =
    liveQuote && Number.isFinite(liveQuote.c) && liveQuote.c > 0 ? liveQuote.c : null;
  const dayChange =
    liveQuote && Number.isFinite(liveQuote.d) ? liveQuote.d : null;
  const dayChangePct =
    liveQuote && Number.isFinite(liveQuote.dp) ? liveQuote.dp : null;

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
      // Reuse the liveQuote fetched above — same ticker, single call.
      const qty = Number(pos.quantity);
      const avgCost = Number(pos.avgCost);
      const marketValue = currentPrice != null ? currentPrice * qty : null;
      const unrealizedPnl =
        currentPrice != null ? (currentPrice - avgCost) * qty : null;
      const unrealizedPnlPct =
        currentPrice != null && avgCost > 0
          ? ((currentPrice - avgCost) / avgCost) * 100
          : null;
      const daysHeld = Math.max(
        0,
        Math.floor((Date.now() - pos.openedAt.getTime()) / 86_400_000),
      );
      position = {
        quantity: qty,
        avgCost,
        openedAt: pos.openedAt.toISOString(),
        currentPrice,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPct,
        daysHeld,
      };
    }
  }

  // Most-recent TRIGGER_FIRED row (≤7d) — drives the sheet header banner.
  // We surface the predicate that fired plus the agent's response row
  // (UPDATED / CLOSED / INVALIDATED with the same triggerId) so the user
  // sees both the fire and the action in one banner.
  const since = new Date(Date.now() - 7 * 86_400_000);
  const recentFire = await prisma.thesisUpdate.findFirst({
    where: {
      thesisId: thesis.id,
      type: "TRIGGER_FIRED",
      timestamp: { gte: since },
    },
    orderBy: { timestamp: "desc" },
    select: {
      id: true,
      timestamp: true,
      summary: true,
      rationale: true,
      triggerId: true,
      runId: true,
    },
  });

  // Pull scoring out of fullResearch JSON (record_thesis stores it there).
  // Surface to UI alongside the durable belief fields so the user can see
  // the 4-dim breakdown that drove the WATCHING vs PASS decision.
  const fullResearch = (thesis.fullResearch ?? null) as
    | { scoring?: unknown; scoringComposite?: number | null }
    | null;
  const scoring = fullResearch?.scoring ?? null;
  const scoringComposite = fullResearch?.scoringComposite ?? null;

  return NextResponse.json({
    thesisId: thesis.id,
    ticker: thesis.ticker,
    direction: thesis.direction,
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
    // Structural belief — surfaced so the sheet can render the durable
    // claim + falsifiable premises + invalidation conditions instead of
    // just the prose layer (reasoningSummary / thesisBullets / riskFlags).
    coreBelief: thesis.coreBelief,
    keyAssumptions: thesis.keyAssumptions ?? [],
    invalidationConds: thesis.invalidationConds ?? [],
    // 4-dim composite scoring (record_thesis stores in fullResearch.scoring).
    scoring,
    scoringComposite,
    // Live quote — drives the price header below the company name.
    currentPrice,
    dayChange,
    dayChangePct,
    recentFire: recentFire
      ? {
          id: recentFire.id,
          timestamp: recentFire.timestamp.toISOString(),
          summary: recentFire.summary,
          rationale: recentFire.rationale,
          triggerId: recentFire.triggerId,
          runId: recentFire.runId,
        }
      : null,
  });
}
