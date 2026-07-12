import Link from "next/link";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StockPriceChart } from "@/components/stocks/StockPriceChart";
import { StockThesesList } from "@/components/stocks/StockThesesList";
import type { ThesisRowData } from "@/components/ui/thesis-row";
import { ViewAllThesesLink } from "@/components/stocks/ViewAllThesesLink";
import { WatchlistDropdown } from "@/components/stocks/WatchlistDropdown";
import {
  buildThesisSheetState,
  thesisSheetStateSelect,
} from "@/lib/agent/thesis-sheet-state";
import {
  getThesisBearCaseBullets,
  getThesisBullCaseBullets,
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";
import {
  getNews,
  getStockProfile,
  getStockQuote,
  getStockMetrics,
  getStockCandles,
} from "@/lib/actions/finnhub.actions";
import { getAnalystCoverageData } from "@/lib/actions/analyst-coverage";
import { getStockInfo } from "@/lib/actions/stock-info";
import { StockIdentityHeader } from "@/components/domain/stock-identity-header";
import { PriceChange } from "@/components/ui/price-change";
import { getWatchlistStatusForSymbol } from "@/lib/actions/watchlist.actions";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { cn } from "@/lib/utils";
import { AnalystConsensusWidget } from "@/components/domain/analyst-consensus";
import {
  ExternalLink,
} from "lucide-react";

// ─── Sub-components ──────────────────────────────────────────────────────────

type MarketNewsArticle = {
  headline: string;
  source: string;
  datetime: number;
  url: string;
};

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums text-foreground truncate">{value}</span>
    </div>
  );
}

