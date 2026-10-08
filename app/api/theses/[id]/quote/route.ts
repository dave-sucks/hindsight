/**
 * GET /api/theses/:id/quote
 *
 * The LIVE layer for a thesis — everything that depends on the current price:
 * the quote (price + day change), position PnL math, and the `resolved`
 * actionability envelope (trigger evaluation + supersession + the
 * ENTER_NOW / WAIT_FOR_TRIGGER / ACTIVE_HOLD rollup). All of it needs a live
 * price, so it lives here rather than in the durable dossier
 * (/api/theses/:id), which is pure DB and gates the sheet's first paint.
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
import {
  buildResolvedEnvelope,
  buildSupersessionMap,
} from "@/lib/agent/resolved-thesis";
import { computeNeedsAction } from "@/lib/agent/needs-action";
import { loadWorkInputs } from "@/lib/agent/work-inputs";

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

  // Thesis fields needed for the quote (ticker) + the resolved envelope
  // (entry / triggers / dates / scoring / status). Everything price-dependent
  // is computed here; the durable body comes from /api/theses/[id].
  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: {
      id: true,
      ticker: true,
      status: true,
      direction: true,
      entryPrice: true,
      // Plan-sanity inputs (DAV-188) — the sheet envelope carries the same
      // flags the agent sees.
      targetPrice: true,
      stopLoss: true,
      triggers: true,
      horizon: true,
      catalystDate: true,
      setupId: true,
      createdAt: true,
      scoring: true,
      researchRun: { select: { agentConfigId: true, agentConfig: { select: { minConfidence: true } } } },
    },
  });
  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ownAnalystId = thesis.researchRun?.agentConfigId ?? null;

  // One parallel batch: the live quote, the StockInfo cache identity, and
  // the terminal-sibling supersession lookup (same-analyst scope). Quote
  // failure is non-fatal — the sheet just omits the price line + PnL.
  const [liveQuote, identity, terminalSiblings] = await Promise.all([
    getStockQuote(thesis.ticker).catch(() => null),
    getStockInfo(thesis.ticker),
    prisma.thesis.findMany({
      where: {
        accountId,
        ticker: thesis.ticker,
        ...(ownAnalystId
          ? { researchRun: { agentConfigId: ownAnalystId } }
          : {}),
        status: { in: ["RETIRED", "PASSED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { id: true, ticker: true, createdAt: true },
    }),
  ]);

  const currentPrice =
    liveQuote && Number.isFinite(liveQuote.c) && liveQuote.c > 0
      ? liveQuote.c
      : null;
  const dayChange =
    liveQuote && Number.isFinite(liveQuote.d) ? liveQuote.d : null;
  const dayChangePct =
    liveQuote && Number.isFinite(liveQuote.dp) ? liveQuote.dp : null;

  // What the work flag reads, from the loader get_theses and complete_run
  // use, on the price above: the resolved ladder (own rungs plus everything
  // inherited — the same ladder the sheet's pills draw), the open position,
  // the activity, a declined sale, a queued buy, the chart numbers, the
  // account's equity.
  const load = await loadWorkInputs([thesis.id], {
    userId: user.id,
    analystId: ownAnalystId,
    prices: currentPrice != null ? { [thesis.ticker]: { price: currentPrice, t: liveQuote?.t ?? 0 } } : {},
  });
  const openPosition = load.positions.get(thesis.id) ?? null;

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

  // Resolved envelope — live trigger evaluation + supersession + actionability
  // rollup. Drives the Trade-Structure "Status" cell. Price-dependent, so it
  // reflects whatever `currentPrice` the quote produced (null → the
  // price-independent states still resolve; ENTER_NOW/WAIT fall back cleanly).
  const supersessionMap = buildSupersessionMap(terminalSiblings);
  const resolved = buildResolvedEnvelope({
    thesis: {
      id: thesis.id,
      ticker: thesis.ticker,
      status: thesis.status,
      direction: thesis.direction,
      entryPrice: thesis.entryPrice,
      // Feed the plan-sanity flags (DAV-188) so the sheet's envelope
      // matches what the agent sees for the same thesis.
      targetPrice: thesis.targetPrice ?? null,
      stopLoss: thesis.stopLoss ?? null,
      triggers: thesis.triggers,
      catalystDate: thesis.catalystDate,
      setupId: thesis.setupId ?? null,
      horizon: thesis.horizon ?? null,
      createdAt: thesis.createdAt,
      scoring: thesis.scoring,
      minConfidence: thesis.researchRun?.agentConfig?.minConfidence ?? null,
      parsedTriggers: load.ladders.get(thesis.id) ?? [],
      positionOpenedAt: openPosition?.openedAt ?? null,
    },
    currentPrice,
    priceAsOf: liveQuote?.t ?? null,
    supersession: supersessionMap.get(thesis.ticker) ?? null,
    now: new Date(),
  });

  // The work-list flag itself (DAV-304): the lead of the list get_theses
  // hands the daily run, from the same inputs, so the sheet shows the flag a
  // person can test. A stock no longer live has none.
  const input = load.inputs.get(thesis.id);
  const needsAction = input ? computeNeedsAction(input)[0] ?? null : null;

  return NextResponse.json({
    currentPrice,
    dayChange,
    dayChangePct,
    positionPnl,
    companyName: identity.companyName,
    exchange: identity.exchange,
    resolved,
    needsAction,
  });
}
