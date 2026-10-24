import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { InfoRow } from "@/components/ui/info-row";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PriceChange } from "@/components/ui/price-change";
import { ThesisRow, type ThesisRowData } from "@/components/ui/thesis-row";
import { StockPriceChart } from "@/components/stocks/StockPriceChart";
import { WatchlistDropdown } from "@/components/stocks/WatchlistDropdown";
import { PinButton } from "@/components/stocks/PinButton";
import { TradeButton } from "@/components/trade/TradeButton";
import { StockEarningsSection } from "@/components/earnings/StockEarningsSection";
import { StockFilingsSection } from "@/components/filings/StockFilingsSection";
import { StockIdentityHeader } from "@/components/domain/stock-identity-header";
import { AnalystConsensusWidget } from "@/components/domain/analyst-consensus";
import { DetailPage } from "@/components/domain/detail-page";
import { StatGrid } from "@/components/domain/stat-grid";
import { StockInfoCard } from "@/components/domain/stock-info-card";
import { StockHistoryCard } from "@/components/domain/stock-history-card";
import { thesisSheetStateSelect } from "@/lib/agent/thesis-sheet-state";
import {
  getThesisBearCaseBullets,
  getThesisBullCaseBullets,
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";
import { getNews, getStockProfile, getStockQuote, getStockMetrics, getStockCandles } from "@/lib/actions/finnhub.actions";
import { getAnalystCoverageData } from "@/lib/actions/analyst-coverage";
import { getStockInfo } from "@/lib/actions/stock-info";
import { getStockHistory } from "@/lib/actions/stock-history";
import { getWatchlistStatusForSymbol } from "@/lib/actions/watchlist.actions";
import { getInsiderBuying, getStockVolume } from "@/lib/market-data/stock-activity";
import { isMarketOpen } from "@/lib/market-hours";
import { summarizeStockHistory } from "@/lib/stock-history";
import { getAccountId } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * /stocks/[symbol] — one stock across every analyst and all time: the live
 * price and chart, the numbers, what the company told the world, and on the
 * right what this account has done on it (the history card). A thesis of
 * its own is /theses/[id]; this page links to each.
 */

// ─── Pieces ──────────────────────────────────────────────────────────────────

type MarketNewsArticle = { headline: string; source: string; datetime: number; url: string };

async function NewsList({ symbol }: { symbol: string }) {
  let news: MarketNewsArticle[] = [];
  try {
    news = await getNews([symbol]);
  } catch {
    news = [];
  }
  if (news.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No recent news found for {symbol}.</p>;
  }
  return (
    <div>
      {news.map((article, i) => (
        <div key={i}>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start justify-between gap-3 rounded px-1 py-3 transition-colors hover:bg-secondary/20"
          >
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
                {article.headline}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {article.source} · {new Date(article.datetime * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </p>
            </div>
            <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40" />
          </a>
          {i < news.length - 1 ? <Separator /> : null}
        </div>
      ))}
    </div>
  );
}

function fmtShares(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

// Volume against its 20-day average and open-market insider buying — the
// same reads the volume and insider-buying triggers fire on, so this
// section and the triggers can't disagree. Live; a failed read says so.
async function ActivitySection({ symbol }: { symbol: string }) {
  const [volume, insiders] = await Promise.all([getStockVolume(symbol), getInsiderBuying(symbol)]);
  const buys = insiders.last90?.buys ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Volume</p>
        {volume.error ? (
          <p className="text-sm text-muted-foreground">Volume unavailable — {volume.error}.</p>
        ) : (
          <StatGrid
            items={[
              { label: "Today", value: fmtShares(volume.today) },
              { label: "20-day avg", value: fmtShares(volume.avg20) },
              { label: "Vs average", value: volume.ratio != null ? `${volume.ratio.toFixed(2)}×` : "—" },
            ]}
          />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Insider buying</p>
        {insiders.error ? (
          <p className="text-sm text-muted-foreground">Insider buying unavailable — {insiders.error}.</p>
        ) : buys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open-market insider buying in the last 90 days.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {insiders.last90!.buyers} insider{insiders.last90!.buyers === 1 ? "" : "s"} bought in the last 90 days
              {insiders.last30 ? `, ${insiders.last30.buyers} in the last 30` : ""}
              {(insiders.last30?.buyers ?? 0) >= 3 ? " — a cluster." : "."}
              {insiders.last90!.lowestPrice != null ? ` Lowest price paid $${insiders.last90!.lowestPrice.toFixed(2)}.` : ""}
            </p>
            <div className="overflow-hidden rounded-lg border bg-card">
              {buys.slice(0, 8).map((b, i) => (
                <div key={`${b.name}-${b.date}-${i}`} className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2 text-sm last:border-0">
                  <span className="truncate">{b.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {new Date(`${b.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                    {" · "}
                    {b.shares.toLocaleString()} sh{b.price > 0 ? ` @ $${b.price.toFixed(2)}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const upperSymbol = symbol.toUpperCase();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const accountId = user ? await getAccountId(user.id) : null;

  const [identity, profile, quote, metrics, candles, coverage, history, watchlistStatus] = await Promise.all([
    getStockInfo(upperSymbol),
    getStockProfile(upperSymbol),
    getStockQuote(upperSymbol),
    getStockMetrics(upperSymbol),
    getStockCandles(upperSymbol, 365),
    getAnalystCoverageData(upperSymbol).catch(() => null),
    accountId ? getStockHistory(accountId, upperSymbol) : Promise.resolve({ theses: [], positions: [] }),
    accountId ? getWatchlistStatusForSymbol(upperSymbol) : Promise.resolve([]),
  ]);

  const price = quote?.c ?? null;
  const summary = summarizeStockHistory(history, price);

  // The thesis that speaks for the stock today: the one we hold, else the
  // newest watch, else the newest of all. One row; the rest are on the card.
  const currentId = summary.holding?.id ?? summary.watching[0]?.id ?? summary.past[0]?.id ?? null;
  const current = currentId
    ? await prisma.thesis.findUnique({
        where: { id: currentId },
        select: {
          ...thesisSheetStateSelect,
          createdAt: true,
          researchRunId: true,
          researchRun: { select: { agentConfig: { select: { name: true } } } },
        },
      })
    : null;
  const currentRow: ThesisRowData | null = current
    ? (() => {
        const composite = getThesisComposite(current);
        const open = summary.open && summary.open.thesisId === current.id ? summary.open : null;
        return {
          id: current.id,
          ticker: upperSymbol,
          direction: current.direction,
          status: current.status,
          confidenceScore: composite != null ? composite * 10 : 0,
          reasoningSummary: getThesisSnapshotText(current),
          thesisBullets: getThesisBullCaseBullets(current),
          riskFlags: getThesisBearCaseBullets(current),
          entryPrice: current.entryPrice,
          targetPrice: current.targetPrice,
          stopLoss: current.stopLoss,
          horizon: current.horizon,
          createdAt: current.createdAt.toISOString(),
          analystName: current.researchRun?.agentConfig?.name ?? null,
          runId: current.researchRunId,
          currentPrice: price,
          position: open
            ? { id: open.id, status: open.status, avgCost: open.avgCost, quantity: open.quantity, openedAt: open.openedAt }
            : null,
        };
      })()
    : null;

  const fmt = (n: number | null | undefined, digits = 2) => (n != null ? n.toFixed(digits) : "—");
  const fmtCur = (n: number | null | undefined) =>
    n != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n) : "—";
  const fmtBig = (n: number | null | undefined) => {
    if (n == null) return "—";
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    return `$${n.toFixed(0)}`;
  };
  const pct = (n: number | null | undefined, digits = 1) => (n != null ? `${n.toFixed(digits)}%` : "—");

  const high52 = metrics?.["52WeekHigh"];
  const low52 = metrics?.["52WeekLow"];
  const peRatio = metrics?.["peBasicExclExtraTTM"];
  const marketCap = profile?.marketCap
    ? profile.marketCap * 1_000_000
    : metrics?.["marketCapitalization"]
      ? metrics["marketCapitalization"] * 1_000_000
      : null;
  const quotedAt = quote?.t ? new Date(quote.t * 1000) : new Date();
  const priceNote = `${isMarketOpen() ? "Live" : "At close"} · ${quotedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const financials: Array<{ label: string; value: string }> = [
    { label: "P/E ratio", value: fmt(metrics?.["peBasicExclExtraTTM"]) },
    { label: "Forward P/E", value: fmt(metrics?.["peTTM"]) },
    { label: "P/B ratio", value: fmt(metrics?.["pbAnnual"]) },
    { label: "P/S ratio", value: fmt(metrics?.["psTTM"]) },
    { label: "EPS (TTM)", value: fmtCur(metrics?.["epsBasicExclExtraAnnual"]) },
    { label: "ROE", value: pct(metrics?.["roeRfy"]) },
    { label: "ROA", value: pct(metrics?.["roaRfy"]) },
    { label: "Gross margin", value: pct(metrics?.["grossMarginTTM"]) },
    { label: "Operating margin", value: pct(metrics?.["operatingMarginTTM"]) },
    { label: "Net margin", value: pct(metrics?.["netProfitMarginTTM"]) },
    { label: "Debt to equity", value: fmt(metrics?.["totalDebt/totalEquityAnnual"]) },
    { label: "Current ratio", value: fmt(metrics?.["currentRatioAnnual"]) },
    { label: "Dividend yield", value: pct(metrics?.["dividendYieldIndicatedAnnual"], 2) },
    { label: "Beta", value: fmt(metrics?.["beta"]) },
    { label: "52-week high", value: fmtCur(high52) },
    { label: "52-week low", value: fmtCur(low52) },
  ].filter((s) => s.value !== "—");

  return (
    <>
      <LiveRefresh />
      <DetailPage
        main={
          <div className="flex flex-col gap-5">
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

            {price != null ? (
              <div className="flex flex-col gap-0.5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                  <span className="text-xl font-semibold tabular-nums">{fmtCur(price)}</span>
                  {quote?.d != null ? <PriceChange dollarChange={quote.d} percentChange={quote.dp ?? null} size="xl" /> : null}
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">{priceNote}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No live price for {upperSymbol} right now.</p>
            )}

            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="financials">Financials</TabsTrigger>
                <TabsTrigger value="earnings">Earnings</TabsTrigger>
                <TabsTrigger value="filings">Filings</TabsTrigger>
                <TabsTrigger value="news">News</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="mt-4 flex flex-col gap-5">
                <StockPriceChart candles={candles} />
                <StatGrid
                  items={[
                    { label: "Prev close", value: fmtCur(quote?.pc) },
                    { label: "Open", value: fmtCur(quote?.o) },
                    { label: "Day range", value: `${fmtCur(quote?.l)} – ${fmtCur(quote?.h)}` },
                    { label: "52W range", value: `${fmtCur(low52)} – ${fmtCur(high52)}` },
                    { label: "Market cap", value: fmtBig(marketCap) },
                    { label: "P/E ratio", value: peRatio ? fmt(peRatio) : "—" },
                    { label: "EPS", value: metrics?.["epsBasicExclExtraAnnual"] ? fmt(metrics["epsBasicExclExtraAnnual"]) : "—" },
                    { label: "Div yield", value: pct(metrics?.["dividendYieldIndicatedAnnual"], 2) },
                  ]}
                />
                <Suspense fallback={<Skeleton className="h-24 w-full" />}>
                  <ActivitySection symbol={upperSymbol} />
                </Suspense>
                {currentRow ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {summary.holding?.id === currentRow.id ? "The thesis we hold" : summary.watching[0]?.id === currentRow.id ? "Watching" : "Latest thesis"}
                    </p>
                    <ThesisRow thesis={currentRow} showTicker={false} />
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent news</p>
                  <Suspense
                    fallback={
                      <div className="flex flex-col gap-3">
                        {[...Array(4)].map((_, i) => (
                          <Skeleton key={i} className="h-12 w-full" />
                        ))}
                      </div>
                    }
                  >
                    <NewsList symbol={upperSymbol} />
                  </Suspense>
                </div>
              </TabsContent>

              <TabsContent value="financials" className="mt-4">
                {financials.length > 0 ? (
                  <div className="grid gap-x-8 sm:grid-cols-2">
                    {financials.map((s) => (
                      <InfoRow key={s.label} label={s.label} value={s.value} mono />
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">No financial data available for {upperSymbol}.</p>
                )}
              </TabsContent>

              <TabsContent value="earnings" className="mt-4">
                <StockEarningsSection symbol={upperSymbol} />
              </TabsContent>

              <TabsContent value="filings" className="mt-4 max-w-3xl">
                <StockFilingsSection symbol={upperSymbol} />
              </TabsContent>

              <TabsContent value="news" className="mt-4 max-w-3xl">
                <Suspense
                  fallback={
                    <div className="flex flex-col gap-3">
                      {[...Array(6)].map((_, i) => (
                        <Skeleton key={i} className="h-14 w-full" />
                      ))}
                    </div>
                  }
                >
                  <NewsList symbol={upperSymbol} />
                </Suspense>
              </TabsContent>
            </Tabs>
          </div>
        }
        aside={
          <>
            <StockHistoryCard summary={summary} livePrice={price} />
            <StockInfoCard
              symbol={upperSymbol}
              profile={profile}
              extra={[
                { label: "Market cap", value: fmtBig(marketCap) },
                { label: "P/E", value: peRatio ? fmt(peRatio) : "—" },
                { label: "52W range", value: low52 && high52 ? `${fmtCur(low52)} – ${fmtCur(high52)}` : "—" },
              ]}
            />
            <AnalystConsensusWidget coverage={coverage} currentPrice={price} className="p-3 gap-4" />
          </>
        }
      />
    </>
  );
}
