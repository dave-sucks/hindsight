/**
 * GET /api/theses/:id/quote
 *
 * Returns ONLY the live quote and PnL math for a thesis. Split out from
 * /api/theses/:id/triggers on 2026-05-19 because the inline Finnhub call
 * (~1-2s) was blocking every other piece of the sheet — status pill,
 * core belief, scoring, triggers, all of it sat behind a network call
 * that has nothing to do with their data.
 *
 * Now the sheet fires both endpoints in parallel: triggers resolves in
 * ~50ms and refines the body, quote resolves whenever Finnhub does and
 * refines just the price header + position PnL.
 *
 * Powers the price/change line in the ThesisSheet header and the live
 * PnL fields on the PositionRow (currentPrice, marketValue, unrealizedPnl).
 * Scoped to the requesting user.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
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

  // Minimal thesis lookup — we need the ticker for the quote and the
  // ACTIVE-position FK to compute PnL math. Nothing else from the row.
  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: {
      ticker: true,
      status: true,
      researchRun: { select: { agentConfigId: true } },
    },
  });
  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The slow part. Failure is non-fatal — the sheet just hides the price
  // block + leaves the position row without live PnL.
  const liveQuote = await getStockQuote(thesis.ticker).catch(() => null);
  const currentPrice =
    liveQuote && Number.isFinite(liveQuote.c) && liveQuote.c > 0
      ? liveQuote.c
      : null;
  const dayChange =
    liveQuote && Number.isFinite(liveQuote.d) ? liveQuote.d : null;
  const dayChangePct =
    liveQuote && Number.isFinite(liveQuote.dp) ? liveQuote.dp : null;

  // PnL math for ACTIVE theses. Mirrors the calculation that used to live
  // in /triggers — quantity + avgCost come from Position; currentPrice
  // from the quote above. All fields null when the quote couldn't resolve
  // or when there's no open position.
  let positionPnl: {
    currentPrice: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number | null;
  } | null = null;

  if (
    currentPrice != null &&
    (thesis.status === "ACTIVE" || thesis.status === "HOLDING") &&
    thesis.researchRun?.agentConfigId
  ) {
    const pos = await prisma.position.findFirst({
      where: {
        accountId,
        analystId: thesis.researchRun.agentConfigId,
        symbol: thesis.ticker,
        status: "OPEN",
      },
      select: { quantity: true, avgCost: true },
    });
    if (pos) {
      const qty = Number(pos.quantity);
      const avgCost = Number(pos.avgCost);
      positionPnl = {
        currentPrice,
        marketValue: currentPrice * qty,
        unrealizedPnl: (currentPrice - avgCost) * qty,
        unrealizedPnlPct: avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null,
      };
    }
  }

  return NextResponse.json({
    currentPrice,
    dayChange,
    dayChangePct,
    positionPnl,
  });
}
