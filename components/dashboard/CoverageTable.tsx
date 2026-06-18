"use client";

import { useRouter } from "next/navigation";
import { StockLogo } from "@/components/StockLogo";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { cn, pnlColor } from "@/lib/utils";
import type {
  CoverageData,
  CoverageRow,
  CoverageStatus,
} from "@/lib/actions/coverage.actions";

// ─── Coverage Table (Feature B — docs/plans/PORTFOLIO_DIGEST.md) ──────────────
//
// The principal's main stock-overview, grouped by Thesis.status across three
// tabs. Each tab is a columnar table: Name · Price · 1D · 5D · Since[anchor].
// 1D/5D are the stock's OWN momentum (daily candles); "Since" is the move vs the
// decision anchor and adapts per status (since entry / since watch / since pass).
// On Passed, raw green/red is backwards (a passed stock rising = regret), so the
// Since cell shows the Dodged/Missed verdict instead.

type Tab = "active" | "watching" | "passed";

const SINCE_LABEL: Record<CoverageStatus, string> = {
  HOLDING: "Since entry",
  WATCHING: "Since watch",
  PASSED: "Since pass",
};

// ── A plain colored % (stock momentum — green up / red down) ─────────────────
function Pct({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground/40">—</span>;
  return (
    <span className={cn("tabular-nums", pnlColor(value))}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

// ── The "Since [anchor]" cell — adapts to status ─────────────────────────────
function SinceCell({ row }: { row: CoverageRow }) {
  // Passed: verdict carries the meaning (raw color is backwards for a pass).
  if (row.status === "PASSED") {
    const verdict =
      row.verdict === "DODGED" ? (
        <Badge variant="positive">Dodged</Badge>
      ) : row.verdict === "MISSED" ? (
        <Badge variant="negative">Missed</Badge>
      ) : (
        <Badge variant="secondary">Flat</Badge>
      );
    return (
      <span className="inline-flex items-center gap-1.5 justify-end">
        {verdict}
        {row.sincePct != null && (
          <span className="text-xs text-muted-foreground/60 tabular-nums">
            {row.sincePct >= 0 ? "+" : ""}
            {row.sincePct.toFixed(2)}%
          </span>
        )}
      </span>
    );
  }
  // Active / Watching: the move vs anchor as $ + % (Active = P&L on the holding).
  if (row.sincePct == null) return <span className="text-muted-foreground/40">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 justify-end tabular-nums">
      {row.sinceDollar != null && (
        <span className={pnlColor(row.sinceDollar)}>
          {row.sinceDollar >= 0 ? "+" : ""}${Math.abs(row.sinceDollar).toFixed(2)}
        </span>
      )}
      <span className={cn("text-xs", pnlColor(row.sincePct))}>
        {row.sincePct >= 0 ? "+" : ""}
        {row.sincePct.toFixed(2)}%
      </span>
    </span>
  );
}

// ── One status tab's table ───────────────────────────────────────────────────
function CoverageTab({
  rows,
  status,
  emptyLabel,
}: {
  rows: CoverageRow[];
  status: CoverageStatus;
  emptyLabel: string;
}) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  // Default-sort by the day's move (most active on top), like the reference.
  const sorted = [...rows].sort(
    (a, b) => (b.oneDayPct ?? -Infinity) - (a.oneDayPct ?? -Infinity),
  );

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">1D</TableHead>
            <TableHead className="text-right">5D</TableHead>
            <TableHead className="text-right">{SINCE_LABEL[status]}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow
              key={row.thesisId}
              className="cursor-pointer"
              onClick={() => router.push(`/stocks/${row.ticker}`)}
            >
              <TableCell>
                <div className="flex items-center gap-2 min-w-0">
                  <StockLogo ticker={row.ticker} size="md" className="rounded-md" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium">{row.ticker}</span>
                    {row.analystName && (
                      <span className="text-xs text-muted-foreground truncate">
                        {row.analystName}
                      </span>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums font-light">
                {row.currentPrice != null ? `$${row.currentPrice.toFixed(2)}` : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Pct value={row.oneDayPct} />
              </TableCell>
              <TableCell className="text-right">
                <Pct value={row.fiveDayPct} />
              </TableCell>
              <TableCell className="text-right">
                <SinceCell row={row} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function CoverageTable({ data }: { data: CoverageData }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Coverage</h2>

      <Tabs defaultValue={"active" satisfies Tab}>
        <TabsList>
          <TabsTrigger value="active">Active ({data.active.length})</TabsTrigger>
          <TabsTrigger value="watching">Watching ({data.watching.length})</TabsTrigger>
          <TabsTrigger value="passed">Passed ({data.passed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-3">
          <CoverageTab rows={data.active} status="HOLDING" emptyLabel="No held positions yet." />
        </TabsContent>
        <TabsContent value="watching" className="mt-3">
          <CoverageTab rows={data.watching} status="WATCHING" emptyLabel="Nothing on the watchlist yet." />
        </TabsContent>
        <TabsContent value="passed" className="mt-3">
          <CoverageTab rows={data.passed} status="PASSED" emptyLabel="No passed names yet." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
