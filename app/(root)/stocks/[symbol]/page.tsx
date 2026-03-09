import Link from "next/link";
import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import TradingViewWidget from "@/components/TradingViewWidget";
import { CANDLE_CHART_WIDGET_CONFIG } from "@/lib/constants";
import { getNews } from "@/lib/actions/finnhub.actions";
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
} from "lucide-react";

type MarketNewsArticle = {
  headline: string;
  source: string;
  datetime: number;
  url: string;
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums text-foreground">{value}</span>
    </div>
  );
}

async function NewsSection({ symbol }: { symbol: string }) {
  let news: MarketNewsArticle[] = [];
  try {
    news = await getNews([symbol]);
  } catch {
    news = [];
  }

  const displayed = news.slice(0, 3);

  if (displayed.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No recent news found for {symbol}.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {displayed.map((article, i) => (
        <div key={i}>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block hover:bg-secondary/20 rounded-lg p-3 -mx-3 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
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
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-1" />
            </div>
          </a>
          {i < displayed.length - 1 && <Separator />}
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

  // Fetch real trade and thesis data for this ticker
  const [tickerTrades, tickerTheses] = await Promise.all([
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

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Back nav */}
      <Link
        href="/stocks"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Stocks
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-4 justify-between">
        <div>
          <h1 className="text-3xl font-bold font-mono text-foreground">{upperSymbol}</h1>
        </div>
      </div>

      {/* TradingView chart — full width */}
      <TradingViewWidget
        scriptUrl="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js"
        config={CANDLE_CHART_WIDGET_CONFIG(upperSymbol)}
        className="custom-chart"
        height={400}
      />

      {/* Two-col below chart */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left (60%) */}
        <div className="lg:col-span-3 space-y-6">
          {/* Recent news */}
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium">Recent News</CardTitle>
            </CardHeader>
            <CardContent>
              <Suspense fallback={
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              }>
                <NewsSection symbol={upperSymbol} />
              </Suspense>
            </CardContent>
          </Card>
        </div>

        {/* Right (40%) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button className="w-full gap-2" render={<Link href={`/research?ticker=${upperSymbol}`} />}>
              <FlaskConical className="h-4 w-4" />
              Research This Stock
            </Button>
            <Button variant="outline" className="w-full gap-2 text-muted-foreground">
              <BookmarkPlus className="h-4 w-4" />
              Add to Watchlist
            </Button>
          </div>

          {/* Hindsight History */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-medium">Hindsight History</CardTitle>
              <p className="text-xs text-muted-foreground">
                {tickerTrades.length} trade{tickerTrades.length !== 1 ? "s" : ""} ·{" "}
                {tickerTheses.length} research run{tickerTheses.length !== 1 ? "s" : ""}
              </p>
            </CardHeader>
            <CardContent>
              {tickerTrades.length === 0 && tickerTheses.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No previous research or trades for {upperSymbol}.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Click &quot;Research This Stock&quot; to get started.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Research theses */}
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
                              thesis.direction === "LONG"
                                ? "border-primary/50 text-primary"
                                : "border-amber-500/50 text-amber-500"
                            )}
                          >
                            {thesis.direction}
                          </Badge>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            Conf: {thesis.confidenceScore}%
                          </span>
                          {thesis.researchRun?.source === "AGENT" && (
                            <Badge variant="secondary" className="text-xs">AI</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {thesis.reasoningSummary.slice(0, 80)}…
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                          {new Date(thesis.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                    </Link>
                  ))}

                  {/* Past trades */}
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
                                trade.direction === "LONG"
                                  ? "border-primary/50 text-primary"
                                  : "border-amber-500/50 text-amber-500"
                              )}
                            >
                              {trade.direction}
                            </Badge>
                            {!isOpen && (
                              <span className={cn("text-xs font-medium tabular-nums", pnlPos ? "text-emerald-500" : "text-red-500")}>
                                {pnlPos ? "+" : ""}{pnlPct.toFixed(2)}%
                              </span>
                            )}
                            <Badge
                              variant="outline"
                              className="text-xs text-muted-foreground border-muted-foreground/30"
                            >
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
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
