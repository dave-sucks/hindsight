"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StockLogo } from "@/components/StockLogo";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { getTradeStatusDisplay } from "@/lib/trade-status";
import { cn, pnlColor } from "@/lib/utils";
import { PriceChange } from "@/components/ui/price-change";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { ChipTabs } from "@/components/ui/chip-tabs";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { moveDollar } from "@/lib/portfolio/move-dollar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatSignedCurrency } from "@/lib/format";
import { sharesLine, proposalTooltip } from "@/lib/trade-status";
import { StatusDot } from "@/components/ui/trade-row";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import type { ThesisCardData } from "@/components/agent/sheets/ThesisSheet";
import type { CoverageData, CoverageRow } from "@/lib/actions/coverage.actions";

// ─── Coverage Table (Feature B — docs/plans/PORTFOLIO_DIGEST.md) ──────────────

type Tab = "trades" | "sold" | "watching" | "passed";
type MobileView = "lifetime" | "1d";
/**
 * What the 1D/5D/30D columns say. A column of percents cannot show why a book
 * is down on a day most of its names are up — a −1.16% day on an $11,718
 * position outweighs a +0.86% one on $9,027. `$` turns the same three windows
 * into the money they moved, on the shares held now.
 */
type MoveMode = "pct" | "dollar";

// Moves under this magnitude read as "flat" — shown muted, not green/red.
const FLAT_BAND_PCT = 0.5;

