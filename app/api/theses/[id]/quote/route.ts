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
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import {
  buildResolvedEnvelope,
  buildSupersessionMap,
} from "@/lib/agent/resolved-thesis";
import type { Trigger } from "@/lib/agent/triggers/types";

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
      // Cascade inputs — the resolved envelope must evaluate the SAME
      // ladder the sheet's pills draw, or "matching now" and ladder health
      // would ignore every inherited rung and report a holding as
      // unprotected while its floor is showing on screen.
      triggerState: true,
      horizon: true,
      catalystDate: true,
      createdAt: true,
      scoring: true,
      researchRun: { select: { agentConfigId: true } },
    },
  });
  if (!thesis) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ownAnalystId = thesis.researchRun?.agentConfigId ?? null;
  const isHolding = thesis.status === "HOLDING";

  // One parallel batch: the slow Finnhub quote, the StockInfo cache identity,
  // the terminal-sibling supersession lookup (same-analyst scope), and the
  // open position (qty/avgCost for PnL + openedAt for TIME_ELAPSED). Quote
  // failure is non-fatal — the sheet just omits the price line + PnL.
  const [liveQuote, identity, terminalSiblings, openPosition] =
    await Promise.all([
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
      isHolding && ownAnalystId
        ? prisma.position
            .findFirst({
              where: {
                accountId,
                analystId: ownAnalystId,
                symbol: thesis.ticker,
                status: "OPEN",
              },
              orderBy: { openedAt: "desc" },
              select: { quantity: true, avgCost: true, openedAt: true },
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);

  const currentPrice =
    liveQuote && Number.isFinite(liveQuote.c) && liveQuote.c > 0
      ? liveQuote.c
      : null;
  const dayChange =
    liveQuote && Number.isFinite(liveQuote.d) ? liveQuote.d : null;
  const dayChangePct =
    liveQuote && Number.isFinite(liveQuote.dp) ? liveQuote.dp : null;

  // PnL math for held theses — quantity + avgCost from the open Position,
  // currentPrice from the quote. Null when the quote failed or nothing's held.
  let positionPnl: {
    currentPrice: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number | null;
  } | null = null;
  if (currentPrice != null && openPosition) {
    const qty = Number(openPosition.quantity);
    const avgCost = Number(openPosition.avgCost);
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
  // The resolved ladder — own rungs plus everything inherited. Same
  // resolver as the dossier route, the evaluator and get_theses.
  const parsedTriggers = resolveThesisLadder(
    thesis,
    ownAnalystId
      ? (await loadLevelSources([ownAnalystId])).get(ownAnalystId)
      : undefined,
    `thesis=${thesis.id}`,
  ) as Trigger[];
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
      createdAt: thesis.createdAt,
      scoring: thesis.scoring,
      parsedTriggers,
      positionOpenedAt: openPosition?.openedAt ?? null,
    },
    currentPrice,
    supersession: supersessionMap.get(thesis.ticker) ?? null,
    now: new Date(),
  });

  return NextResponse.json({
    currentPrice,
    dayChange,
    dayChangePct,
    positionPnl,
    companyName: identity.companyName,
    exchange: identity.exchange,
    resolved,
  });
}
