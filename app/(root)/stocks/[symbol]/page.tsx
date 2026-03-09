import Link from "next/link";
import { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import TradingViewWidget from "@/components/TradingViewWidget";
import {
  CANDLE_CHART_WIDGET_CONFIG,
  TECHNICAL_ANALYSIS_WIDGET_CONFIG,
  COMPANY_FINANCIALS_WIDGET_CONFIG,
} from "@/lib/constants";
import { getNews, getStockProfile, getStockQuote, getStockMetrics } from "@/lib/actions/finnhub.actions";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ExternalLink,
  FlaskConical,
  BookmarkPlus,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

// ─── Data types ─────────────────────────────────────────────────────────────

type MarketNewsArticle = {
  headline: string;
  source: string;
  datetime: number;
  url: string;
};

// ─── Sub-components ──────────────────────────────────────────────────────────

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
  const [profile, quote, metrics, tickerTrades, tickerTheses] = await Promise.all([
    getStockProfile(upperSymbol),
    getStockQuote(upperSymbol),
    getStockMetrics(upperSymbol),
    userId
      ? prisma.trade.findMany({
          where: { userId, ticker: upperSymbol },
          orderBy: { openedAt: "desc" },
          take: 20,
          select: {
            id: true,
            direction: true,
            status: true,
            outcome: true,
            entryPrice: true,
            closePrice: true,
            realizedPnl: true,
            shares: true,
            openedAt: true,
          },
        })
      : Promise.resolve([]),
    userId
      ? prisma.thesis.findMany({
          where: { userId, ticker: upperSymbol },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            direction: true,
            confidenceScore: true,
            reasoningSummary: true,
            createdAt: true,
            researchRun: { select: { source: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  // Format helpers
  const fmt = (n: number | null | undefined, digits = 2) =>
    n != null ? n.toFixed(digits) : "—";
  const fmtPct = (n: number | null | undefined) =>
    n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "—";
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

  // Key stats row values
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
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      {/* Back nav */}
      <Link
        href="/stocks"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Stocks
      </Link>

      {/* Company Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            {profile?.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.logo} alt={profile.name} className="h-8 w-8 rounded object-contain bg-muted p-0.5" />
            )}
            <h1 className="text-xl font-bold font-mono text-foreground">{upperSymbol}</h1>
            {profile?.name && (
              <span className="text-sm text-muted-foreground">{profile.name}</span>
            )}
            {profile?.exchange && (
              <Badge variant="outline" className="text-xs font-normal">
                {profile.exchange}
              </Badge>
            )}
          </div>

          {/* Live price */}
          {price != null && (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {fmtCur(price)}
              </span>
              <span className={cn("text-sm font-medium tabular-nums flex items-center gap-0.5", isUp ? "text-emerald-500" : "text-red-500")}>
                {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {fmtCur(change)} ({fmtPct(changePct)})
              </span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0 mt-1">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" render={<Link href={`/research?ticker=${upperSymbol}`} />}>
            <FlaskConical className="h-3.5 w-3.5" />
            Research
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" />}>
                <BookmarkPlus className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>Add to Watchlist</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="h-8 gap-0 rounded-none border-b bg-transparent p-0 w-full justify-start">
          {["overview", "financials", "news", "hindsight"].map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              className="rounded-none border-b-2 border-transparent px-4 py-1.5 text-xs font-medium capitalize data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              {tab === "hindsight" ? "Hindsight" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── OVERVIEW ─────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {/* Chart */}
          <TradingViewWidget
            scriptUrl="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
            config={CANDLE_CHART_WIDGET_CONFIG(upperSymbol)}
            className="custom-chart"
            height={400}
          />

          {/* Key stats bar */}
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

          {/* Main two-col */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* Left — News + Technical Analysis */}
            <div className="lg:col-span-3 space-y-4">
              {/* Technical Analysis */}
              <TradingViewWidget
                scriptUrl="https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js"
                config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(upperSymbol)}
                height={400}
              />

              {/* Recent News */}
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
            </div>

            {/* Right — Company Info + Hindsight */}
            <div className="lg:col-span-2 space-y-4">
              {/* Company Info */}
              {profile && (
                <Card className="border-border">
                  <CardContent className="px-4 pt-4 pb-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">Company Info</p>
                    <div className="space-y-0">
                      {[
                        { label: "Symbol", value: upperSymbol },
                        { label: "Exchange", value: profile.exchange || "—" },
                        { label: "Industry", value: profile.finnhubIndustry || "—" },
                        { label: "IPO Date", value: profile.ipo || "—" },
                        { label: "Country", value: profile.country || "—" },
                        { label: "Currency", value: profile.currency || "—" },
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

              {/* Hindsight History */}
              <Card className="border-border">
                <CardContent className="px-4 pt-4 pb-3">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Hindsight History</p>
                    <span className="text-xs text-muted-foreground">
                      {tickerTrades.length}t · {tickerTheses.length}r
                    </span>
                  </div>
                  {tickerTrades.length === 0 && tickerTheses.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      No history yet. Click Research to get started.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {tickerTheses.slice(0, 3).map((thesis) => (
                        <Link
                          key={thesis.id}
                          href={`/research/${thesis.id}`}
                          className="flex items-start gap-2 p-2 rounded border border-border hover:bg-secondary/30 transition-colors"
                        >
                          <FlaskConical className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] px-1.5 py-0",
                                  thesis.direction === "LONG" ? "border-primary/50 text-primary" : "border-amber-500/50 text-amber-500"
                                )}
                              >
                                {thesis.direction}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground tabular-nums">
                                {thesis.confidenceScore}% conf
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {thesis.reasoningSummary.slice(0, 60)}…
                            </p>
                          </div>
                        </Link>
                      ))}
                      {tickerTrades.slice(0, 3).map((trade) => {
                        const isOpen = trade.status === "OPEN";
                        const pnl = trade.realizedPnl ?? 0;
                        const pnlPos = pnl >= 0;
                        return (
                          <Link
                            key={trade.id}
                            href={`/trades/${trade.id}`}
                            className="flex items-start gap-2 p-2 rounded border border-border hover:bg-secondary/30 transition-colors"
                          >
                            {trade.outcome === "WIN" ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                            ) : trade.outcome === "LOSS" ? (
                              <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                            ) : (
                              <Clock className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className={cn("text-[10px] px-1.5 py-0", trade.direction === "LONG" ? "border-primary/50 text-primary" : "border-amber-500/50 text-amber-500")}
                                >
                                  {trade.direction}
                                </Badge>
                                {!isOpen && (
                                  <span className={cn("text-[10px] font-medium tabular-nums", pnlPos ? "text-emerald-500" : "text-red-500")}>
                                    {pnlPos ? "+" : ""}{pnl.toFixed(2)}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                                Entry {fmtCur(trade.entryPrice)}
                                {trade.closePrice && ` → ${fmtCur(trade.closePrice)}`}
                              </p>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ── FINANCIALS ───────────────────────────────────────────────── */}
        <TabsContent value="financials" className="mt-4">
          <TradingViewWidget
            scriptUrl="https://s3.tradingview.com/external-embedding/embed-widget-financials.js"
            config={COMPANY_FINANCIALS_WIDGET_CONFIG(upperSymbol)}
            height={500}
          />
        </TabsContent>

        {/* ── NEWS ─────────────────────────────────────────────────────── */}
        <TabsContent value="news" className="mt-4 max-w-3xl">
          <Suspense fallback={
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          }>
            <NewsTab symbol={upperSymbol} />
          </Suspense>
        </TabsContent>

        {/* ── HINDSIGHT ────────────────────────────────────────────────── */}
        <TabsContent value="hindsight" className="mt-4 max-w-3xl">
          {tickerTrades.length === 0 && tickerTheses.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No previous research or trades for {upperSymbol}.</p>
              <p className="text-xs text-muted-foreground mt-1">Click Research to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tickerTheses.map((thesis) => (
                <Link
                  key={thesis.id}
                  href={`/research/${thesis.id}`}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors"
                >
                  <FlaskConical className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs",
                          thesis.direction === "LONG" ? "border-primary/50 text-primary" : "border-amber-500/50 text-amber-500"
                        )}
                      >
                        {thesis.direction}
                      </Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">Conf: {thesis.confidenceScore}%</span>
                      {thesis.researchRun?.source === "AGENT" && (
                        <Badge variant="secondary" className="text-xs">AI</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{thesis.reasoningSummary.slice(0, 80)}…</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      {new Date(thesis.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </Link>
              ))}
              {tickerTrades.map((trade) => {
                const isOpen = trade.status === "OPEN";
                const isWin = trade.outcome === "WIN";
                const isLoss = trade.outcome === "LOSS";
                const pnl = trade.realizedPnl ?? 0;
                const positionCost = trade.entryPrice * trade.shares;
                const pnlPct = positionCost > 0 ? (pnl / positionCost) * 100 : 0;
                const pnlPos = pnl >= 0;
                return (
                  <Link
                    key={trade.id}
                    href={`/trades/${trade.id}`}
                    className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-secondary/30 transition-colors"
                  >
                    {isWin ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                    ) : isLoss ? (
                      <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                    ) : (
                      <Clock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            trade.direction === "LONG" ? "border-primary/50 text-primary" : "border-amber-500/50 text-amber-500"
                          )}
                        >
                          {trade.direction}
                        </Badge>
                        {!isOpen && (
                          <span className={cn("text-xs font-medium tabular-nums", pnlPos ? "text-emerald-500" : "text-red-500")}>
                            {pnlPos ? "+" : ""}{pnlPct.toFixed(2)}%
                          </span>
                        )}
                        <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/30">
                          {isOpen ? "Open" : isWin ? "Win" : isLoss ? "Loss" : "Closed"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                        Entry ${trade.entryPrice.toFixed(2)}
                        {trade.closePrice && ` → Close $${trade.closePrice.toFixed(2)}`}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
