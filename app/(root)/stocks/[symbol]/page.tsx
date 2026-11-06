import { Suspense } from "react";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StockPageTabs } from "@/components/stocks/StockPageTabs";
import { WatchlistDropdown } from "@/components/stocks/WatchlistDropdown";
import { PinButton } from "@/components/stocks/PinButton";
import { TradeButton } from "@/components/trade/TradeButton";
import { PositionCard } from "@/components/stocks/PositionCard";
import { StatGrid } from "@/components/stocks/StatGrid";
import { RangeBar } from "@/components/stocks/RangeBar";
import { Fundamentals } from "@/components/stocks/Fundamentals";
import { EarningsCard } from "@/components/domain/earnings-card";
import { AnalystCards } from "@/components/domain/analyst-consensus";
import { StockFilingsSection } from "@/components/filings/StockFilingsSection";
import { StockIdentityHeader } from "@/components/domain/stock-identity-header";
import { ThesisHeader } from "@/components/domain/thesis-header";
import { ThesisPageBody } from "@/components/trades/ThesisPageBody";
import { thesisSheetStateSelect } from "@/lib/agent/thesis-sheet-state";
import { agentWatchDays } from "@/lib/agent/triggers/agent-watch";
import {
  getNews,
  getStockProfile,
  getStockQuote,
  getStockMetrics,
  getStockCandles,
} from "@/lib/actions/finnhub.actions";
import { getAnalystCoverageData } from "@/lib/actions/analyst-coverage";
import { getStockInfo } from "@/lib/actions/stock-info";
import { getWatchlistStatusForSymbol } from "@/lib/actions/watchlist.actions";
import { getEarningsForSymbol } from "@/lib/market-data/earnings-calendar";
import { fillFacts } from "@/lib/stocks/stock-history";
import { rangeBars, overviewStatColumns, companyFactRows, fundamentals } from "@/lib/stocks/stock-stats";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";
import type { EarningsResponse } from "@/lib/types/thesis-sheet";
import { ExternalLink } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** The details-card label every sidebar and research block uses. */
type MarketNewsArticle = { headline: string; source: string; datetime: number; url: string };