// ── Status dot ───────────────────────────────────────────────────────────────
// Colour + hover line, from the same display map and wording TradeRow uses,
// so a name reads identically here and in the Pinned / Pending rails.
function statusDot(row: CoverageRow): { className: string; label: string } {
  // A pending action outranks the row's own state — amber is the app-wide
  // "waiting on you" colour, and it's what makes proposals skimmable here.
  const pp = row.pendingProposal;
  if (pp) {
    return {
      className: getTradeStatusDisplay("PENDING").dotClass,
      label: proposalTooltip(pp.intent, pp.executing),
    };
  }
  if (row.tradeState === "OPEN") {
    const cfg = getTradeStatusDisplay("OPEN");
    return { className: cfg.dotClass, label: cfg.timeLabel({ placedAt: row.anchorAt }) };
  }
  if (row.tradeState === "CLOSED") {
    const cfg = getTradeStatusDisplay((row.sinceDollar ?? 0) >= 0 ? "CLOSED_WIN" : "CLOSED_LOSS");
    return { className: cfg.dotClass, label: cfg.timeLabel({ closedAt: row.anchorAt }) };
  }
  const since = new Date(row.anchorAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (row.verdict != null) return { className: "bg-muted-foreground/40", label: `Passed ${since}` };
  return { className: "bg-sky-500", label: `Watching since ${since}` };
}

// ── 1D/5D/30D cell ───────────────────────────────────────────────────────────
// Same window either way; `mode` only changes the unit. A name with no shares
// has no dollars to show, so $ mode reads "—" on the Watching and Passed tabs.
// The flat band stays a PERCENT test in both modes — "did this barely move"
// is a question about the move, not about how much of it you own.
function Move({
  pct,
  row,
  mode,
}: {
  pct: number | null;
  row: CoverageRow;
  mode: MoveMode;
}) {
  if (pct == null) return <span className="text-muted-foreground/40">—</span>;
  const flat = Math.abs(pct) < FLAT_BAND_PCT;

  if (mode === "dollar") {
    const d = moveDollar({ shares: row.shares, currentPrice: row.currentPrice, pct });
    if (d == null) return <span className="text-muted-foreground/40">—</span>;
    // Money is TEXT, percent is a BADGE — the app's rule everywhere, and the
    // Lifetime column two cells over proves it: "+$87.68" plain beside a
    // "+0.88%" chip. The $ mode shipped dollars in badges and broke it.
    return (
      <span
        className={cn(
          "tabular-nums text-sm",
          flat ? "text-muted-foreground" : pnlColor(d),
        )}
      >
        {formatSignedCurrency(d)}
      </span>
    );
  }

  if (flat) return <span className="tabular-nums text-sm text-muted-foreground">{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</span>;
  return <PnlBadge value={pct} format="percent" className="text-xs" />;
}

// ── Name cell ─────────────────────────────────────────────────────────────────

function NameCell({ row }: { row: CoverageRow }) {
  let subhead: string;
  const pp = row.pendingProposal;
  if (pp) {
    // A proposal reads like any held row with its verb in front — "Sell 300
    // shares · $11,868.00". The amber dot is what says it's waiting on you.
    subhead = sharesLine({
      shares: pp.quantity,
      value: row.anchorPrice != null && row.tradeState != null ? row.anchorPrice * pp.quantity : null,
      intent: pp.intent,
      executing: pp.executing,
    });
  } else if (row.tradeState != null && row.shares != null && row.costBasis != null) {
    subhead = sharesLine({ shares: row.shares, value: row.costBasis });
  } else if (row.verdict != null && row.anchorPrice != null) {
    subhead = `Passed at $${row.anchorPrice.toFixed(2)}`;
  } else if (row.anchorPrice != null) {
    subhead = `Watching from $${row.anchorPrice.toFixed(2)}`;
  } else {
    subhead = "Watching";
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <StockLogo ticker={row.ticker} size="md" className="rounded-md" />
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{row.ticker}</span>
          <StatusDot {...statusDot(row)} />
        </div>
        <span
          className={cn(
            "text-xs tabular-nums truncate text-muted-foreground",
            // In flight — same shimmer the agent's running rows use.
            pp?.executing && "shimmer-text",
            // Waiting on your approval — a sweep every few seconds.
            pp && !pp.executing && "shimmer-text-periodic",
          )}
        >
          {subhead}
        </span>
      </div>
    </div>
  );
}

// ── Lifetime / 1D cell (last column) ─────────────────────────────────────────
// On desktop: just P&L (price has its own column).
// On mobile: price on top (since Price column is hidden), then P&L below.
// mobileView controls whether we show lifetime or 1D P&L.
function LifetimeCell({ row, mobileView }: { row: CoverageRow; mobileView: MobileView }) {
  const isLifetime = mobileView === "lifetime";
  const pct = isLifetime ? row.sincePct : row.oneDayPct;
  // Both tabs show dollars AND percent on a held name. The row carries the
  // day's move as a percent only, so the 1D tab used to be half a column next
  // to an All tab that had both — and on a phone those two tabs are the whole
  // table. A watched name has no shares, so it stays percent-only on both.
  const dollar =
    row.tradeState == null
      ? null
      : isLifetime
        ? row.sinceDollar
        : moveDollar({
            shares: row.shares,
            currentPrice: row.currentPrice,
            pct: row.oneDayPct,
          });

  return (
    <div className="flex flex-col items-end gap-0.5">
      {/* Price — only on mobile since desktop has a dedicated Price column */}
      {row.currentPrice != null && (
        <span className="md:hidden text-sm tabular-nums font-light">
          ${row.currentPrice.toFixed(2)}
        </span>
      )}
      <span className="inline-flex items-center gap-1.5 justify-end">
        {pct == null ? (
          <span className="text-muted-foreground/40 text-xs">—</span>
        ) : (
          <>
            {dollar != null && (
              <PriceChange dollarChange={dollar} percentChange={null} size="sm" arrowFirst />
            )}
            <PnlBadge value={pct} format="percent" className="text-xs" />
          </>
        )}
      </span>
    </div>
  );
}

// ── One tab's table ───────────────────────────────────────────────────────────
function CoverageTab({
  rows,
  tab,
  mode,
  emptyLabel,
  onRowClick,
}: {
  rows: CoverageRow[];
  tab: Tab;
  mode: MoveMode;
  emptyLabel: string;
  onRowClick: (row: CoverageRow) => void;
}) {
  const [mobileView, setMobileView] = useState<MobileView>("lifetime");

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden bg-card">
      {/* table-fixed + per-column widths so the momentum/price columns stay a
          constant size across the Trades/Sold/Watching/Passed tabs (the Gain column
          content varies by tab); Name + Gain absorb the remaining width. */}
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            {/* Price — hidden on mobile (it moves into the last column) */}
            <TableHead className="hidden md:table-cell w-24 text-right">Price</TableHead>
            {/* 1D/5D/30D — desktop only */}
            <TableHead className="hidden md:table-cell w-24 text-right">1D</TableHead>
            <TableHead className="hidden md:table-cell w-24 text-right">5D</TableHead>
            <TableHead className="hidden md:table-cell w-24 text-right">30D</TableHead>
            {/* Last column — "Lifetime" label on desktop, toggle on mobile.
                Sized to the gain + badge so the name column keeps the
                shares line instead of "300 sh…". */}
            <TableHead className="w-44 md:w-52 text-right">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="hidden md:inline cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4" />}
                  >
                    Lifetime
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end">
                    <p className="text-xs max-w-[200px]">
                      Total gain since the position was opened, the watch was started, or the name was passed. On a sold position, the realized gain.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {/* Mobile toggle — a view setting, so small Tabs like the %/$ */}
              <div className="md:hidden">
                <Tabs value={mobileView} onValueChange={(v) => setMobileView(v as MobileView)}>
                  <TabsList size="sm">
                    <TabsTrigger value="lifetime">All</TabsTrigger>
                    <TabsTrigger value="1d">1D</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.key}
              className="cursor-pointer"
              onClick={() => onRowClick(row)}
            >
              <TableCell>
                <NameCell row={row} />
              </TableCell>
              <TableCell className="hidden md:table-cell text-right text-sm tabular-nums font-light">
                {row.currentPrice != null ? `$${row.currentPrice.toFixed(2)}` : "—"}
              </TableCell>
              <TableCell className="hidden md:table-cell text-right">
<Move pct={row.oneDayPct} row={row} mode={mode} />
              </TableCell>
              <TableCell className="hidden md:table-cell text-right">
<Move pct={row.fiveDayPct} row={row} mode={mode} />
              </TableCell>
              <TableCell className="hidden md:table-cell text-right">
<Move pct={row.thirtyDayPct} row={row} mode={mode} />
              </TableCell>
              <TableCell className="text-right">
                <LifetimeCell row={row} mobileView={mobileView} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {(tab === "trades" || tab === "sold") && (
        <div className="border-t p-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            render={<Link href="/trades" />}
          >
            All trades
          </Button>
        </div>
      )}
    </div>
  );
}

