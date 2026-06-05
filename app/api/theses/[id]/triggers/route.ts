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
import {
  buildResolvedEnvelope,
  buildSupersessionMap,
} from "@/lib/agent/resolved-thesis";
import type { Trigger } from "@/lib/agent/triggers/types";
import { getStockQuote } from "@/lib/actions/finnhub.actions";

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
      // Conviction Expression v4 — surface tier + rationale + variantView
      // to the sheet so the conviction badge and variantView callout
      // render. See docs/plans/CONVICTION_EXPRESSION.md §8.
      conviction: true,
      convictionRationale: true,
      variantView: true,
      // createdAt is needed by the resolver's supersession check (older
      // row is SUPERSEDED iff a newer terminal sister exists). Was not
      // previously selected here.
      createdAt: true,
      researchRun: { select: { agentConfigId: true } },
    },
  });

  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = triggersArraySchema.safeParse(thesis.triggers);
  const triggers = parsed.success ? parsed.data : [];

  // Position lookup — relevant when there's an open or pending-approval
  // Position scoped to this analyst on this ticker. Powers the sheet
  // header's holding row + the Trade-as-Proposal alert when an
  // AWAITING_APPROVAL Order is attached. Live-quote-derived fields
  // (currentPrice, marketValue, unrealizedPnl) are null here; the sheet
  // refines them client-side once /api/theses/[id]/quote returns.
  type PendingProposalInfo = {
    orderId: string;
    intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
    quantity: number;
    expiresAt: string | null;
    rationale: string | null;
  };
  type PositionInfo = {
    quantity: number;
    avgCost: number;
    openedAt: string;
    daysHeld: number;
    // Closed-position data — populated when the thesis (and its position)
    // is CLOSED, so the sheet's one trade block can render "Bought N @ $X,
    // closed at $Y" + realized P&L + close reason instead of a separate
    // terminal banner. See docs/plans/TRADE_AS_PROPOSAL.md.
    closed: boolean;
    closedAt: string | null;
    closePrice: number | null;
    realizedPnl: number | null;
    realizedPnlPct: number | null;
    closeReason: string | null;
    /** Trade-as-Proposal — set when an Order(AWAITING_APPROVAL) is linked
     *  to this position. Drives the inline Review dropdown + prompt. */
    pendingProposal: PendingProposalInfo | null;
  };

  let position: PositionInfo | null = null;
  const isActiveish =
    thesis.status === "ACTIVE" || thesis.status === "WATCHING";
  const isClosed = thesis.status === "CLOSED";
  if ((isActiveish || isClosed) && thesis.researchRun?.agentConfigId) {
    const pos = await prisma.position.findFirst({
      where: {
        accountId,
        analystId: thesis.researchRun.agentConfigId,
        symbol: thesis.ticker,
        // ACTIVE/WATCHING → the live holding (OPEN) or a pending buy
        // (PENDING_APPROVAL). CLOSED thesis → the closed position.
        status: isClosed ? "CLOSED" : { in: ["OPEN", "PENDING_APPROVAL"] },
      },
      orderBy: { openedAt: "desc" },
      select: {
        quantity: true,
        avgCost: true,
        openedAt: true,
        closedAt: true,
        closePrice: true,
        realizedPnl: true,
        closeReason: true,
        orders: {
          where: { status: "AWAITING_APPROVAL" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
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
      const ap = pos.orders?.[0];
      const cost = Number(pos.avgCost) * Number(pos.quantity);
      position = {
        quantity: Number(pos.quantity),
        avgCost: Number(pos.avgCost),
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
        pendingProposal: ap
          ? {
              orderId: ap.id,
              intent: (ap.intent ?? "OPEN") as PendingProposalInfo["intent"],
              quantity: Number(ap.quantity),
              expiresAt: ap.expiresAt?.toISOString() ?? null,
              rationale: ap.rationale,
            }
          : null,
      };
    }
  }

  // The most-recent-TRIGGER_FIRED lookup that previously lived here was
  // removed 2026-05-19. The TriggerFiredBanner it drove was deleted from
  // the sheet header on 2026-05-18 — the same data is still visible inside
  // the Activity timeline at the bottom, which has its own query. Cuts
  // ~100-200ms off every sheet open.

  // ── Conviction Expression v4 — resolved envelope ──────────────────
  // Server-side computation of the same envelope get_theses returns to
  // the agent: live price, trigger evaluation, supersession check,
  // actionability rollup. Powers the actionability badge in the sheet
  // header. Two parallel queries — supersession SQL + Finnhub quote.
  //
  // Supersession is scoped to the SAME ANALYST as this thesis, not the
  // whole account. Two analysts can hold different views on the same
  // ticker (one LONG, one PASS) without either superseding the other —
  // they have independent mandates. Pre-fix, account-level scoping
  // produced false SUPERSEDED flags on cross-analyst PASS rows.
  const ownAnalystId = thesis.researchRun?.agentConfigId ?? null;
  const [terminalSiblings, quote, openPosition] = await Promise.all([
    prisma.thesis.findMany({
      where: {
        accountId,
        ticker: thesis.ticker,
        ...(ownAnalystId
          ? { researchRun: { agentConfigId: ownAnalystId } }
          : {}),
        OR: [
          { status: { in: ["INVALIDATED", "ARCHIVED", "CLOSED"] } },
          { direction: "PASS" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { id: true, ticker: true, createdAt: true },
    }),
    getStockQuote(thesis.ticker).catch(() => null),
    // P1-14: paired open position's openedAt anchors TIME_ELAPSED for ACTIVE
    // rows so the sheet's actionability badge measures "max hold" from the
    // position open, not the (older) thesis row. Only relevant when held.
    thesis.status === "ACTIVE" && ownAnalystId
      ? prisma.position
          .findFirst({
            where: {
              analystId: ownAnalystId,
              symbol: thesis.ticker,
              status: "OPEN",
            },
            orderBy: { openedAt: "desc" },
            select: { openedAt: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const supersessionMap = buildSupersessionMap(terminalSiblings);
  const triggersParsed = triggersArraySchema.safeParse(thesis.triggers);
  const parsedTriggers = (triggersParsed.success
    ? triggersParsed.data
    : []) as Trigger[];
  const resolved = buildResolvedEnvelope({
    thesis: {
      id: thesis.id,
      ticker: thesis.ticker,
      status: thesis.status,
      direction: thesis.direction,
      entryPrice: thesis.entryPrice,
      triggers: thesis.triggers,
      catalystDate: thesis.catalystDate,
      createdAt: thesis.createdAt,
      nextReviewAt: thesis.nextReviewAt,
      scoring: thesis.scoring,
      parsedTriggers,
      positionOpenedAt: openPosition?.openedAt ?? null,
    },
    currentPrice: quote && typeof quote.c === "number" && quote.c > 0 ? quote.c : null,
    supersession: supersessionMap.get(thesis.ticker) ?? null,
    now: new Date(),
  });

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
    // Conviction Expression v4 — writer-side fields.
    conviction: thesis.conviction,
    convictionRationale: thesis.convictionRationale,
    variantView: thesis.variantView,
    // Conviction Expression v4 — resolved envelope (live price +
    // trigger state + actionability + supersession). Computed below in
    // parallel with the position lookup. See docs/plans/CONVICTION_EXPRESSION.md §6.
    resolved,
  });
}