async function NewsRows({ symbol }: { symbol: string }) {
  let news: MarketNewsArticle[] = [];
  try {
    news = await getNews([symbol]);
  } catch {
    news = [];
  }
  if (news.length === 0) {
    return <p className="text-sm text-muted-foreground">No recent news found for {symbol}.</p>;
  }
  return (
    <Card className="p-1 gap-1">
      {news.map((article, i) => (
        <a
          key={i}
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start justify-between gap-3 rounded-md p-2 hover:bg-muted/70 transition-colors"
        >
          <span className="min-w-0">
            <span className="block text-sm leading-snug line-clamp-2">{article.headline}</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              {article.source} ·{" "}
              {new Date(article.datetime * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-1" />
        </a>
      ))}
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

interface Props {
  params: Promise<{ symbol: string }>;
}

export default async function StockDetailPage({ params }: Props) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const accountId = user ? await getAccountId(user.id) : null;
  // Paper and live inventories never mix: the page shows the environment the switcher is on.
  const environment = await getCurrentEnvironment();

  const [identity, profile, quote, metrics, candles, coverage, earnings, positions, theses, watchlistStatus] =
    await Promise.all([
      getStockInfo(upperSymbol),
      getStockProfile(upperSymbol),
      getStockQuote(upperSymbol),
      getStockMetrics(upperSymbol),
      getStockCandles(upperSymbol, 365),
      getAnalystCoverageData(upperSymbol).catch(() => null),
      getEarningsForSymbol(upperSymbol).catch(() => null),
      accountId
        ? prisma.position.findMany({
            where: { accountId, symbol: upperSymbol, environment },
            orderBy: { openedAt: "desc" },
            take: 50,
            select: {
              id: true,
              direction: true,
              status: true,
              outcome: true,
              avgCost: true,
              closePrice: true,
              realizedPnl: true,
              quantity: true,
              openedAt: true,
              closedAt: true,
              closeReason: true,
              analyst: { select: { id: true, name: true } },
              decisions: { take: 1, select: { thesisId: true } },
              orders: {
                where: { status: { in: ["FILLED", "AWAITING_APPROVAL"] } },
                select: { id: true, side: true, intent: true, status: true, quantity: true, filledQty: true, filledPrice: true, filledAt: true, createdAt: true, rationale: true, closeReason: true },
              },
            },
          })
        : Promise.resolve([]),
      accountId
        ? prisma.thesis.findMany({
            where: { accountId, ticker: upperSymbol },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              ...thesisSheetStateSelect,
              createdAt: true,
              researchRun: { select: { agentConfigId: true, agentConfig: { select: { name: true } } } },
            },
          })
        : Promise.resolve([]),
      accountId ? getWatchlistStatusForSymbol(upperSymbol) : Promise.resolve([]),
    ]);

  const price = quote?.c ?? null;
  const marketCap = profile?.marketCap
    ? profile.marketCap * 1_000_000
    : metrics?.["marketCapitalization"]
      ? metrics["marketCapitalization"] * 1_000_000
      : null;

  // Every fill on the stock, across every position and analyst: the Transactions tab and the dialog a row opens.
  const transactions = fillFacts(
    positions.map((p) => ({
      id: p.id,
      direction: p.direction,
      status: p.status,
      avgCost: Number(p.avgCost),
      quantity: Number(p.quantity),
      realizedPnl: p.realizedPnl != null ? Number(p.realizedPnl) : null,
      closePrice: p.closePrice != null ? Number(p.closePrice) : null,
      closeReason: p.closeReason,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      analyst: p.analyst,
      thesisId: p.decisions[0]?.thesisId ?? null,
      orders: p.orders.map((o) => ({ ...o, quantity: Number(o.quantity), filledQty: o.filledQty != null ? Number(o.filledQty) : null, filledPrice: o.filledPrice != null ? Number(o.filledPrice) : null })),
    })),
  );

  // The open position, for the chart's entry line.
  const open = positions.find((p) => p.status === "OPEN") ?? null;

  // The live thesis on the stock, newest first: the page shows its view. A
  // stock with none shows the company, the street and Hindsight's history.
  const live = theses.find((t) => t.status === "HOLDING" || t.status === "WATCHING" || t.status === "PROMOTED") ?? null;

  const news = (
    <Suspense fallback={<Skeleton className="h-40 w-full rounded-lg" />}>
      <NewsRows symbol={upperSymbol} />
    </Suspense>
  );

  // The Overview's block under the company line (the owner, 2026-11-05):
  // where the price sits today and over the year, then six stats in two
  // columns. With or without a live thesis.
  const overviewStats = (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {rangeBars(quote, metrics).map((r) => (
          <RangeBar key={r.label} {...r} />
        ))}
      </div>
      <StatGrid columns={overviewStatColumns(metrics, marketCap)} />
    </div>
  );

  // The Fundamentals tab: three bands of groups, the company's facts beside
  // the first, the filings under them.
  const nextReport = (earnings as EarningsResponse | null)?.next?.reportDate ?? null;
  const financials = (
    <Fundamentals
      ticker={upperSymbol}
      data={fundamentals(metrics, marketCap)}
      facts={companyFactRows(profile, identity.exchange, nextReport)}
      filings={<StockFilingsSection symbol={upperSymbol} />}
    />
  );

  // No live thesis: the trades we made in it, Wall Street and the earnings
  // record.
  const sidebar = (
    <>
      {positions.length > 0 ? (
        <PositionCard
          price={price}
          trades={positions.map((p) => ({
            id: p.id,
            direction: p.direction,
            status: p.status,
            outcome: p.outcome,
            avgCost: Number(p.avgCost),
            closePrice: p.closePrice != null ? Number(p.closePrice) : null,
            realizedPnl: p.realizedPnl != null ? Number(p.realizedPnl) : null,
            quantity: Number(p.quantity),
            closeReason: p.closeReason,
            openedAt: p.openedAt.toISOString(),
            closedAt: p.closedAt ? p.closedAt.toISOString() : null,
          }))}
        />
      ) : null}
      <AnalystCards coverage={coverage} currentPrice={price} />
      {earnings ? <EarningsCard data={earnings as unknown as EarningsResponse} streetEps={coverage?.eps?.nextQuarter ?? null} /> : null}
    </>
  );

  return (
    <div data-surface="paper">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <LiveRefresh />
        {/* The same header the trade page and the sheet render: with a live
            thesis, its status and conviction beside the name. href={null}:
            we're already on the stock page. */}
        <div className="mb-3">
          {live ? (
            <ThesisHeader
              ticker={upperSymbol}
              status={live.status}
              agentWatchDays={agentWatchDays(live.triggers)}
              analystId={live.researchRun?.agentConfigId ?? null}
              thesisId={live.id}
              extraActions={<WatchlistDropdown symbol={upperSymbol} analysts={watchlistStatus} />}
            />
          ) : (
            <StockIdentityHeader
              ticker={upperSymbol}
              displayName={identity.companyName}
              exchange={identity.exchange}
              href={null}
              actions={
                <>
                  <TradeButton ticker={upperSymbol} />
                  <PinButton ticker={upperSymbol} />
                  <WatchlistDropdown symbol={upperSymbol} analysts={watchlistStatus} />
                </>
              }
            />
          )}
        </div>

        {live ? (
          // The stock, not the trade: the thesis's view with no plan on the
          // Overview, no Activity tab, every trade on the stock under
          // Transactions, and the stock's Financials and News after.
          <ThesisPageBody
            thesisId={live.id}
            ticker={upperSymbol}
            displayName={identity.companyName}
            stockHref={null}
            overviewStats={overviewStats}
            transactions={transactions}
            showTriggers={false}
            showActivity={false}
            moreTabs={[
              { label: "Fundamentals", content: financials },
              { label: "News", content: news },
            ]}
          />
        ) : (
          <StockPageTabs
            overview={{
              ticker: upperSymbol,
              candles,
              price,
              dayChange: quote?.d ?? null,
              dayChangePct: quote?.dp ?? null,
              held: open
                ? { avgCost: Number(open.avgCost), openedAt: open.openedAt.toISOString(), direction: open.direction === "SHORT" ? "SHORT" : "LONG" }
                : null,
            }}
            overviewStats={overviewStats}
            transactions={transactions}
            held={open ? { shares: Number(open.quantity), avgCost: Number(open.avgCost) } : null}
            financials={financials}
            news={news}
            sidebar={sidebar}
          />
        )}
      </div>
    </div>
  );
}
