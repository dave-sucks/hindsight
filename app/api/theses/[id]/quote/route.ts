/**
 * GET /api/theses/:id/quote
 *
 * The LIVE layer for a thesis — everything that depends on the current price:
 * the quote (price + day change), position PnL math, the `resolved`
 * actionability envelope, the work flag and the situations. The envelope,
 * the flag and the situations come from lib/agent/stock-facts.ts, the
 * function get_theses calls, so the sheet shows what the morning read shows.
 * All of it needs a live price, so it lives here rather than in the durable
 * dossier (/api/theses/:id), which is pure DB and gates the sheet's first paint.
 *
 * The sheet fires this in parallel with the dossier: the dossier paints the
 * body in ~50ms; this refines the price header, the position PnL, and the
 * Trade-Structure "Status" cell whenever Finnhub resolves. Also the mini-card
 * carousel's live-price source. Scoped to the requesting user.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getStockQuote } from "@/lib/actions/finnhub.actions";
import { getStockInfo } from "@/lib/actions/stock-info";
import { getAccountId } from "@/lib/auth/account";
import { loadStockFacts } from "@/lib/agent/stock-facts";
import { situationLabels } from "@/lib/agent/situations";

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

  // The thesis columns the stock's facts read (stock-facts.ts `FactsRow`),
  // and its analyst's settings for the plan check and the slot count.
  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: {
      id: true,
      ticker: true,
      status: true,
      direction: true,
      entryPrice: true,
      targetPrice: true,
      stopLoss: true,
      triggers: true,
      horizon: true,
      catalystDate: true,
      setupId: true,
      createdAt: true,
      scoring: true,
      researchRun: {
        select: {
          agentConfigId: true,
          agentConfig: { select: { minConfidence: true, maxOpenPositions: true, setupIds: true } },
        },
      },
    },
  });
  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const analyst = thesis.researchRun?.agentConfig ?? null;

  // The live quote and the StockInfo cache identity. Quote failure is
  // non-fatal — the sheet just omits the price line + PnL.
  const [liveQuote, identity] = await Promise.all([
    getStockQuote(thesis.ticker).catch(() => null),
    getStockInfo(thesis.ticker),
  ]);

  const currentPrice =
    liveQuote && Number.isFinite(liveQuote.c) && liveQuote.c > 0
      ? liveQuote.c
      : null;
  const dayChange =
    liveQuote && Number.isFinite(liveQuote.d) ? liveQuote.d : null;
  const dayChangePct =
    liveQuote && Number.isFinite(liveQuote.dp) ? liveQuote.dp : null;

  // The stock's facts, from the function get_theses calls, on the price
  // above. One stock was read, so the analyst's slots are counted from its
  // positions.
  const facts = await loadStockFacts([thesis], {
    userId: user.id,
    analystId: thesis.researchRun?.agentConfigId ?? null,
    accountId,
    prices: currentPrice != null ? { [thesis.ticker]: { price: currentPrice, t: liveQuote?.t ?? 0, dp: dayChangePct } } : {},
    minConfidence: analyst?.minConfidence ?? null,
    maxOpenPositions: analyst?.maxOpenPositions ?? null,
    slots: "positions",
  });
  const openPosition = facts.load.positions.get(thesis.id) ?? null;

  // PnL math for held theses — quantity + avgCost from the open Position,
  // currentPrice from the quote. Null when the quote failed or nothing's held.
  let positionPnl: {
    currentPrice: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number | null;
  } | null = null;
  if (currentPrice != null && openPosition) {
    const { quantity: qty, avgCost } = openPosition;
    positionPnl = {
      currentPrice,
      marketValue: currentPrice * qty,
      unrealizedPnl: (currentPrice - avgCost) * qty,
      unrealizedPnlPct:
        avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null,
    };
  }

  // The work-list flag is the lead of the stock's list (DAV-304); a stock no
  // longer live has none. The situations are every one the stock is in.
  const sources = facts.sources.get(thesis.id);
  return NextResponse.json({
    currentPrice,
    dayChange,
    dayChangePct,
    positionPnl,
    companyName: identity.companyName,
    exchange: identity.exchange,
    resolved: facts.resolved.get(thesis.id) ?? null,
    needsAction: facts.needs.get(thesis.id)?.[0] ?? null,
    situations: sources ? situationLabels(sources) : [],
  });
}