/** Minimal ThesisCardData to seed the sheet — it fetches the rest by id. */
function seedFor(row: CoverageRow): ThesisCardData {
  const status: ThesisCardData["status"] =
    row.tradeState === "OPEN"
      ? "HOLDING"
      : row.tradeState === "CLOSED"
        ? "RETIRED"
        : row.verdict != null
          ? "PASSED"
          : "WATCHING";
  return {
    thesis_id: row.thesisId ?? undefined,
    ticker: row.ticker,
    direction: row.direction === "LONG" || row.direction === "SHORT" ? row.direction : null,
    confidence_score: 0,
    status,
  };
}

const COVERAGE_TABS: { value: Tab; label: string }[] = [
  { value: "trades", label: "Trades" },
  { value: "sold", label: "Sold" },
  { value: "watching", label: "Watching" },
  { value: "passed", label: "Passed" },
];

export default function CoverageTable({ data }: { data: CoverageData }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("trades");
  // Percent or dollars for the 1D/5D/30D columns. Lives here because the
  // toggle sits in the tab bar, above whichever tab is open.
  const [mode, setMode] = useState<MoveMode>("pct");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [seed, setSeed] = useState<ThesisCardData | null>(null);

  const handleRowClick = (row: CoverageRow) => {
    if (row.thesisId) {
      setSeed(seedFor(row));
      setSheetOpen(true);
    } else {
      router.push(`/stocks/${row.ticker}`);
    }
  };

  const EMPTY_LABELS: Record<Tab, string> = {
    trades: "No open trades.",
    sold: "Nothing sold yet.",
    watching: "Nothing on the watchlist yet.",
    passed: "No recently passed names.",
  };

  return (
    <div className="space-y-3">
      {/* Which names on the left (chips: a slice of the list), what unit
          their move is in on the right (small Tabs: a view setting). */}
      <div className="flex items-center justify-between gap-2">
        <ChipTabs<Tab>
          clearable={false}
          options={COVERAGE_TABS}
          value={activeTab}
          onChange={(v) => v && setActiveTab(v)}
        />
        <Tabs value={mode} onValueChange={(v) => setMode(v as MoveMode)}>
          <TabsList size="sm">
            <TabsTrigger value="pct" title="1D / 5D / 30D as a percent move">%</TabsTrigger>
            <TabsTrigger value="dollar" title="1D / 5D / 30D as a dollar move, on the shares held now">$</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <CoverageTab
        rows={data[activeTab]}
        tab={activeTab}
        mode={mode}
        emptyLabel={EMPTY_LABELS[activeTab]}
        onRowClick={handleRowClick}
      />

      {seed && (
        <ThesisSheet open={sheetOpen} onOpenChange={setSheetOpen} {...seed} />
      )}
    </div>
  );
}
