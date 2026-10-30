import Link from "next/link";
import { Suspense } from "react";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StockPageTabs } from "@/components/stocks/StockPageTabs";
import { WatchlistDropdown } from "@/components/stocks/WatchlistDropdown";
import { PinButton } from "@/components/stocks/PinButton";
import { TradeButton } from "@/components/trade/TradeButton";
import { TradeSummary } from "@/components/domain/trade-summary";
import { EarningsCard } from "@/components/domain/earnings-card";
import { AnalystConsensusWidget } from "@/components/domain/analyst-consensus";
import { StockFilingsSection } from "@/components/filings/StockFilingsSection";
import { StockIdentityHeader } from "@/components/domain/stock-identity-header";
import { ThesisHeader } from "@/components/domain/thesis-header";
import { StockThesisBody } from "@/components/stocks/StockThesisBody";
import { agentWatchDays } from "@/lib/agent/triggers/agent-watch";
import { thesisSheetStateSelect } from "@/lib/agent/thesis-sheet-state";
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
import { buildStockHistory } from "@/lib/stocks/stock-history";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import type { EarningsResponse, ThesisStatePosition } from "@/lib/types/thesis-sheet";
import { ExternalLink } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined, digits = 2) => (n != null ? n.toFixed(digits) : "—");
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
const pct = (n: number | null | undefined, digits = 1) => (n != null ? `${n.toFixed(digits)}%` : "—");

/** The details-card label every sidebar and research block uses. */
function BlockLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">{children}</p>;
}

