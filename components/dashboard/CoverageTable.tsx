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
/**
 * The four move columns. Desktop shows all four side by side; a phone shows
 * ONE of them, the one its tab names, and hides the other three. Each column
 * is its own cell with its own number — nothing is shared between them, so
 * no view state can put one column's number in another's place (#914 did
 * exactly that: the desktop Lifetime column showed the day's move).
 */
type Window = "1d" | "5d" | "30d" | "lifetime";
const WINDOWS: Array<{ value: Window; label: string }> = [
  { value: "1d", label: "1D" },
  { value: "5d", label: "5D" },
  { value: "30d", label: "30D" },
  { value: "lifetime", label: "Lifetime" },
];
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
// Every move cell holds BOTH values, the dollars and the percent, always. The
// desktop's % / $ setting only decides which of the two is shown from md up;
// a phone shows both (it sees one column at a time), so the setting cannot
// reach it. A name with no shares has no dollars: desktop $ mode reads "—",
// a phone shows the percent alone. The flat band stays a PERCENT test —
// "did this barely move" is a question about the move, not how much you own.
// Money is TEXT, percent is a BADGE — the app's rule everywhere.
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
  const d = moveDollar({ shares: row.shares, currentPrice: row.currentPrice, pct });
  const showDollar = mode === "dollar";

  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      {d == null ? (
        <span className={cn("text-muted-foreground/40", showDollar ? "hidden md:inline" : "hidden")}>—</span>
      ) : (
        <span
          className={cn(
            "tabular-nums text-sm",
            flat ? "text-muted-foreground" : pnlColor(d),
            !showDollar && "md:hidden",
          )}
        >
          {formatSignedCurrency(d)}
        </span>
      )}
      {flat ? (
        <span className={cn("tabular-nums text-sm text-muted-foreground", showDollar && "md:hidden")}>
          {pct >= 0 ? "+" : ""}
          {pct.toFixed(2)}%
        </span>
      ) : (
        <PnlBadge value={pct} format="percent" className={cn("text-xs", showDollar && "md:hidden")} />
      )}
    </span>
  );
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

// ── Lifetime cell ────────────────────────────────────────────────────────────
// The lifetime gain, dollars and percent: unrealized while held, realized once
// sold, a percent alone on a name we only watched or passed. Reads the row and
// nothing else.
function LifetimeGain({ row }: { row: CoverageRow }) {
  if (row.sincePct == null) return <span className="text-muted-foreground/40 text-xs">—</span>;
  const dollar = row.tradeState == null ? null : row.sinceDollar;
  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      {dollar != null && (
        <PriceChange dollarChange={dollar} percentChange={null} size="sm" arrowFirst />
      )}
      <PnlBadge value={row.sincePct} format="percent" className="text-xs" />
    </span>
  );
}

// On a phone the Price column is hidden, so the one column that shows
// carries the price above its number.
function PhonePrice({ row }: { row: CoverageRow }) {
  if (row.currentPrice == null) return null;
  return <span className="md:hidden text-sm tabular-nums font-light">${row.currentPrice.toFixed(2)}</span>;
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
  // Which of the four columns a phone shows. Desktop ignores it: all four show.
  const [phoneWindow, setPhoneWindow] = useState<Window>("1d");
  // The column's own cells: on desktop every column is a cell; on a phone
  // only the chosen one is, the rest are display:none.
  const windowCell = (w: Window, extra = "") =>
    cn("text-right", extra, w === phoneWindow ? "table-cell" : "hidden md:table-cell");
  const phoneTabs = (
    <div className="md:hidden flex justify-end">
      <Tabs value={phoneWindow} onValueChange={(v) => setPhoneWindow(v as Window)}>
        <TabsList size="sm">
          {WINDOWS.map((w) => (
            <TabsTrigger key={w.value} value={w.value}>
              {w.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );

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
            {/* The four move columns. On a phone the chosen one is wide enough
                for its price and number, and its head holds the tabs. */}
            <TableHead className={windowCell("1d", "w-52 md:w-24")}>
              <span className="hidden md:inline">1D</span>
              {phoneWindow === "1d" && phoneTabs}
            </TableHead>
            <TableHead className={windowCell("5d", "w-52 md:w-24")}>
              <span className="hidden md:inline">5D</span>
              {phoneWindow === "5d" && phoneTabs}
            </TableHead>
            <TableHead className={windowCell("30d", "w-52 md:w-24")}>
              <span className="hidden md:inline">30D</span>
              {phoneWindow === "30d" && phoneTabs}
            </TableHead>
            {/* Sized to the gain + badge so the name column keeps the
                shares line instead of "300 sh…". */}
            <TableHead className={windowCell("lifetime", "w-52")}>
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
              {phoneWindow === "lifetime" && phoneTabs}
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
              <TableCell className={windowCell("1d")}>
                <div className="flex flex-col items-end gap-0.5">
                  <PhonePrice row={row} />
                  <Move pct={row.oneDayPct} row={row} mode={mode} />
                </div>
              </TableCell>
              <TableCell className={windowCell("5d")}>
                <div className="flex flex-col items-end gap-0.5">
                  <PhonePrice row={row} />
                  <Move pct={row.fiveDayPct} row={row} mode={mode} />
                </div>
              </TableCell>
              <TableCell className={windowCell("30d")}>
                <div className="flex flex-col items-end gap-0.5">
                  <PhonePrice row={row} />
                  <Move pct={row.thirtyDayPct} row={row} mode={mode} />
                </div>
              </TableCell>
              <TableCell className={windowCell("lifetime")}>
                <div className="flex flex-col items-end gap-0.5">
                  <PhonePrice row={row} />
                  <LifetimeGain row={row} />
                </div>
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
            nativeButton={false}
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
        {/* Desktop only: the phone's one column shows dollars and percent
            both, so the unit switch would change nothing there. */}
        <div className="hidden md:block">
          <Tabs value={mode} onValueChange={(v) => setMode(v as MoveMode)}>
            <TabsList size="sm">
              <TabsTrigger value="pct" title="1D / 5D / 30D as a percent move">%</TabsTrigger>
              <TabsTrigger value="dollar" title="1D / 5D / 30D as a dollar move, on the shares held now">$</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
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
