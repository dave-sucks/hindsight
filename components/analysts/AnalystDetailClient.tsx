"use client";

import { useState, useMemo, useEffect, useTransition, type ReactNode } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnalystConfigSheet } from "@/components/analysts/AnalystConfigSheet";
import { StockSearch } from "@/components/stocks/StockSearch";
import { deleteAnalyst } from "@/lib/actions/analyst.actions";
import {
  addWatchlistItem,
  removeWatchlistItem,
  type WatchlistItemView,
} from "@/lib/actions/watchlist.actions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RunResearchButton } from "@/components/RunResearchButton";
import { RunDiscoveryButton } from "@/components/RunDiscoveryButton";
import { Sheet, SheetContent, SheetClose, SheetTitle } from "@/components/ui/sheet";
import { TeamSheetContent } from "@/components/domain/team-card";
import { getTeam } from "@/lib/agent/workflow-registry";
import { TradeRow, WatchlistRow, AddStockRow } from "@/components/ui/trade-row";
import { closeTrade } from "@/lib/actions/closeTrade.actions";
import { ChipTabs } from "@/components/ui/chip-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Settings2,
  FileText,
  Eye,
  X,
  Pencil,
  Trash2,
  Loader2,
  EllipsisVertical,
  ScanSearch,
  Rocket,
  ShieldOff,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { EducationEmptyState } from "@/components/domain/education-card";
import { RunShowcaseTrigger } from "@/components/domain/run-showcase-trigger";
import { RunShowcaseDialog } from "@/components/domain/showcase-dialog";
import { ShowcaseIcon } from "@/components/ui/showcase-icon";
import { PromoteAnalystDialog } from "@/components/analysts/PromoteAnalystDialog";
import type {
  AnalystDetail,
  PositionWithThesis,
} from "@/lib/actions/analyst.actions";
import type { TriggerDefaultsView } from "@/lib/agent/triggers/defaults-preview";
import { cn, PNL_HEX, pnlBadgeClasses } from "@/lib/utils";
import { formatCurrency, formatDateLabel } from "@/lib/format";
import { useRouter } from "next/navigation";
import { ChatEntryComposer } from "@/components/assistant-ui/chat-entry-composer";
import { ThesisRow, type ThesisRowData } from "@/components/ui/thesis-row";
import type { ThesisCardData } from "@/components/agent/sheets/ThesisSheet";
import type { StockCandle } from "@/lib/actions/finnhub.actions";

const THESIS_PAGE_SIZE = 10;
type QuoteMap = Record<string, { price: number; change: number; changePct: number }>;

