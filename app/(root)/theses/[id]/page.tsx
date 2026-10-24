import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThesisSheetBody } from "@/components/agent/sheets/ThesisSheet";
import { DetailPage } from "@/components/domain/detail-page";
import { StockInfoCard } from "@/components/domain/stock-info-card";
import { TradeDetailsCard, type TradeDetails } from "@/components/domain/trade-details-card";
import { TradeActions } from "@/components/trades/TradeActions";
import { holdDurationFromHorizon } from "@/lib/agent/horizon-policy";
import { getThesisComposite } from "@/lib/agent/thesis-narrative";
import { loadLevelSources, resolveThesisLadder } from "@/lib/agent/triggers/load-levels";
import { canonicalLevels } from "@/lib/agent/triggers/price-levels";
import { getStockProfile, getStockQuote } from "@/lib/actions/finnhub.actions";
import { getAccountId } from "@/lib/auth/account";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * /theses/[id] — a thesis as a page: the thesis sheet, full width, with the
 * trade's own details beside it when a trade exists. /trades/[id] lands here.
 */

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const t = await prisma.thesis.findUnique({ where: { id }, select: { ticker: true } }).catch(() => null);
  return { title: t ? `$${t.ticker} thesis · Hindsight` : "Thesis · Hindsight" };
}

const positionSelect = {
  id: true,
  status: true,
  direction: true,
  quantity: true,
  avgCost: true,
  closePrice: true,
  realizedPnl: true,
  outcome: true,
  closeReason: true,
  openedAt: true,
  closedAt: true,
  agentEvaluation: true,
  peakPrice: true,
  analyst: { select: { id: true, name: true } },
  orders: {
    orderBy: { createdAt: "asc" as const },
    select: { id: true, side: true, status: true, createdAt: true, filledAt: true, alpacaOrderId: true, expiresAt: true },
  },
} as const;

/**
 * The trade behind a thesis: the position its buy decision links to, when
 * it was bought or is still waiting on you. A proposal that lapsed is not a
 * trade and stays in Activity. Older rows link no decision, so for a thesis
 * that can have a trade (held, or sold) the analyst's position on the ticker
 * is the fallback, the way the sheet finds it. A pass or a dropped watch
 * never gets one: the analyst's other trade on the ticker is not this thesis's.
 */
async function findPosition(
  accountId: string,
  thesis: { id: string; ticker: string; status: string; retiredReason: string | null; analystId: string | null },
) {
  const linked = await prisma.position.findMany({
    where: { accountId, decisions: { some: { thesisId: thesis.id } } },
    orderBy: { openedAt: "desc" },
    take: 5,
    select: positionSelect,
  });
  const filled = (p: (typeof linked)[number]) => p.orders.some((o) => o.side === "BUY" && o.status === "FILLED");
  const pick =
    linked.find((p) => p.status === "OPEN" || p.status === "PENDING_APPROVAL") ??
    linked.find((p) => p.status === "CLOSED" && filled(p)) ??
    null;
  if (pick || linked.length > 0 || !thesis.analystId) return pick;
  const statuses =
    thesis.status === "HOLDING"
      ? ["OPEN", "PENDING_APPROVAL"]
      : thesis.status === "WATCHING"
        ? ["PENDING_APPROVAL"]
        : thesis.status === "RETIRED" && thesis.retiredReason === "SOLD"
          ? ["CLOSED"]
          : null;
  if (!statuses) return null;
  return prisma.position.findFirst({
    where: { accountId, analystId: thesis.analystId, symbol: thesis.ticker, status: { in: statuses } },
    orderBy: { openedAt: "desc" },
    select: positionSelect,
  });
}

export default async function ThesisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const accountId = user ? await getAccountId(user.id) : null;
  if (!accountId) notFound();

  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: {
      id: true,
      ticker: true,
      status: true,
      retiredReason: true,
      direction: true,
      horizon: true,
      holdDuration: true,
      triggers: true,
      triggerState: true,
      scoring: true,
      researchRunId: true,
      researchRun: { select: { agentConfigId: true } },
    },
  });
  if (!thesis) notFound();

  const ticker = thesis.ticker.toUpperCase();
  const analystId = thesis.researchRun?.agentConfigId ?? null;
  const [position, profile, quote] = await Promise.all([
    findPosition(accountId, { id: thesis.id, ticker, status: thesis.status, retiredReason: thesis.retiredReason, analystId }),
    getStockProfile(ticker),
    getStockQuote(ticker),
  ]);

  let trade: TradeDetails | null = null;
  if (position) {
    // The levels in force, off the resolved ladder — the same read the
    // evaluator and the sheet make — so reward-to-risk is the real plan.
    const [levelSources, atr14] = await Promise.all([
      analystId ? loadLevelSources([analystId]).then((m) => m.get(analystId)) : Promise.resolve(undefined),
      loadIndicatorSnapshots([ticker])
        .then((m) => m.get(ticker)?.atr14 ?? null)
        .catch(() => null),
    ]);
    const levels = canonicalLevels({
      triggers: resolveThesisLadder(thesis, levelSources, `thesis=${thesis.id}`),
      direction: thesis.direction,
      status: thesis.status,
      avgCost: Number(position.avgCost),
      peakPrice: position.peakPrice != null ? Number(position.peakPrice) : null,
      atr14,
    });
    const orderView = (o: (typeof position.orders)[number]) => ({
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      filledAt: o.filledAt?.toISOString() ?? null,
      alpacaOrderId: o.alpacaOrderId,
    });
    const openingBuy = position.orders.find((o) => o.side === "BUY") ?? null;
    const closingSell = position.orders.filter((o) => o.side === "SELL").slice(-1)[0] ?? null;
    const proposal = position.orders.find((o) => o.status === "AWAITING_APPROVAL") ?? null;
    trade = {
      id: position.id,
      status: position.status,
      direction: position.direction,
      quantity: Number(position.quantity),
      avgCost: Number(position.avgCost),
      closePrice: position.closePrice != null ? Number(position.closePrice) : null,
      realizedPnl: position.realizedPnl != null ? Number(position.realizedPnl) : null,
      outcome: position.outcome,
      closeReason: position.closeReason,
      openedAt: position.openedAt.toISOString(),
      closedAt: position.closedAt?.toISOString() ?? null,
      agentEvaluation: position.agentEvaluation,
      buyFilled: position.orders.some((o) => o.side === "BUY" && o.status === "FILLED"),
      openingBuy: openingBuy ? orderView(openingBuy) : null,
      closingSell: closingSell ? orderView(closingSell) : null,
      proposalExpiresAt: proposal?.expiresAt?.toISOString() ?? null,
      analyst: position.analyst ? { id: position.analyst.id, name: position.analyst.name } : null,
      target: levels.target?.price ?? null,
      stop: levels.floor?.price ?? null,
      holdLabel: thesis.horizon ? holdDurationFromHorizon(thesis.horizon) : (thesis.holdDuration ?? null),
      composite: getThesisComposite(thesis),
    };
  }

  return (
    <DetailPage
      main={<ThesisSheetBody thesis_id={thesis.id} ticker={ticker} />}
      aside={
        <>
          {trade ? (
            <TradeDetailsCard
              trade={trade}
              livePrice={quote?.c ?? null}
              actions={
                <TradeActions tradeId={trade.id} ticker={ticker} isOpen={trade.status === "OPEN"} runId={thesis.researchRunId} />
              }
            />
          ) : null}
          <StockInfoCard symbol={ticker} profile={profile} />
        </>
      }
    />
  );
}
