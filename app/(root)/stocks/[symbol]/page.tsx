import Link from "next/link";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StockLogo } from "@/components/StockLogo";
import { StockPriceChart } from "@/components/stocks/StockPriceChart";
import { WatchlistDropdown } from "@/components/stocks/WatchlistDropdown";
import {
  getNews,
  getStockProfile,
  getStockQuote,
  getStockMetrics,
  getStockCandles,
  getRecommendationTrends,
} from "@/lib/actions/finnhub.actions";
import { getWatchlistStatusForSymbol } from "@/lib/actions/watchlist.actions";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { SentimentBar } from "@/components/ui/segment-bar";
import {
  ExternalLink,
  TrendingUp,
  TrendingDown,
  ArrowRight,
} from "lucide-react";

// ─── Thesis verdict helper ───────────────────────────────────────────────────

function verdictLabel(direction: string, confidence: number): { label: string; color: string } {
  if (direction === "PASS") return { label: "Pass", color: "text-muted-foreground" };
  if (direction === "LONG") {
    if (confidence >= 80) return { label: "Strong Buy", color: "text-emerald-500" };
    if (confidence >= 60) return { label: "Buy", color: "text-emerald-500" };
    return { label: "Lean Buy", color: "text-emerald-500/70" };
  }
  if (confidence >= 80) return { label: "Strong Sell", color: "text-red-500" };
  if (confidence >= 60) return { label: "Sell", color: "text-red-500" };
  return { label: "Lean Sell", color: "text-red-500/70" };
}

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
  const userId = user?.id ?? "";

  // Fetch everything in parallel
  const [profile, quote, metrics, candles, recommendations, tickerTrades, tickerTheses, watchlistStatus] = await Promise.all([
    getStockProfile(upperSymbol),
    getStockQuote(upperSymbol),
    getStockMetrics(upperSymbol),
    getStockCandles(upperSymbol, 365),
    getRecommendationTrends(upperSymbol),
    userId
      ? prisma.position.findMany({
          where: { userId, symbol: upperSymbol },
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
    userId
      ? prisma.thesis.findMany({
          where: { userId, ticker: upperSymbol },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            direction: true,
            confidenceScore: true,
            reasoningSummary: true,
            createdAt: true,
            researchRunId: true,
            researchRun: { select: { source: true, agentConfigId: true, agentConfig: { select: { name: true } } } },
            status: true,
            parentThesisId: true,
            invalidatedAt: true,
            invalidReason: true,
            entryPrice: true,
            targetPrice: true,
            stopLoss: true,
            signalTypes: true,
          },
        })
      : Promise.resolve([]),
    userId ? getWatchlistStatusForSymbol(upperSymbol) : Promise.resolve([]),
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
  const isUp = (changePct ?? 0) >= 0;

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

  // Analyst consensus (latest period)
  const latestRec = recommendations?.[0] ?? null;
  const totalAnalysts = latestRec
    ? latestRec.strongBuy + latestRec.buy + latestRec.hold + latestRec.sell + latestRec.strongSell
    : 0;
  const bullish = latestRec ? latestRec.strongBuy + latestRec.buy : 0;
  const bearish = latestRec ? latestRec.strongSell + latestRec.sell : 0;
  const neutral = latestRec?.hold ?? 0;
  const consensus = bullish > bearish ? "Buy" : bearish > bullish ? "Sell" : "Hold";

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <StockLogo ticker={upperSymbol} size="lg" />
          <div>
            <h1 className="text-2xl font-semibold leading-tight">
              {profile?.name ?? upperSymbol}
            </h1>
            <p className="text-xs font-mono uppercase text-muted-foreground tracking-wide mt-0.5">
              {upperSymbol}
              {profile?.exchange ? ` · ${profile.exchange}` : ""}
            </p>
          </div>
        </div>

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
              {/* Price block */}
              {price != null && (
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-semibold tabular-nums">
                      {fmtCur(price)}
                    </span>
                    <span className={cn(
                      "text-sm font-medium tabular-nums flex items-center gap-0.5",
                      isUp ? "text-positive" : "text-negative",
                    )}>
                      {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {fmtCur(change)} ({change != null && changePct != null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` : "—"})
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
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

              {/* Latest Thesis — featured card */}
              {(() => {
                const latest = tickerTheses.find((t) => t.status === "ACTIVE" && t.direction !== "PASS") ?? tickerTheses[0];
                if (!latest) return null;
                const v = verdictLabel(latest.direction, latest.confidenceScore);
                return (
                  <Card>
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Our AI's Take</p>
                        <div className="flex items-center gap-2">
                          <span className={cn("text-sm font-semibold", v.color)}>{v.label}</span>
                          <span className="text-sm text-muted-foreground tabular-nums">{latest.confidenceScore}%</span>
                        </div>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">
                        {latest.reasoningSummary}
                      </p>
                      {(latest.entryPrice != null || latest.targetPrice != null || latest.stopLoss != null) && (
                        <div className="flex items-center gap-4 mt-3 text-xs tabular-nums">
                          {latest.entryPrice != null && (
                            <span className="text-muted-foreground">Entry <span className="text-foreground font-medium">${latest.entryPrice.toFixed(2)}</span></span>
                          )}
                          {latest.targetPrice != null && (
                            <span className="text-muted-foreground">Target <span className="text-emerald-500 font-medium">${latest.targetPrice.toFixed(2)}</span></span>
                          )}
                          {latest.stopLoss != null && (
                            <span className="text-muted-foreground">Stop <span className="text-red-500 font-medium">${latest.stopLoss.toFixed(2)}</span></span>
                          )}
                        </div>
                      )}
                      {tickerTheses.length > 1 && (
                        <div className="mt-3 pt-3 border-t">
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                            onClick={() => {
                              // Switch to theses tab — this is a server component so we use URL
                              const tabTrigger = document.querySelector('[data-value="theses"]') as HTMLElement;
                              tabTrigger?.click();
                            }}
                          >
                            View all {tickerTheses.length} analyses <ArrowRight className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
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
              {tickerTheses.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">No previous research for {upperSymbol}.</p>
                  <p className="text-xs text-muted-foreground mt-1">Click Research to get started.</p>
                </div>
              ) : (
                <Card>
                  <CardContent className="p-0">
                    {tickerTheses.map((thesis, i) => {
                      const isActive = thesis.status === "ACTIVE" && thesis.direction !== "PASS";
                      const dirColor = thesis.direction === "LONG"
                        ? "text-emerald-500"
                        : thesis.direction === "SHORT"
                        ? "text-red-500"
                        : "text-muted-foreground";

                      return (
                        <div
                          key={thesis.id}
                          className={cn(
                            "flex gap-4 px-5 py-4",
                            i < tickerTheses.length - 1 && "border-b border-border",
                          )}
                        >
                          {/* Date + dot column */}
                          <div className="w-16 shrink-0 pt-1 text-right">
                            <p className="text-xs text-muted-foreground font-medium">
                              {new Date(thesis.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </p>
                            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                              {new Date(thesis.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                            </p>
                          </div>

                          {/* Dot */}
                          <div className="flex flex-col items-center pt-2">
                            <div className={cn(
                              "h-2.5 w-2.5 rounded-full shrink-0",
                              isActive ? "bg-blue-400" : "bg-muted-foreground/30",
                            )} />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            {/* Verdict line */}
                            {(() => {
                              const v = verdictLabel(thesis.direction, thesis.confidenceScore);
                              return (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={cn("text-sm font-semibold", v.color)}>
                                    {v.label}
                                  </span>
                                  <span className="text-xs text-muted-foreground tabular-nums">{thesis.confidenceScore}% confidence</span>
                                  {thesis.entryPrice != null && (
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                      · Entry ${thesis.entryPrice.toFixed(2)}
                                    </span>
                                  )}
                                  {thesis.targetPrice != null && (
                                    <span className="text-xs text-emerald-500/70 tabular-nums">
                                      → ${thesis.targetPrice.toFixed(2)}
                                    </span>
                                  )}
                                  {thesis.status === "SUPERSEDED" && (
                                    <span className="text-xs text-amber-500">Superseded</span>
                                  )}
                                  {thesis.status === "INVALIDATED" && (
                                    <span className="text-xs text-red-500">Invalidated</span>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Reasoning paragraph */}
                            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                              {thesis.reasoningSummary}
                            </p>

                            {/* Analyst name */}
                            {thesis.researchRun?.agentConfig?.name && (
                              <p className="text-xs text-muted-foreground/50 mt-2">
                                {thesis.researchRun.agentConfig.name}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* ════ SIDEBAR ════ */}
        <div className="hidden lg:block space-y-4">
          {/* Company Info */}
          {profile && (
            <Card>
              <CardContent className="px-4 pt-4 pb-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Company Info</p>
                <div className="space-y-0">
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
                    <div key={label} className="flex items-center justify-between py-1.5 border-b last:border-0">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs font-medium text-foreground text-right max-w-[60%] truncate">{value}</span>
                    </div>
                  ))}
                </div>
                {profile.weburl && (
                  <a
                    href={profile.weburl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {profile.weburl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          {/* Analyst Consensus */}
          {latestRec && totalAnalysts > 0 && (
            <Card>
              <CardContent className="px-4 pt-4 pb-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Analyst Consensus</p>
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant={consensus === "Buy" ? "positive" : consensus === "Sell" ? "negative" : "outline"}>
                    {consensus}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{totalAnalysts} analysts</span>
                </div>
                <div className="flex items-center gap-3 text-xs mb-2">
                  <span className="text-red-500 tabular-nums">{bearish} <span className="text-muted-foreground">Bearish</span></span>
                  <span className="text-muted-foreground tabular-nums">{neutral} <span>Neutral</span></span>
                  <span className="text-emerald-500 tabular-nums">{bullish} <span className="text-muted-foreground">Bullish</span></span>
                </div>
                <SentimentBar
                  total={totalAnalysts}
                  ranges={[
                    { count: bearish, color: "bg-red-500" },
                    { count: neutral, color: "bg-muted-foreground/30" },
                    { count: bullish, color: "bg-emerald-500" },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {/* Hindsight Summary */}
          {(tickerTrades.length > 0 || tickerTheses.length > 0) && (
            <Card>
              <CardContent className="px-4 pt-4 pb-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Hindsight</p>
                <div className="space-y-0">
                  <div className="flex items-center justify-between py-1.5 border-b">
                    <span className="text-xs text-muted-foreground">Analyses</span>
                    <span className="text-xs font-medium tabular-nums">{tickerTheses.length}</span>
                  </div>
                  <div className="flex items-center justify-between py-1.5 border-b">
                    <span className="text-xs text-muted-foreground">Trades</span>
                    <span className="text-xs font-medium tabular-nums">{tickerTrades.length}</span>
                  </div>
                  {(() => {
                    const activeThesis = tickerTheses.find((t) => t.status === "ACTIVE" && t.direction !== "PASS");
                    if (!activeThesis) return null;
                    return (
                      <div className="flex items-center justify-between py-1.5 border-b">
                        <span className="text-xs text-muted-foreground">Current View</span>
                        <span className={cn("text-xs font-medium", activeThesis.direction === "LONG" ? "text-emerald-500" : "text-red-500")}>
                          {activeThesis.direction} {activeThesis.confidenceScore}%
                        </span>
                      </div>
                    );
                  })()}
                  {(() => {
                    const openTrade = tickerTrades.find((t) => t.status === "OPEN");
                    if (!openTrade) return null;
                    return (
                      <Link href={`/trades/${openTrade.id}`} className="flex items-center justify-between py-1.5 hover:bg-secondary/20 rounded transition-colors">
                        <span className="text-xs text-muted-foreground">Open Position</span>
                        <span className="text-xs font-medium text-blue-400">
                          {openTrade.direction} · {fmtCur(openTrade.avgCost)}
                        </span>
                      </Link>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