function thesisCardToRowData(
  t: ThesisCardData,
  candles?: StockCandle[],
  quote?: { price: number; change: number; changePct: number },
): ThesisRowData {
  return {
    id: t.thesis_id ?? t.ticker,
    ticker: t.ticker,
    direction: t.direction,
    status: t.status,
    confidenceScore: t.confidence_score,
    reasoningSummary: t.reasoning_summary ?? "",
    entryPrice: t.entry_price ?? null,
    targetPrice: t.target_price ?? null,
    stopLoss: t.stop_loss ?? null,
    companyName: t.company_name ?? null,
    thesisBullets: t.thesis_bullets,
    riskFlags: t.risk_flags,
    createdAt: t.created_at ?? null,
    candles,
    currentPrice: quote?.price ?? null,
    priceChange: quote ? { amount: quote.change, percent: quote.changePct } : null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RANGES = ["1W", "1M", "3M", "1Y", "Max"] as const;
type Range = (typeof RANGES)[number];

const RANGE_DAYS: Record<Range, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  Max: 99999,
};

function sliceByRange(
  data: { date: string; value: number }[],
  range: Range,
) {
  const cutoffMs = Date.now() - RANGE_DAYS[range] * 86_400_000;
  const filtered = data.filter(
    (d) => new Date(d.date + "T12:00:00").getTime() >= cutoffMs,
  );
  return filtered.length > 1 ? filtered : data.slice(-2);
}

// ── Sidebar trade row (uses shared TradeRow component) ───────────────────────

// Map the real Position.status (+ outcome for closed wins/losses) to TradeRow's
// display key. The trivial enum → display map TradeRow's dot/label needs — not a
// fictional combined status. Held=OPEN, proposal=PENDING, closed splits on the
// real `outcome` field.
function tradeRowStatus(status: string, outcome: string | null): string {
  if (status === "OPEN") return "OPEN";
  if (status === "PENDING_APPROVAL") return "PENDING";
  if (status === "CANCELLED") return "CANCELLED";
  if (outcome === "WIN") return "CLOSED_WIN";
  if (outcome === "LOSS") return "CLOSED_LOSS";
  return "CLOSED_EXPIRED";
}

function AnalystTradeRow({ trade, livePrice }: { trade: PositionWithThesis; livePrice?: number }) {
  const [isClosing, startClose] = useTransition();
  const isOpen = trade.status === "OPEN";

  const handleClose = () => {
    startClose(async () => {
      try {
        await closeTrade(trade.id, "MANUAL");
        toast.success(`Closed ${trade.symbol}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to close trade");
      }
    });
  };
  void isClosing;
  const currentPrice = isOpen ? (livePrice ?? trade.avgCost) : (trade.closePrice ?? trade.avgCost);
  const pnl = isOpen
    ? (currentPrice - trade.avgCost) * trade.quantity * (trade.direction === "SHORT" ? -1 : 1)
    : (trade.realizedPnl ?? 0);
  const price = currentPrice;
  // For closed trades use realizedPnl/cost-basis (works even when closePrice is null).
  // For open trades use price delta (only valid when we have a live price).
  const pnlPct = isOpen
    ? (trade.avgCost > 0
        ? ((price - trade.avgCost) / trade.avgCost) * 100 * (trade.direction === "SHORT" ? -1 : 1)
        : 0)
    : (trade.avgCost > 0 && trade.quantity > 0
        ? ((trade.realizedPnl ?? 0) / (trade.avgCost * trade.quantity)) * 100
        : 0);

  // Show P&L for closed trades always (realizedPnl from DB); for open trades only
  // when we have a live price (otherwise we'd show a stale entry-price delta as $0).
  const hasPnl = !isOpen || livePrice !== undefined;

  return (
    <TradeRow
      id={trade.id}
      ticker={trade.symbol}
      currentPrice={price}
      entryPrice={trade.avgCost}
      shares={trade.quantity}
      pnl={hasPnl ? pnl : 0}
      pnlPct={hasPnl ? pnlPct : 0}
      status={tradeRowStatus(trade.status, trade.outcome)}
      closedAt={trade.closedAt?.toISOString()}
      priceSource={isOpen ? (livePrice !== undefined ? "alpaca" : "missing") : undefined}
      onClose={isOpen ? handleClose : undefined}
      pendingProposal={trade.pendingProposal}
      thesisId={trade.thesis?.id || undefined}
      direction={trade.direction as "LONG" | "SHORT" | undefined}
    />
  );
}

// ── Floating composer (redirects to editor page on send) ─────────────────

function FloatingEditorComposer({ analystId }: { analystId: string }) {
  return (
    <ChatEntryComposer
      targetUrl={`/analysts/${analystId}/edit`}
      queryParam="message"
      features={{
        placeholder: "Ask a question or suggest strategy changes…",
        tickerSearch: true,
        slashCommands: true,
      }}
    />
  );
}

// ── Theses tab + Snapshot (both are thesis grids) ────────────────────────────

type ThesisStatusFilter = "all" | "holding" | "watching" | "passed" | "retired";
type SidebarBucket = "active" | "watching" | "closed";

const THESIS_FILTER_OPTIONS: { value: ThesisStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "holding", label: "Holding" },
  { value: "watching", label: "Watching" },
  { value: "passed", label: "Passed" },
  { value: "retired", label: "Retired" },
];

/** A thesis is "active" (Snapshot view) when it's a held or watched name. */
function isActiveThesis(t: ThesisCardData): boolean {
  return t.status === "HOLDING" || t.status === "WATCHING";
}

function matchesThesisFilter(t: ThesisCardData, f: ThesisStatusFilter): boolean {
  if (f === "all") return true;
  if (f === "holding") return t.status === "HOLDING";
  if (f === "watching") return t.status === "WATCHING";
  if (f === "passed") return t.status === "PASSED";
  if (f === "retired") return t.status === "RETIRED";
  return true;
}

/** The thesis grid + empty state. Shared by Snapshot (active) and Theses (all). */
function ThesesGrid({ theses, emptyLabel }: { theses: ThesisCardData[]; emptyLabel: string }) {
  const [page, setPage] = useState(0);
  const [candlesByTicker, setCandlesByTicker] = useState<Record<string, StockCandle[]>>({});
  const [quotesByTicker, setQuotesByTicker] = useState<QuoteMap>({});

  // Reset to page 0 when the thesis list changes (e.g. status filter changes).
  useEffect(() => { setPage(0); }, [theses]);

  const pageCount = Math.max(1, Math.ceil(theses.length / THESIS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedTheses = theses.slice(safePage * THESIS_PAGE_SIZE, (safePage + 1) * THESIS_PAGE_SIZE);

  // Candles: only the visible page's WATCHING/HOLDING rows, exactly like the
  // homepage Theses tab. One request, ≤10 symbols, 40-day window.
  const chartTickers = useMemo(
    () => [...new Set(
      pagedTheses
        .filter((t) => t.status === "WATCHING" || t.status === "HOLDING")
        .map((t) => t.ticker),
    )].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pagedTheses.map((t) => t.ticker).join(",")],
  );
  const chartKey = chartTickers.join(",");

  useEffect(() => {
    if (!chartKey) return;
    let cancelled = false;
    fetch(`/api/stocks/candles?symbols=${encodeURIComponent(chartKey)}&days=40`)
      .then(async (r) => {
        if (!r.ok) return;
        const json = (await r.json()) as { candles: Record<string, StockCandle[]> };
        // Merge so paging back doesn't refetch already-loaded names.
        if (!cancelled) setCandlesByTicker((prev) => ({ ...prev, ...json.candles }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [chartKey]);

  // Quotes for all visible tickers (price + day change header).
  const quoteTickers = useMemo(
    () => [...new Set(pagedTheses.map((t) => t.ticker))].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pagedTheses.map((t) => t.ticker).join(",")],
  );
  const quoteKey = quoteTickers.join(",");

  useEffect(() => {
    if (!quoteKey) return;
    let cancelled = false;
    fetch(`/api/quotes?symbols=${encodeURIComponent(quoteKey)}`)
      .then(async (r) => {
        if (!r.ok) return;
        const json = (await r.json()) as { quotes: { symbol: string; price: number; change: number; changePct: number }[] };
        if (!cancelled) {
          const map: QuoteMap = {};
          for (const q of json.quotes) map[q.symbol.toUpperCase()] = q;
          setQuotesByTicker((prev) => ({ ...prev, ...map }));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [quoteKey]);

  if (theses.length === 0) {
    return (
      <div className="w-full mx-auto px-4 py-6">
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full mx-auto px-4 py-6 space-y-2">
      {pagedTheses.map((t) => (
        <ThesisRow
          key={t.thesis_id ?? `${t.ticker}-${t.direction}`}
          thesis={thesisCardToRowData(
            t,
            candlesByTicker[t.ticker.toUpperCase()],
            quotesByTicker[t.ticker.toUpperCase()],
          )}
          showTicker
        />
      ))}
      {pageCount > 1 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground tabular-nums">
            {safePage * THESIS_PAGE_SIZE + 1}–{Math.min((safePage + 1) * THESIS_PAGE_SIZE, theses.length)} of {theses.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalystDetailClient({
  detail,
  hasRunning,
  initialWatchlist = [],
  livePrices = {},
  theses = [],
  runCards = [],
  triggerDefaults = null,
}: {
  detail: AnalystDetail;
  hasRunning: boolean;
  initialWatchlist?: WatchlistItemView[];
  livePrices?: Record<string, number>;
  theses?: ThesisCardData[];
  /** Server-rendered RunCard elements — the SAME card /runs uses. */
  runCards?: ReactNode[];
  /**
   * "Analyst Trigger Defaults" card data (GAPS P1-33), computed server-side
   * in the page (buildTriggerDefaultsView) and shown in the Settings sheet.
   */
  triggerDefaults?: TriggerDefaultsView | null;
}) {
  const { config: rawConfig, stats, recentTrades } = detail;

  // Defensive defaults for array fields that may be missing from older data
  const config = useMemo(() => ({
    ...rawConfig,
    sectors: rawConfig.sectors ?? [],
    signalTypes: rawConfig.signalTypes ?? [],
    holdDurations: rawConfig.holdDurations ?? [],
    watchlist: rawConfig.watchlist ?? [],
    exclusionList: rawConfig.exclusionList ?? [],
    dailyLossLimit: rawConfig.dailyLossLimit ?? 0,
  }), [rawConfig]);

  const router = useRouter();
  const [configOpen, setConfigOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [range, setRange] = useState<Range>("Max");
  // Theses tab status filter (mirrors the Findings filter pattern — a chip row
  // under the tab). Snapshot shows active (HOLDING+WATCHING) with no filter.
  const [thesisStatus, setThesisStatus] = useState<ThesisStatusFilter>("all");
  // Right-sidebar bucket: Active (open positions) / Watching / Closed.
  const [sidebarBucket, setSidebarBucket] = useState<SidebarBucket>("active");
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItemView[]>(initialWatchlist);
  const [, startTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [showRunShowcase, setShowRunShowcase] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);

  async function handleDelete() {
    setDeleteLoading(true);
    try {
      await deleteAnalyst(config.id);
      toast.success("Analyst deleted");
      router.push("/analysts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
      setDeleteLoading(false);
    }
  }

  const handleAddStock = (symbol: string) => {
    const upper = symbol.toUpperCase();
    if (watchlistItems.some((i) => i.symbol === upper)) return;
    // Optimistic add
    const tempItem: WatchlistItemView = {
      id: `temp-${upper}`,
      symbol: upper,
      reason: "Added manually",
      notes: null,
      addedBy: "USER",
      priority: "NORMAL",
      status: "WATCHING",
      thesisDirection: null,
      targetPrice: null,
      stopPrice: null,
      conviction: null,
      catalyst: null,
      lastReviewedAt: null,
      createdAt: new Date(),
      thesisCount: 0,
      latestThesis: null,
    };
    setWatchlistItems((prev) => [...prev, tempItem]);
    startTransition(async () => {
      const item = await addWatchlistItem(config.id, upper);
      // Replace temp item with real one
      setWatchlistItems((prev) =>
        prev.map((i) => (i.id === tempItem.id ? item : i)),
      );
    });
  };

  const handleRemoveStock = (symbol: string) => {
    setWatchlistItems((prev) => prev.filter((i) => i.symbol !== symbol));
    startTransition(async () => {
      await removeWatchlistItem(config.id, symbol);
    });
  };

  // ── Chart data ──────────────────────────────────────────────────────────
  const openPositions = recentTrades.filter((t) => t.status === "OPEN");
  const hasOpenPositions = openPositions.length > 0;
  // Sidebar tab partitions: Holding = open positions, Closed = sold positions.
  const holdingTrades = openPositions;
  const closedTrades = recentTrades.filter((t) => t.status === "CLOSED");

  // Compute total unrealized P&L from live prices
  const totalUnrealizedPnl = useMemo(() => {
    return openPositions.reduce((sum, t) => {
      const lp = livePrices[t.symbol];
      if (lp == null) return sum;
      const dir = t.direction === "SHORT" ? -1 : 1;
      return sum + (lp - t.avgCost) * t.quantity * dir;
    }, 0);
  }, [openPositions, livePrices]);

  // Total cost basis for open positions (initial investment)
  const totalCostBasis = useMemo(() => {
    return openPositions.reduce((sum, t) => sum + t.avgCost * t.quantity, 0);
  }, [openPositions]);

  // Current portfolio value from live prices
  const totalCurrentValue = useMemo(() => {
    return openPositions.reduce((sum, t) => {
      const lp = livePrices[t.symbol] ?? t.avgCost;
      return sum + lp * t.quantity;
    }, 0);
  }, [openPositions, livePrices]);

  const equityData = useMemo(() => {
    const closed = recentTrades
      .filter((t) => t.closedAt && t.realizedPnl != null)
      .sort(
        (a, b) =>
          new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime(),
      );

    const points: { date: string; pnl: number; value: number }[] = [];

    // Start at 0 P&L on the earliest trade open date
    const allTrades = [...recentTrades].sort(
      (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime(),
    );
    if (allTrades.length > 0) {
      points.push({
        date: new Date(allTrades[0].openedAt).toISOString().slice(0, 10),
        pnl: 0,
        value: 0,
      });
    }

    // Add closed trade points (cumulative realized P&L from 0 baseline)
    let cum = 0;
    for (const t of closed) {
      cum += t.realizedPnl!;
      points.push({
        date: new Date(t.closedAt!).toISOString().slice(0, 10),
        pnl: cum,
        value: cum,
      });
    }

    // Add today's point including unrealized P&L from open positions
    const today = new Date().toISOString().slice(0, 10);
    const todayPnl = cum + totalUnrealizedPnl;
    const lastPoint = points[points.length - 1];
    if (!lastPoint || lastPoint.date !== today) {
      // Always add today if we have open positions or at least one trade
      if (hasOpenPositions || recentTrades.length > 0) {
        points.push({ date: today, pnl: todayPnl, value: todayPnl });
      }
    } else {
      lastPoint.pnl = todayPnl;
      lastPoint.value = todayPnl;
    }

    // Ensure at least 2 distinct points so the chart renders
    if (points.length === 1) {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      points.unshift({ date: yesterday, pnl: 0, value: 0 });
    }

    return points.length >= 2 ? points : [];
  }, [recentTrades, hasOpenPositions, totalUnrealizedPnl]);

  const filteredEquity = useMemo(
    () => sliceByRange(equityData, range),
    [equityData, range],
  );

  const chartDataKey = "pnl";
  const chartMode = "pnl";

  const equityStroke = useMemo(() => {
    if (equityData.length === 0) return PNL_HEX.positive;
    const last = equityData[equityData.length - 1];
    return last.pnl >= 0 ? PNL_HEX.positive : PNL_HEX.negative;
  }, [equityData]);

  // ── Display values ──────────────────────────────────────────────────────
  const totalPnl = stats.totalPnl + totalUnrealizedPnl;
  const hasTrades = stats.totalTrades > 0 || hasOpenPositions;
  const pnlColorClass = hasTrades
    ? totalPnl >= 0 ? "text-positive" : "text-negative"
    : "text-muted-foreground";
  // Both modes show total P&L (realized + unrealized) since the chart tracks
  // cumulative P&L from 0. "Value" mode uses the last equity point (same number)
  // so the overlay always reflects what the chart end-point actually shows.
  const overlayValue = hasTrades
    ? (totalPnl >= 0 ? "+" : "") + formatCurrency(totalPnl)
    : "$0.00";
  const overlayLabel = "P&L";
  const overlayColorClass = pnlColorClass;

  return (
    <>
      <RunShowcaseTrigger />
      <RunShowcaseDialog open={showRunShowcase} onOpenChange={setShowRunShowcase} />
      <div className="lg:grid lg:grid-cols-3 h-[calc(100dvh-3rem)] overflow-y-auto lg:overflow-hidden">
        {/* ── Left: Analyst briefing ──────────────────────────────────── */}
        <div className="lg:col-span-2 lg:h-full flex flex-col lg:min-h-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 p-4">
            {/* Left Side Analyst Name */}
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-base font-brand font-semibold truncate">{config.name}</h1>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    config.enabled
                      ? "bg-positive"
                      : "bg-muted-foreground/40",
                  )}
                />
                {config.tradingEnvironment === "LIVE" && (
                  <Badge variant="destructive">LIVE</Badge>
                )}
                {stats.promotedCount > 0 && (
                  <Badge variant="secondary">
                    {stats.promotedCount} promoted
                  </Badge>
                )}
                {hasRunning && (
                  <Badge
                    variant="secondary"
                  >
                    Research Running…
                  </Badge>
                )}
              </div>
              {/* Stats strip */}
              <div className="flex items-center gap-3 flex-wrap">
                {[
                  { label: "Runs", value: String(stats.totalRuns) },
                  { label: "Theses", value: String(stats.totalTheses) },
                  { label: "Trades", value: String(stats.totalTrades) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex gap-1 font-mono text-[11px] uppercase text-muted-foreground leading-tight">
                    <p className="tabular-nums">{value}</p>
                    <p>{label}</p>
                  </div>
                ))}
              </div>
            </div>
            {/* Right Side Settings, Menu, and Run Research Button */}
            <div className="flex items-center gap-1 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger render={
                  <Button variant="ghost" size="icon-sm">
                    <EllipsisVertical />
                  </Button>
                } />
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => router.push(`/analysts/${config.id}/edit`)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setConfigOpen(true)}>
                    <Settings2 className="h-3.5 w-3.5" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setPromoteOpen(true)}>
                    {config.tradingEnvironment === "LIVE" ? (
                      <>
                        <ShieldOff className="h-3.5 w-3.5" />
                        Demote to paper
                      </>
                    ) : (
                      <>
                        <Rocket className="h-3.5 w-3.5" />
                        Promote to live
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowRunShowcase(true)}>
                    <ShowcaseIcon className="h-3.5 w-3.5" />
                    How Runs Work
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setOverviewOpen(true)}>
                    <ScanSearch className="h-3.5 w-3.5" />
                    Run Workflow
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-negative focus:text-negative"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete analyst
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <RunDiscoveryButton analystId={config.id} />
              <RunResearchButton
                analystId={config.id}
                hasRunning={hasRunning}
              />
            </div>
          </div>

          {/* ── Tabs: Snapshot | Runs | Theses ─────
              Snapshot = active book (HOLDING + WATCHING theses). Theses = the
              full library with a status filter. The old Briefs + Findings tabs
              were removed (briefs → account Portfolio Digest; see GAPS P1-26).
              The tabs area owns the scroll; the column is a flex column so the
              composer below stays anchored to the bottom. */}
          <Tabs defaultValue={0} className="flex-1 lg:min-h-0 lg:overflow-y-auto">
            <div className="px-4">
              <TabsList>
                <TabsTrigger value={0}>Snapshot</TabsTrigger>
                <TabsTrigger value={1}>Runs</TabsTrigger>
                <TabsTrigger value={2}>Theses</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value={0}>
              <ThesesGrid
                theses={theses.filter(isActiveThesis)}
                emptyLabel="No active theses — holdings and watched names appear here."
              />
            </TabsContent>
            <TabsContent value={1}>
              {runCards.length === 0 ? (
                <div className="w-full mx-auto px-4 py-6">
                  <div className="rounded-xl border bg-card p-8 text-center">
                    <p className="text-sm text-muted-foreground">No runs yet for this analyst.</p>
                  </div>
                </div>
              ) : (
                <div className="w-full mx-auto px-4 py-6 space-y-3">{runCards}</div>
              )}
            </TabsContent>
            <TabsContent value={2}>
              <div className="px-4 pt-4">
                <ChipTabs<ThesisStatusFilter>
                  options={THESIS_FILTER_OPTIONS}
                  value={thesisStatus}
                  onChange={(v) => v && setThesisStatus(v)}
                  clearable={false}
                />
              </div>
              <ThesesGrid
                theses={theses.filter((t) => matchesThesisFilter(t, thesisStatus))}
                emptyLabel={
                  thesisStatus === "all"
                    ? "No theses yet for this analyst."
                    : `No ${thesisStatus} theses.`
                }
              />
            </TabsContent>
          </Tabs>

          {/* ── Floating composer — desktop only ── */}
          <div className="hidden lg:block px-4 pb-4 shrink-0">
            <FloatingEditorComposer analystId={config.id} />
          </div>
        </div>

        {/* ── Right sidebar: portfolio-style ─────────────────────────────── */}
        <div className="p-4 lg:h-full">
          <div className="h-full rounded-xl border bg-background overflow-hidden flex flex-col">
            {/* Equity chart */}
            {equityData.length < 2 ? (
              <div className="h-[200px] shrink-0 relative">
                {/* Value overlay — matches filled chart style */}
                <div className="absolute top-2 left-2 right-2 z-10 flex items-start justify-between">
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-muted-foreground">$0</p>
                    <p className="text-[10px] text-muted-foreground">Value</p>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {hasOpenPositions ? "Updates on close" : "Waiting for first trade"}
                  </p>
                </div>
                <ChartContainer
                  config={{ value: { label: "Value", color: "var(--muted-foreground)" } } satisfies ChartConfig}
                  className="h-full w-full"
                >
                  <AreaChart
                    data={[
                      { date: "W1", value: 20 },
                      { date: "W2", value: 35 },
                      { date: "W3", value: 28 },
                      { date: "W4", value: 45 },
                      { date: "W5", value: 38 },
                      { date: "W6", value: 55 },
                      { date: "W7", value: 48 },
                      { date: "W8", value: 62 },
                    ]}
                    margin={{ top: 50, right: 0, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="emptyChartGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity={0.08} />
                        <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" hide />
                    <YAxis hide domain={[0, 80]} />
                    <Area
                      type="natural"
                      dataKey="value"
                      stroke="var(--muted-foreground)"
                      strokeWidth={1}
                      strokeOpacity={0.2}
                      fill="url(#emptyChartGrad)"
                      dot={false}
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
            ) : (
              <div className="relative shrink-0">
                {/* Value/P&L overlay + mode toggle */}
                <div className="absolute top-2 left-2 right-2 z-10 flex items-start justify-between">
                  <div>
                    <p
                      className={cn(
                        "text-lg font-semibold tabular-nums",
                        overlayColorClass,
                      )}
                    >
                      {overlayValue}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{overlayLabel}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {stats.winRate != null && (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium tabular-nums",
                          pnlBadgeClasses(stats.winRate - 0.5),
                        )}
                      >
                        {Math.round(stats.winRate * 100)}%
                      </span>
                    )}
                  </div>
                </div>
                {/* Range tabs */}
                <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center justify-between">
                  <div className="flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-md border px-0.5 py-0.5">
                    {RANGES.map((r) => (
                      <button
                        key={r}
                        onClick={() => setRange(r)}
                        className={cn(
                          "px-1.5 py-0.5 text-[9px] rounded transition-colors",
                          range === r
                            ? "bg-muted text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <ChartContainer
                  config={{
                    pnl: { label: "P&L", color: equityStroke },
                  } satisfies ChartConfig}
                  className="h-[200px] w-full"
                >
                  <AreaChart
                    data={filteredEquity}
                    margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="analystEqGrad"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={equityStroke}
                          stopOpacity={0.15}
                        />
                        <stop
                          offset="100%"
                          stopColor={equityStroke}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" hide />
                    <YAxis
                      hide
                      domain={['auto', 'auto']}
                      padding={{ top: 20 }}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelFormatter={(l) => formatDateLabel(String(l))}
                          formatter={(value) => (
                            <span className="font-mono text-xs tabular-nums">
                              ${Number(value).toFixed(2)}
                            </span>
                          )}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey={chartDataKey}
                      stroke={equityStroke}
                      strokeWidth={1.5}
                      fill="url(#analystEqGrad)"
                      baseValue="dataMin"
                      dot={false}
                      activeDot={{ r: 2, fill: equityStroke }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
            )}

            {/* Sidebar buckets: Active | Watching | Closed — a single chip row
                (not nested tabs). Active + Closed are TRADES (open vs sold
                positions, rendered with their LIFETIME change); Watching is the
                watched-thesis list (rendered with the DAY's change). Every row
                is the same TradeRowShell-based component. */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="px-3 pt-2 pb-1 shrink-0">
                <ChipTabs<SidebarBucket>
                  options={[
                    { value: "active", label: "Active" },
                    { value: "watching", label: "Watching" },
                    { value: "closed", label: "Closed" },
                  ]}
                  value={sidebarBucket}
                  onChange={(v) => v && setSidebarBucket(v)}
                  clearable={false}
                />
              </div>

              <div className="flex-1 overflow-y-auto flex flex-col">
                {/* Active — open positions, lifetime change */}
                {sidebarBucket === "active" &&
                  (holdingTrades.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No open positions.
                    </div>
                  ) : (
                    holdingTrades.map((trade) => (
                      <AnalystTradeRow key={trade.id} trade={trade} livePrice={livePrices[trade.symbol]} />
                    ))
                  ))}

                {/* Watching — watched theses, day's change */}
                {sidebarBucket === "watching" && (
                  <>
                    {watchlistItems.length === 0 && (
                      <EducationEmptyState stateKey="analyst-watchlist" size="inline" />
                    )}
                    {watchlistItems.map((item) => (
                      <WatchlistRow
                        key={item.id}
                        ticker={item.symbol}
                        currentPrice={livePrices[item.symbol]}
                        direction={
                          // P1-24 B4: an unresearched seed has thesisDirection=null
                          // (new) or 'PENDING' (legacy). Normalize anything that
                          // isn't a committed LONG/SHORT to null — WatchlistRow
                          // renders explicit null as "Awaiting review".
                          item.thesisDirection === "LONG" ||
                          item.thesisDirection === "SHORT"
                            ? item.thesisDirection
                            : null
                        }
                        thesisId={item.thesisId}
                        onRemove={() => handleRemoveStock(item.symbol)}
                      />
                    ))}
                    <StockSearch
                      onSelect={handleAddStock}
                      excludeSymbols={watchlistItems.map((i) => i.symbol)}
                      trigger={<AddStockRow />}
                    />
                  </>
                )}

                {/* Closed — sold positions, lifetime realized change */}
                {sidebarBucket === "closed" &&
                  (closedTrades.length === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      No closed trades yet.
                    </div>
                  ) : (
                    closedTrades.map((trade) => (
                      <AnalystTradeRow key={trade.id} trade={trade} livePrice={livePrices[trade.symbol]} />
                    ))
                  ))}
              </div>
            </div>
          </div>
        </div>
        {/* End Sidebar */}
      </div>

      {/* Config Sheet */}
      <AnalystConfigSheet
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={config}
        livePrices={livePrices}
        triggerDefaults={triggerDefaults}
      />

      {/* Agent overview sheet */}
      <Sheet open={overviewOpen} onOpenChange={setOverviewOpen}>
        <SheetContent side="right" showCloseButton={false} className="w-full sm:max-w-md overflow-y-auto">
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <SheetTitle>Research Agent</SheetTitle>
            <SheetClose render={<Button variant="ghost" size="icon-sm" />}>
              <X className="h-4 w-4" />
            </SheetClose>
          </div>
          <div className="px-4 pb-6">
            <TeamSheetContent team={getTeam("agent")} />
          </div>
        </SheetContent>
      </Sheet>

      <PromoteAnalystDialog
        analystId={config.id}
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete {config.name}</DialogTitle>
            <DialogDescription>
              This will permanently delete this analyst and all associated data:
              runs, theses, trades, events, and briefings. Any open Alpaca
              positions will be closed. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteLoading}
              className="gap-2"
            >
              {deleteLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {deleteLoading ? "Deleting…" : "Delete Analyst"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// The per-analyst Briefs + Findings sections were removed in the analyst-page
// tab cleanup (briefs → account Portfolio Digest; Findings → /intelligence). The
// underlying code is tracked for deletion in docs/GAPS.md → P1-26.