/** One label · value row, the Trade Details pattern. */
function DetailRows({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <>
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between gap-3 text-sm border-b border-border pb-1 last:border-0">
          <span className="text-muted-foreground shrink-0">{label}</span>
          <span className="font-medium tabular-nums text-right min-w-0 truncate">{value}</span>
        </div>
      ))}
    </>
  );
}

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
              id: true,
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

  // The open position, in the shape the shared trade summary reads, with
  // the live P&L off this page's quote — the same card the trade page shows.
  const open = positions.find((p) => p.status === "OPEN") ?? null;
  const held: ThesisStatePosition | null = open
    ? {
        id: open.id,
        quantity: Number(open.quantity),
        avgCost: Number(open.avgCost),
        openedAt: open.openedAt.toISOString(),
        daysHeld: Math.max(0, Math.floor((Date.now() - open.openedAt.getTime()) / 86_400_000)),
        closed: false,
        outcome: open.outcome,
      }
    : null;
  const heldPnl =
    held && price != null
      ? {
          currentPrice: price,
          marketValue: price * held.quantity,
          unrealizedPnl: (price - held.avgCost) * held.quantity * (open?.direction === "SHORT" ? -1 : 1),
          unrealizedPnlPct: held.avgCost > 0 ? ((price - held.avgCost) / held.avgCost) * 100 * (open?.direction === "SHORT" ? -1 : 1) : null,
        }
      : null;

  // The live thesis — what Hindsight thinks of this stock right now. A
  // holding first, else the newest watch. With one, the page is the thesis
  // page with the stock's own content in its slots; without, the stock alone.
  const live = theses.find((t) => t.status === "HOLDING") ?? theses.find((t) => t.status === "WATCHING") ?? null;

  const website = profile?.weburl
    ? profile.weburl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
    : null;

  const stockDetails = (
      <Card className="bg-muted/40 p-2 gap-1">
        <BlockLabel>Stock details</BlockLabel>
        <DetailRows
          rows={[
            { label: "Exchange", value: identity.exchange ?? "—" },
            { label: "Industry", value: profile?.finnhubIndustry || "—" },
            { label: "Market cap", value: fmtBig(marketCap) },
            { label: "P/E", value: fmt(metrics?.["peBasicExclExtraTTM"]) },
            { label: "EPS", value: fmtCur(metrics?.["epsBasicExclExtraAnnual"]) },
            { label: "Dividend yield", value: pct(metrics?.["dividendYieldIndicatedAnnual"], 2) },
            {
              label: "52-week range",
              value:
                metrics?.["52WeekLow"] != null && metrics?.["52WeekHigh"] != null
                  ? `${fmtCur(metrics["52WeekLow"])} – ${fmtCur(metrics["52WeekHigh"])}`
                  : "—",
            },
            { label: "IPO", value: profile?.ipo || "—" },
            ...(website && profile?.weburl
              ? [
                  {
                    label: "Website",
                    value: (
                      <a
                        href={profile.weburl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        {website}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
  );

  const sidebar = (
    <>
      {held && heldPnl ? (
        <Link href={`/trades/${held.id}`} className="block">
          <TradeSummary
            look="card"
            position={held}
            pnl={heldPnl}
            pendingProposal={null}
            direction={open?.direction === "SHORT" ? "SHORT" : "LONG"}
          />
        </Link>
      ) : null}

      {stockDetails}

      <AnalystConsensusWidget coverage={coverage} currentPrice={price} />

      {earnings ? <EarningsCard data={earnings as unknown as EarningsResponse} /> : null}
    </>
  );

  const research = (
    <>
      <Card className="bg-muted/40 p-2 gap-1">
        <BlockLabel>Financials</BlockLabel>
        {metrics ? (
          <DetailRows
            rows={[
              { label: "P/E (TTM)", value: fmt(metrics["peBasicExclExtraTTM"]) },
              { label: "Forward P/E", value: fmt(metrics["peTTM"]) },
              { label: "P/B", value: fmt(metrics["pbAnnual"]) },
              { label: "P/S", value: fmt(metrics["psTTM"]) },
              { label: "EPS (TTM)", value: fmtCur(metrics["epsBasicExclExtraAnnual"]) },
              { label: "Return on equity", value: pct(metrics["roeRfy"]) },
              { label: "Return on assets", value: pct(metrics["roaRfy"]) },
              { label: "Gross margin", value: pct(metrics["grossMarginTTM"]) },
              { label: "Operating margin", value: pct(metrics["operatingMarginTTM"]) },
              { label: "Net margin", value: pct(metrics["netProfitMarginTTM"]) },
              { label: "Debt / equity", value: fmt(metrics["totalDebt/totalEquityAnnual"]) },
              { label: "Current ratio", value: fmt(metrics["currentRatioAnnual"]) },
              { label: "Beta", value: fmt(metrics["beta"]) },
            ].filter((r) => r.value !== "—")}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No financial data for {upperSymbol}.</p>
        )}
      </Card>
      <StockFilingsSection symbol={upperSymbol} />
    </>
  );

  const news = (
    <Suspense fallback={<Skeleton className="h-40 w-full rounded-lg" />}>
      <NewsRows symbol={upperSymbol} />
    </Suspense>
  );

  return (
    <div data-surface="paper">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <LiveRefresh />
        {/* The same header the trade page and the sheet render. href={null}:
            we're already on the stock page. */}
        <div className="mb-6">
          {live ? (
            <ThesisHeader
              ticker={upperSymbol}
              displayName={identity.companyName}
              exchange={identity.exchange}
              status={live.status}
              agentWatchDays={agentWatchDays(live.triggers)}
              conviction={(live.conviction ?? null) as "STRONG" | "HIGH" | "MEDIUM" | "LOW" | null}
              convictionRationale={live.convictionRationale ?? null}
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
          <StockThesisBody
            thesisId={live.id}
            positionId={open?.id}
            ticker={upperSymbol}
            history={history}
            research={research}
            news={news}
            aside={stockDetails}
          />
        ) : (
        <StockPageTabs
          overview={{
            ticker: upperSymbol,
            candles,
            price,
            dayChange: quote?.d ?? null,
            dayChangePct: quote?.dp ?? null,
            held: held && open ? { avgCost: held.avgCost, openedAt: held.openedAt, direction: open.direction === "SHORT" ? "SHORT" : "LONG" } : null,
          }}
          history={history}
          research={research}
          news={news}
          sidebar={sidebar}
        />
        )}
      </div>
    </div>
  );
}
