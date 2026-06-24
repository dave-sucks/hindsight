"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getTradeStatusDisplay } from "@/lib/trade-status";
import { cn, pnlColor } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { ThesisSheet } from "@/components/agent/sheets/ThesisSheet";
import type { ThesisCardData } from "@/components/agent/sheets/ThesisSheet";
import type { CoverageData, CoverageRow } from "@/lib/actions/coverage.actions";

// ─── Coverage Table (Feature B — docs/plans/PORTFOLIO_DIGEST.md) ──────────────
//
// An expanded trade-row: each row carries the trade-row identity (logo · status
// dot · ticker · subhead) PLUS the stock's momentum across 1D/5D/30D and the
// move-vs-decision ("Since"). Three tabs: Trades (open + recent sales),
// Watching, Passed (recent). See coverage.actions for the data.

// Moves under this magnitude read as "flat" — shown muted, not green/red.
const FLAT_BAND_PCT = 0.5;

const SINCE_LABEL = { trades: "Lifetime", watching: "Since watch", passed: "Since pass" } as const;
type Tab = keyof typeof SINCE_LABEL;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

// ── A plain colored % (stock momentum — green up / red down, muted near flat) ─
function Pct({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground/40">—</span>;
  const flat = Math.abs(value) < FLAT_BAND_PCT;
  return (
    <span className={cn("tabular-nums", flat ? "text-muted-foreground" : pnlColor(value))}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

// ── The status dot — identical to the trade row's for trades; neutral else ───
function statusDotClass(row: CoverageRow): string {
  if (row.tradeState === "OPEN") return getTradeStatusDisplay("OPEN").dotClass;
  if (row.tradeState === "CLOSED")
    return getTradeStatusDisplay((row.sinceDollar ?? 0) >= 0 ? "CLOSED_WIN" : "CLOSED_LOSS").dotClass;
  if (row.verdict != null) return "bg-muted-foreground/40"; // passed
  return "bg-sky-500"; // watching
}

// ── Name cell — the trade-row left side (logo · dot · ticker · subhead) ───────
function NameCell({ row }: { row: CoverageRow }) {
  const subhead =
    row.tradeState != null && row.costBasis != null && row.shares != null
      ? `${formatCurrency(row.costBasis)} — ${row.shares} share${row.shares === 1 ? "" : "s"}`
      : row.analystName;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <StockLogo ticker={row.ticker} size="md" className="rounded-md" />
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{row.ticker}</span>
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", statusDotClass(row))} />
        </div>
        {subhead && (
          <span className="text-xs text-muted-foreground tabular-nums truncate">{subhead}</span>
        )}
      </div>
    </div>
  );
}

// ── Since cell — 2-line: move (gray near flat / verdict icon for passes) + sub ─
function SinceCell({ row }: { row: CoverageRow }) {
  const subAnchor =
    row.anchorPrice != null && row.anchorVerb !== "Sold"
      ? ` · $${row.anchorPrice.toFixed(2)}`
      : "";
  const sub = `${row.anchorVerb} ${fmtDate(row.anchorAt)}${subAnchor}`;

  // Passed: the % AND the icon both carry the verdict — Dodged = green + ✓,
  // Missed = red + ✗, Flat = gray + no icon (NOT raw direction coloring, which
  // is backwards for a pass). Trades/Watching: normal green/red, muted near flat.
  const isPass = row.verdict != null;
  const flat = row.sincePct != null && Math.abs(row.sincePct) < FLAT_BAND_PCT;
  const pctClass = isPass
    ? row.verdict === "DODGED"
      ? "text-emerald-500"
      : row.verdict === "MISSED"
        ? "text-red-500"
        : "text-muted-foreground"
    : flat
      ? "text-muted-foreground"
      : pnlColor(row.sincePct ?? 0);

  const verdictIcon =
    row.verdict === "DODGED" ? (
      <Check className="h-3.5 w-3.5 text-emerald-500" />
    ) : row.verdict === "MISSED" ? (
      <X className="h-3.5 w-3.5 text-red-500" />
    ) : null; // FLAT → no icon

  const top = (
    <span className="inline-flex items-center gap-1.5 justify-end">
      {verdictIcon}
      {row.sincePct == null ? (
        <span className="text-muted-foreground/40">—</span>
      ) : (
        <span className={cn("tabular-nums", pctClass)}>
          {row.tradeState != null && row.sinceDollar != null && (
            <>
              {row.sinceDollar >= 0 ? "+" : ""}${Math.abs(row.sinceDollar).toFixed(2)}{" "}
            </>
          )}
          <span className="text-xs">
            {row.sincePct >= 0 ? "+" : ""}
            {row.sincePct.toFixed(2)}%
          </span>
        </span>
      )}
    </span>
  );

  return (
    <div className="flex flex-col items-end gap-0.5">
      {verdictIcon != null ? (
        <Tooltip>
          <TooltipTrigger render={<span className="cursor-default">{top}</span>} />
          <TooltipContent side="top">
            {row.verdict === "DODGED"
              ? "Dodged — passed and it's down since"
              : "Missed — passed but it's risen since"}
          </TooltipContent>
        </Tooltip>
      ) : (
        top
      )}
      <span className="text-xs text-muted-foreground/70 truncate">{sub}</span>
    </div>
  );
}

// ── One tab's table ──────────────────────────────────────────────────────────
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
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">1D</TableHead>
            <TableHead className="text-right">5D</TableHead>
            <TableHead className="text-right">30D</TableHead>
            <TableHead className="text-right">{SINCE_LABEL[tab]}</TableHead>
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
              <TableCell className="text-right tabular-nums font-light">
                {row.currentPrice != null ? `$${row.currentPrice.toFixed(2)}` : "—"}
              </TableCell>
              <TableCell className="text-right"><Pct value={row.oneDayPct} /></TableCell>
              <TableCell className="text-right"><Pct value={row.fiveDayPct} /></TableCell>
              <TableCell className="text-right"><Pct value={row.thirtyDayPct} /></TableCell>
              <TableCell className="text-right"><SinceCell row={row} /></TableCell>
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

  // Row click → open the thesis sheet (the principal's preferred entry point);
  // /trades is reachable from inside the sheet. No thesis for the ticker →
  // fall back to the stock page.
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