async function NewsTab({ symbol }: { symbol: string }) {
  let news: MarketNewsArticle[] = [];
  try {
    news = await getNews([symbol]);
  } catch {
    news = [];
  }

  if (news.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No recent news found for {symbol}.
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {news.map((article, i) => (
        <div key={i}>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start justify-between gap-3 py-3 hover:bg-secondary/20 px-1 rounded transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground leading-snug group-hover:text-primary transition-colors line-clamp-2">
                {article.headline}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted-foreground">{article.source}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(article.datetime * 1000).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
          </a>
          {i < news.length - 1 && <Separator />}
        </div>
      ))}
    </div>
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

  // Fetch everything in parallel
  const [identity, profile, quote, metrics, candles, coverage, tickerTrades, tickerTheses, watchlistStatus] = await Promise.all([
    // Header identity from the StockInfo cache — same name + normalized
    // exchange the trade page + thesis sheet show. profile stays for the
    // Company Info card (industry / IPO / weburl).
    getStockInfo(upperSymbol),
    getStockProfile(upperSymbol),
    getStockQuote(upperSymbol),
    getStockMetrics(upperSymbol),
    getStockCandles(upperSymbol, 365),
    // Ratings distribution + price-target range for the shared
    // AnalystConsensusWidget (same widget the thesis sheet renders).
    getAnalystCoverageData(upperSymbol).catch(() => null),
    accountId
      ? prisma.position.findMany({
          where: { accountId, symbol: upperSymbol },
          orderBy: { openedAt: "desc" },
          take: 20,
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
          },
        })
      : Promise.resolve([]),
    accountId
      ? prisma.thesis.findMany({
          where: { accountId, ticker: upperSymbol },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            // P2-19: select every field the sheet renders so it can paint
            // synchronously on open instead of skeletons-then-fetch.
            // thesisSheetStateSelect includes the new flat-schema narrative
            // sections (snapshot / bullCase / bearCase / etc).
            ...thesisSheetStateSelect,
            createdAt: true,
            researchRunId: true,
            researchRun: { select: { source: true, agentConfigId: true, agentConfig: { select: { name: true } } } },
          },
        })
      : Promise.resolve([]),
    accountId ? getWatchlistStatusForSymbol(upperSymbol) : Promise.resolve([]),
  ]);

  // Format helpers
  const fmt = (n: number | null | undefined, digits = 2) =>
    n != null ? n.toFixed(digits) : "—";
  const fmtCur = (n: number | null | undefined) =>
    n != null
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n)
      : "—";
  const fmtBig = (n: number | null | undefined) => {
    if (n == null) return "—";
    if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    return `$${n.toFixed(0)}`;
  };

  const price = quote?.c ?? null;
  const change = quote?.d ?? null;
  const changePct = quote?.dp ?? null;

  const prevClose = quote?.pc;
  const open = quote?.o;
  const high = quote?.h;
  const low = quote?.l;
  const high52 = metrics?.["52WeekHigh"];
  const low52 = metrics?.["52WeekLow"];
  const peRatio = metrics?.["peBasicExclExtraTTM"];
  const eps = metrics?.["epsBasicExclExtraAnnual"];
  const divYield = metrics?.["dividendYieldIndicatedAnnual"];
  const marketCap = profile?.marketCap
    ? profile.marketCap * 1_000_000
    : metrics?.["marketCapitalization"]
    ? metrics["marketCapitalization"] * 1_000_000
    : null;


  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* ── Header — the SAME StockIdentityHeader the trade page + thesis
          sheet render (identical sizes, normalized exchange). href={null}:
          we're already on the stock page. */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <StockIdentityHeader
          ticker={upperSymbol}
          displayName={identity.companyName}
          exchange={identity.exchange}
          href={null}
        />
        <WatchlistDropdown symbol={upperSymbol} analysts={watchlistStatus} />
      </div>

      {/* ── 2-col grid ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* ════ MAIN column ════ */}
        <div className="min-w-0">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="financials">Financials</TabsTrigger>
              <TabsTrigger value="news">News</TabsTrigger>
              <TabsTrigger value="theses">Theses</TabsTrigger>
            </TabsList>

            {/* ── OVERVIEW ─────────────────────────────────────────── */}
            <TabsContent value="overview" className="mt-4 space-y-4">
              {/* Price block — same treatment as the trade page + thesis
                  sheet: text-xl price + shared PriceChange (arrow + color). */}
              {price != null && (
                <div className="space-y-0.5">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
                    <span className="text-xl font-semibold tabular-nums">
                      {fmtCur(price)}
                    </span>
                    {change != null && (
                      <PriceChange
                        dollarChange={change}
                        percentChange={changePct ?? null}
                        size="xl"
                      />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    At close · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                </div>
              )}

              {/* Chart */}
              <StockPriceChart candles={candles} />

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-4 gap-y-2 py-3 border-y">
                <StatCell label="Prev Close" value={fmtCur(prevClose)} />
                <StatCell label="Open" value={fmtCur(open)} />
                <StatCell label="Day Range" value={`${fmtCur(low)} – ${fmtCur(high)}`} />
                <StatCell label="52W Range" value={`${fmtCur(low52)} – ${fmtCur(high52)}`} />
                <StatCell label="Market Cap" value={fmtBig(marketCap)} />
                <StatCell label="P/E Ratio" value={peRatio ? fmt(peRatio) : "—"} />
                <StatCell label="EPS" value={eps ? fmt(eps) : "—"} />
                <StatCell label="Div Yield" value={divYield ? `${fmt(divYield)}%` : "—"} />
              </div>

              {/* Latest Thesis */}
              {(() => {
                const latest = tickerTheses.find((t: { status: string; direction: string | null }) => (t.status === "HOLDING") && t.direction !== "PASS") ?? tickerTheses[0];
                if (!latest) return null;
                const composite = getThesisComposite(latest);
                const rowData: ThesisRowData = {
                  id: latest.id,
                  ticker: upperSymbol,
                  direction: latest.direction,
                  status: latest.status,
                  // PR-9: legacy 0-100 confidenceScore is gone. The row
                  // renders Lean/Buy/Strong-Buy off this number — convert
                  // /10 composite to /100 (×10) so the same thresholds
                  // (≥80=Strong, ≥60=Buy) keep working.
                  confidenceScore: composite != null ? composite * 10 : 0,
                  reasoningSummary: getThesisSnapshotText(latest),
                  thesisBullets: getThesisBullCaseBullets(latest),
                  riskFlags: getThesisBearCaseBullets(latest),
                  entryPrice: latest.entryPrice,
                  targetPrice: latest.targetPrice,
                  stopLoss: latest.stopLoss,
                  horizon: latest.horizon,
                  createdAt: latest.createdAt.toISOString(),
                  analystName: latest.researchRun?.agentConfig?.name ?? null,
                  runId: latest.researchRunId,
                  sheetState: buildThesisSheetState(latest),
                };
                return <StockThesesList theses={[rowData]} />;
              })()}

              {/* News */}
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Recent News</p>
                <Suspense fallback={
                  <div className="space-y-3">
                    {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                }>
                  <NewsTab symbol={upperSymbol} />
                </Suspense>
              </div>
            </TabsContent>

            {/* ── FINANCIALS ───────────────────────────────────────── */}
            <TabsContent value="financials" className="mt-4">
              {metrics ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {[
                    { label: "P/E Ratio", value: fmt(metrics["peBasicExclExtraTTM"]) },
                    { label: "Forward P/E", value: fmt(metrics["peTTM"]) },
                    { label: "P/B Ratio", value: fmt(metrics["pbAnnual"]) },
                    { label: "P/S Ratio", value: fmt(metrics["psTTM"]) },
                    { label: "EPS (TTM)", value: fmtCur(metrics["epsBasicExclExtraAnnual"]) },
                    { label: "ROE", value: metrics["roeRfy"] != null ? `${metrics["roeRfy"].toFixed(1)}%` : "—" },
                    { label: "ROA", value: metrics["roaRfy"] != null ? `${metrics["roaRfy"].toFixed(1)}%` : "—" },
                    { label: "Gross Margin", value: metrics["grossMarginTTM"] != null ? `${metrics["grossMarginTTM"].toFixed(1)}%` : "—" },
                    { label: "Operating Margin", value: metrics["operatingMarginTTM"] != null ? `${metrics["operatingMarginTTM"].toFixed(1)}%` : "—" },
                    { label: "Net Margin", value: metrics["netProfitMarginTTM"] != null ? `${metrics["netProfitMarginTTM"].toFixed(1)}%` : "—" },
                    { label: "Debt/Equity", value: fmt(metrics["totalDebt/totalEquityAnnual"]) },
                    { label: "Current Ratio", value: fmt(metrics["currentRatioAnnual"]) },
                    { label: "Dividend Yield", value: metrics["dividendYieldIndicatedAnnual"] != null ? `${metrics["dividendYieldIndicatedAnnual"].toFixed(2)}%` : "—" },
                    { label: "Beta", value: fmt(metrics["beta"]) },
                    { label: "52W High", value: fmtCur(metrics["52WeekHigh"]) },
                    { label: "52W Low", value: fmtCur(metrics["52WeekLow"]) },
                  ]
                    .filter((s) => s.value !== "—")
                    .map((stat) => (
                      <div key={stat.label} className="bg-muted/30 rounded-lg p-3">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {stat.label}
                        </p>
                        <p className="text-sm font-medium tabular-nums mt-0.5">{stat.value}</p>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No financial data available for {upperSymbol}.
                </div>
              )}
            </TabsContent>

            {/* ── NEWS ─────────────────────────────────────────────── */}
            <TabsContent value="news" className="mt-4 max-w-3xl">
              <Suspense fallback={
                <div className="space-y-3">
                  {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              }>
                <NewsTab symbol={upperSymbol} />
              </Suspense>
            </TabsContent>

            {/* ── THESES — Perplexity "Notable Price Movement" style ── */}
            <TabsContent value="theses" className="mt-4 max-w-3xl">
              <StockThesesList theses={tickerTheses.map((t: typeof tickerTheses[number]) => {
                const composite = getThesisComposite(t);
                return {
                  id: t.id,
                  ticker: upperSymbol,
                  direction: t.direction,
                  status: t.status,
                  confidenceScore: composite != null ? composite * 10 : 0,
                  reasoningSummary: getThesisSnapshotText(t),
                  thesisBullets: getThesisBullCaseBullets(t),
                  riskFlags: getThesisBearCaseBullets(t),
                  entryPrice: t.entryPrice,
                  targetPrice: t.targetPrice,
                  stopLoss: t.stopLoss,
                  horizon: t.horizon,
                  createdAt: t.createdAt.toISOString(),
                  analystName: t.researchRun?.agentConfig?.name ?? null,
                  runId: t.researchRunId,
                  sheetState: buildThesisSheetState(t),
                };
              })} />
            </TabsContent>

          </Tabs>
        </div>

        {/* ════ SIDEBAR ════ */}
        <div className="hidden lg:block space-y-4">
          {/* Company Info */}
          {profile && (
            <Card>
              <CardContent className="p-3 flex flex-col gap-1">
                <p className="text-sm font-medium mb-0.5">Company Info</p>
                {[
                  { label: "Symbol", value: upperSymbol },
                  { label: "Exchange", value: profile.exchange || "—" },
                  { label: "Industry", value: profile.finnhubIndustry || "—" },
                  { label: "IPO Date", value: profile.ipo || "—" },
                  { label: "Country", value: profile.country || "—" },
                  { label: "Market Cap", value: fmtBig(marketCap) },
                  { label: "P/E", value: peRatio ? fmt(peRatio) : "—" },
                  { label: "52W Range", value: (low52 && high52) ? `${fmtCur(low52)} – ${fmtCur(high52)}` : "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-sm border-b border-border pb-1">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium tabular-nums text-right max-w-[60%] truncate">{value}</span>
                  </div>
                ))}
                {profile.weburl && (
                  <a
                    href={profile.weburl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    {profile.weburl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          {/* Analyst Consensus — the SAME shared widget the thesis sheet
              renders (rating badge + implied upside + proportional
              distribution bar + bear/bull target range). */}
          <AnalystConsensusWidget
            coverage={coverage}
            currentPrice={quote?.c ?? null}
            className="p-3 gap-4"
          />

          {/* Hindsight Summary */}
          {(tickerTrades.length > 0 || tickerTheses.length > 0) && (
            <Card>
              <CardContent className="p-3 flex flex-col gap-1">
                <p className="text-sm font-medium mb-0.5">Hindsight</p>
                <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">Analyses</span>
                  <span className="font-medium tabular-nums">{tickerTheses.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                  <span className="text-muted-foreground">Trades</span>
                  <span className="font-medium tabular-nums">{tickerTrades.length}</span>
                </div>
                {(() => {
                  const activeThesis = tickerTheses.find((t) => (t.status === "HOLDING") && t.direction !== "PASS");
                  if (!activeThesis) return null;
                  const activeComposite = getThesisComposite(activeThesis);
                  return (
                    <div className="flex items-center justify-between text-sm border-b border-border pb-1">
                      <span className="text-muted-foreground">Current View</span>
                      <span className={cn("font-medium", activeThesis.direction === "LONG" ? "text-positive" : "text-negative")}>
                        {activeThesis.direction}{activeComposite != null ? ` · ${activeComposite}/10` : ""}
                      </span>
                    </div>
                  );
                })()}
                {(() => {
                  const openTrade = tickerTrades.find((t) => t.status === "OPEN");
                  if (!openTrade) return null;
                  return (
                    <Link href={`/trades/${openTrade.id}`} className="flex items-center justify-between text-sm pb-1 hover:bg-secondary/20 rounded transition-colors">
                      <span className="text-muted-foreground">Open Position</span>
                      <span className="font-medium text-primary">
                        {openTrade.direction} · {fmtCur(openTrade.avgCost)}
                      </span>
                    </Link>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
