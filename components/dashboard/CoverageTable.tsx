"use client";

import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TradeRowShell } from "@/components/ui/trade-row";
import { pnlColor } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/format";
import type { CoverageData, CoverageRow } from "@/lib/actions/coverage.actions";

// ─── Coverage Table (Feature B — docs/plans/PORTFOLIO_DIGEST.md) ──────────────
//
// The principal's main stock-overview, grouped by real Thesis.status across
// three tabs. Reuses the ONE trade-row design (TradeRowShell) — Active is the
// trades "open" list; Watching/Passed are the same shell minus shares/amount,
// plus the status-specific columns. Phase-1 "since anchor" math only.
//
// TODO(phase-2): 5d/10d/30d post-decision windows (candle-backed). The current
// "since" figure is anchor-vs-live only. See PORTFOLIO_DIGEST.md → Feature B.

type Tab = "active" | "watching" | "passed";

// ── Shared "since [anchor]" cell — $ + % in the trade-row P&L language ────────
function SinceCell({ row }: { row: CoverageRow }) {
  if (row.sinceDollar == null || row.sincePct == null) {
    return <span className="text-[10px] text-muted-foreground/50">—</span>;
  }
  return (
    <>
      <span className={`text-sm tabular-nums ${pnlColor(row.sinceDollar)}`}>
        {row.sinceDollar >= 0 ? "+" : ""}${Math.abs(row.sinceDollar).toFixed(2)}
      </span>
      <PnlBadge value={row.sincePct} format="percent" className="text-xs" />
    </>
  );
}

function PriceTop({ price }: { price: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm tabular-nums font-light">
      {price != null ? `$${price.toFixed(2)}` : "—"}
    </span>
  );
}

function Leading({ ticker }: { ticker: string }) {
  return <StockLogo ticker={ticker} size="md" className="rounded-md" />;
}

function Primary({ row }: { row: CoverageRow }) {
  return (
    <>
      <span className="text-sm font-medium">{row.ticker}</span>
      {row.analystName && (
        <span className="text-[10px] text-muted-foreground font-mono truncate">
          {row.analystName}
        </span>
      )}
    </>
  );
}

// ── Active (HOLDING): since entry + target proximity ─────────────────────────
function ActiveRow({ row }: { row: CoverageRow }) {
  const proximityPct =
    row.targetProximity != null ? Math.round(row.targetProximity * 100) : null;
  return (
    <TradeRowShell
      href={`/stocks/${row.ticker}`}
      leading={<Leading ticker={row.ticker} />}
      primary={<Primary row={row} />}
      trailingTop={<PriceTop price={row.currentPrice} />}
      secondary={
        <>
          Since entry
          {row.anchorPrice != null && <> · ${row.anchorPrice.toFixed(2)}</>}
          {proximityPct != null && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="cursor-default"> · {proximityPct}% to target</span>
                }
              />
              <TooltipContent side="top" className="tabular-nums">
                {row.targetPrice != null && <div>Target ${row.targetPrice.toFixed(2)}</div>}
                {row.stopLoss != null && <div>Stop ${row.stopLoss.toFixed(2)}</div>}
              </TooltipContent>
            </Tooltip>
          )}
        </>
      }
      trailingBottom={<SinceCell row={row} />}
    />
  );
}

// ── Watching (WATCHING): since added / last review + buy-above level ──────────
function WatchingRow({ row }: { row: CoverageRow }) {
  return (
    <TradeRowShell
      href={`/stocks/${row.ticker}`}
      leading={<Leading ticker={row.ticker} />}
      primary={<Primary row={row} />}
      trailingTop={<PriceTop price={row.currentPrice} />}
      secondary={
        <>
          {row.anchorPrice != null
            ? `Buy above $${row.anchorPrice.toFixed(2)}`
            : "Watching"}
          {" · "}
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="cursor-default">
                  reviewed {formatRelativeTime(row.lastReviewedAt)}
                </span>
              }
            />
            <TooltipContent side="top">
              Added {formatRelativeTime(row.anchorAt)}
            </TooltipContent>
          </Tooltip>
        </>
      }
      trailingBottom={<SinceCell row={row} />}
    />
  );
}

// ── Passed (PASSED): since pass + Dodged/Missed verdict (NOT raw color) ───────
function PassedRow({ row }: { row: CoverageRow }) {
  // The verdict tag carries the meaning; the raw % is muted beside it because a
  // passed stock going UP is regret, so green-up/red-down coloring is backwards.
  const verdict =
    row.verdict === "DODGED" ? (
      <Badge variant="positive">Dodged</Badge>
    ) : row.verdict === "MISSED" ? (
      <Badge variant="negative">Missed</Badge>
    ) : (
      <Badge variant="secondary">Flat</Badge>
    );
  return (
    <TradeRowShell
      href={`/stocks/${row.ticker}`}
      leading={<Leading ticker={row.ticker} />}
      primary={<Primary row={row} />}
      trailingTop={<PriceTop price={row.currentPrice} />}
      secondary={<>Passed {formatRelativeTime(row.anchorAt)}</>}
      trailingBottom={
        <>
          {verdict}
          {row.sincePct != null && (
            <span className="text-xs text-muted-foreground/60 tabular-nums">
              {row.sincePct >= 0 ? "+" : ""}
              {row.sincePct.toFixed(2)}%
            </span>
          )}
        </>
      }
    />
  );
}

function EmptyTab({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export default function CoverageTable({ data }: { data: CoverageData }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Coverage</h2>
      </div>

      <Tabs defaultValue={"active" satisfies Tab}>
        <TabsList>
          <TabsTrigger value="active">Active ({data.active.length})</TabsTrigger>
          <TabsTrigger value="watching">Watching ({data.watching.length})</TabsTrigger>
          <TabsTrigger value="passed">Passed ({data.passed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-3">
          {data.active.length === 0 ? (
            <EmptyTab label="No held positions yet." />
          ) : (
            <div className="rounded-lg border overflow-hidden">
              {data.active.map((row) => (
                <ActiveRow key={row.thesisId} row={row} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="watching" className="mt-3">
          {data.watching.length === 0 ? (
            <EmptyTab label="Nothing on the watchlist yet." />
          ) : (
            <div className="rounded-lg border overflow-hidden">
              {data.watching.map((row) => (
                <WatchingRow key={row.thesisId} row={row} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="passed" className="mt-3">
          {data.passed.length === 0 ? (
            <EmptyTab label="No passed names yet." />
          ) : (
            <div className="rounded-lg border overflow-hidden">
              {data.passed.map((row) => (
                <PassedRow key={row.thesisId} row={row} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
