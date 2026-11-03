import { Suspense } from "react";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StockPageTabs } from "@/components/stocks/StockPageTabs";
import { StockHistory } from "@/components/stocks/StockHistory";
import { WatchlistDropdown } from "@/components/stocks/WatchlistDropdown";
import { PinButton } from "@/components/stocks/PinButton";
import { TradeButton } from "@/components/trade/TradeButton";
import { PositionCard } from "@/components/stocks/PositionCard";
import { StatBlock } from "@/components/stocks/StatGrid";
import { AnalystConsensusWidget } from "@/components/domain/analyst-consensus";
import { StockIdentityHeader } from "@/components/domain/stock-identity-header";
import { ThesisHeader } from "@/components/domain/thesis-header";
import { ThesisPageBody } from "@/components/trades/ThesisPageBody";
import { thesisSheetStateSelect } from "@/lib/agent/thesis-sheet-state";
import { agentWatchDays } from "@/lib/agent/triggers/agent-watch";
import { getThesisComposite } from "@/lib/agent/thesis-narrative";
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
import { buildStockHistory } from "@/lib/stocks/stock-history";
import { keyStatColumns } from "@/lib/stocks/stock-stats";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { ExternalLink } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

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

  const [identity, profile, quote, metrics, candles, coverage, positions, theses, watchlistStatus] =
    await Promise.all([
      getStockInfo(upperSymbol),
      getStockProfile(upperSymbol),
      getStockQuote(upperSymbol),
      getStockMetrics(upperSymbol),
      getStockCandles(upperSymbol, 365),
      getAnalystCoverageData(upperSymbol).catch(() => null),
      accountId
        ? prisma.position.findMany({
            where: { accountId, symbol: upperSymbol },
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

  const history = buildStockHistory(
    positions.map((p) => ({
      ...p,
      avgCost: Number(p.avgCost),
      closePrice: p.closePrice != null ? Number(p.closePrice) : null,
      realizedPnl: p.realizedPnl != null ? Number(p.realizedPnl) : null,
      quantity: Number(p.quantity),
    })),
    theses,
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

  // Hindsight on this stock: every thesis and trade on it, as dated rows.
  const historyBlock =
    history.length > 0 ? (
      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hindsight on this stock</p>
        <StockHistory ticker={upperSymbol} items={history} />
      </section>
    ) : null;

  // No live thesis: the trades we made in it, and Wall Street. The company's
  // numbers are the Data tab's.
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
      <AnalystConsensusWidget coverage={coverage} currentPrice={price} />
    </>
  );

  return (
    <div data-surface="paper">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <LiveRefresh />
        {/* The same header the trade page and the sheet render: with a live
            thesis, its status and conviction beside the name. href={null}:
            we're already on the stock page. */}
        <div className="mb-6">
          {live ? (
            <ThesisHeader
              ticker={upperSymbol}
              displayName={identity.companyName}
              href={null}
              status={live.status}
              agentWatchDays={agentWatchDays(live.triggers)}
              conviction={(live.conviction ?? null) as "STRONG" | "HIGH" | "MEDIUM" | "LOW" | null}
              score={getThesisComposite(live)}
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
          <ThesisPageBody
            thesisId={live.id}
            ticker={upperSymbol}
            moreTabs={[{ label: "News", content: news }]}
            afterActivity={historyBlock}
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
            stats={<StatBlock label="Key stats" columns={keyStatColumns(quote, metrics, marketCap)} />}
            history={history}
            news={news}
            sidebar={sidebar}
          />
        )}
      </div>
    </div>
  );
}
