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
import { cn } from "@/lib/utils";
import { PriceChange } from "@/components/ui/price-change";
import { PnlBadge } from "@/components/ui/pnl-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/format";
import { proposalSentence } from "@/lib/trade-status";
import { ProposalActions } from "@/components/proposals/ProposalActions";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import type { ThesisCardData } from "@/components/agent/sheets/ThesisSheet";
import type { CoverageData, CoverageRow } from "@/lib/actions/coverage.actions";

// ─── Coverage Table (Feature B — docs/plans/PORTFOLIO_DIGEST.md) ──────────────

type Tab = "trades" | "watching" | "passed";
type MobileView = "lifetime" | "1d";

// Moves under this magnitude read as "flat" — shown muted, not green/red.
const FLAT_BAND_PCT = 0.5;

// ── Status dot ───────────────────────────────────────────────────────────────
function statusDotClass(row: CoverageRow): string {
  // A pending action outranks the row's own state — amber is the app-wide
  // "waiting on you" colour, and it's what makes proposals skimmable here.
  if (row.pendingProposal) return getTradeStatusDisplay("PENDING").dotClass;
  if (row.tradeState === "OPEN") return getTradeStatusDisplay("OPEN").dotClass;
  if (row.tradeState === "CLOSED")
    return getTradeStatusDisplay((row.sinceDollar ?? 0) >= 0 ? "CLOSED_WIN" : "CLOSED_LOSS").dotClass;
  if (row.verdict != null) return "bg-muted-foreground/40";
  return "bg-sky-500";
}

// ── Plain % cell (1D/5D/30D momentum) ────────────────────────────────────────
function Pct({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground/40">—</span>;
  const flat = Math.abs(value) < FLAT_BAND_PCT;
  if (flat) return <span className="tabular-nums text-sm text-muted-foreground">{value >= 0 ? "+" : ""}{value.toFixed(2)}%</span>;
  return <PnlBadge value={value} format="percent" className="text-xs" />;
}

// ── Name cell ─────────────────────────────────────────────────────────────────

function NameCell({ row }: { row: CoverageRow }) {
  let subhead: string;
  const pp = row.pendingProposal;
  if (pp) {
    // The proposal replaces the usual subhead — what you're being asked to
    // approve matters more than the cost basis while it's outstanding, and
    // once you've approved it, that it's on its way to Alpaca.
    subhead = proposalSentence(pp.intent, pp.quantity, pp.executing);
  } else if (row.tradeState != null && row.shares != null && row.costBasis != null) {
    subhead = `${row.shares} share${row.shares === 1 ? "" : "s"} · ${formatCurrency(row.costBasis)}`;
  } else if (row.verdict != null && row.anchorPrice != null) {
    subhead = `Passed at $${row.anchorPrice.toFixed(2)}`;
  } else if (row.anchorPrice != null) {
    subhead = `Watch at $${row.anchorPrice.toFixed(2)}`;
  } else {
    subhead = row.analystName ?? "";
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <StockLogo ticker={row.ticker} size="md" className="rounded-md" />
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{row.ticker}</span>
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusDotClass(row))} />
        </div>
        {subhead && (
          <span
            className={cn(
              "text-xs tabular-nums truncate",
              pp ? "text-amber-500" : "text-muted-foreground",
              // In flight — same shimmer the agent's running rows use.
              pp?.executing && "shimmer-text",
            )}
          >
            {subhead}
          </span>
        )}
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
  // Dollar gain only for lifetime on trades (1D has no dollar field)
  const dollar = isLifetime && row.tradeState != null ? row.sinceDollar : null;

  return (
    <div className="flex flex-col items-end gap-0.5">
      {/* Price — only on mobile since desktop has a dedicated Price column */}
      {row.currentPrice != null && (
        <span className="md:hidden text-sm tabular-nums font-light">
          ${row.currentPrice.toFixed(2)}
        </span>
      )}
      <span className="inline-flex items-center gap-1.5 justify-end">
        {/* Approve / reject inline — the same control as the Pending approval
            rail and the thesis sheet, so the decision can be made while
            reading the row's 1D/5D/30D move. */}
        {/* Nothing left to review once it's approved and on its way — the
            row says "Executing" instead. */}
        {row.pendingProposal && !row.pendingProposal.executing && (
          <ProposalActions
            orderId={row.pendingProposal.orderId}
            expiresAt={row.pendingProposal.expiresAt}
            align="end"
          />
        )}
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
  emptyLabel,
  onRowClick,
}: {
  rows: CoverageRow[];
  tab: Tab;
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
          constant size across the Trades/Watching/Passed tabs (the Gain column
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
            {/* Last column — "Lifetime" label on desktop, toggle on mobile */}
            <TableHead className="w-64 text-right">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={<span className="hidden md:inline cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4" />}
                  >
                    Lifetime
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end">
                    <p className="text-xs max-w-[200px]">
                      Total gain since the position was opened, the watch was started, or the name was passed.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {/* Mobile toggle — same pill style as the chart range tabs */}
              <div className="md:hidden inline-flex items-center gap-0.5 rounded-md border bg-muted/50 px-1 py-0.5">
                {(["lifetime", "1d"] as MobileView[]).map((v) => (
                  <button
                    key={v}
                    onClick={(e) => { e.stopPropagation(); setMobileView(v); }}
                    className={cn(
                      "px-2 py-0.5 text-xs rounded transition-colors",
                      mobileView === v
                        ? "bg-background text-foreground font-medium shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {v === "lifetime" ? "All" : "1D"}
                  </button>
                ))}
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
                <Pct value={row.oneDayPct} />
              </TableCell>
              <TableCell className="hidden md:table-cell text-right">
                <Pct value={row.fiveDayPct} />
              </TableCell>
              <TableCell className="hidden md:table-cell text-right">
                <Pct value={row.thirtyDayPct} />
              </TableCell>
              <TableCell className="text-right">
                <LifetimeCell row={row} mobileView={mobileView} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {tab === "trades" && (
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

const COVERAGE_TABS: { key: Tab; label: string }[] = [
  { key: "trades", label: "Trades" },
  { key: "watching", label: "Watching" },
  { key: "passed", label: "Passed" },
];

export default function CoverageTable({ data }: { data: CoverageData }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("trades");
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
    trades: "No trades yet.",
    watching: "Nothing on the watchlist yet.",
    passed: "No recently passed names.",
  };

  return (
    <div className="space-y-3">
      <div className="flex w-fit items-center gap-0.5 rounded-md border bg-muted/50 px-1 py-0.5">
        {COVERAGE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "px-2.5 py-1 text-xs rounded transition-colors",
              activeTab === t.key
                ? "bg-background text-foreground font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <CoverageTab
        rows={data[activeTab]}
        tab={activeTab}
        emptyLabel={EMPTY_LABELS[activeTab]}
        onRowClick={handleRowClick}
      />

      {seed && (
        <ThesisSheet open={sheetOpen} onOpenChange={setSheetOpen} {...seed} />
      )}
    </div>
  );
}
