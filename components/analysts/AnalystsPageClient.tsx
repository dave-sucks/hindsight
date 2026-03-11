"use client";

import Link from "next/link";
import { Plus, MoreHorizontal } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { cn } from "@/lib/utils";
import type { AnalystListItem } from "@/lib/actions/analyst.actions";

// ── Win-rate bar ──────────────────────────────────────────────────────────────

function WinRateBar({ winRate, tradeCount }: { winRate: number | null; tradeCount: number }) {
  const filled = winRate != null ? Math.round(winRate * 10) : 0;
  const positive = winRate != null && winRate >= 0.5;
  const pct = winRate != null ? `${Math.round(winRate * 100)}%` : "—";

  return (
    <div className="space-y-1">
      <div className="flex gap-[2px]">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-2 flex-1",
              i === 0 && "rounded-l-full",
              i === 9 && "rounded-r-full",
              i < filled
                ? positive
                  ? "bg-emerald-500"
                  : "bg-red-500"
                : "bg-muted"
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{pct} win rate</span>
        <span>{tradeCount} total</span>
      </div>
    </div>
  );
}

// ── AnalystCard ───────────────────────────────────────────────────────────────

function AnalystCard({ analyst }: { analyst: AnalystListItem }) {
  const configSubhead = [
    analyst.directionBias,
    analyst.holdDurations.length > 0 ? analyst.holdDurations.join("/") : null,
    `${analyst.minConfidence}%+`,
  ]
    .filter(Boolean)
    .join(" — ");

  const promptText =
    analyst.analystPrompt ||
    analyst.description ||
    null;

  const openCount = analyst.openTrades.length;

  return (
    // Stretched-link pattern: invisible full-cover anchor at z-0, buttons at z-10
    <div className="relative group">
      <Link
        href={`/analysts/${analyst.id}`}
        className="absolute inset-0 z-0 rounded-[inherit]"
        aria-label={`Open ${analyst.name}`}
      />
      <Card className="group-hover:bg-muted/20 transition-colors gap-2 h-full overflow-hidden shadow-none py-0">

        {/* ── Top SectionHeader ── */}
        <div className="p-2 flex flex-col gap-1 min-w-0">
          {/* ── Header: name | PnlBadge + 3-dot menu ── */}
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="font-brand text-base font-bold leading-tight truncate flex-1 min-w-0">
              {analyst.name}
            </h2>
            <div className="flex items-center gap-1.5 shrink-0 relative z-10">
              {openCount > 0 && (
                <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums bg-muted text-muted-foreground">
                  {openCount} open
                </span>
              )}
              {analyst.tradeCount > 0 && (
                <PnlBadge value={analyst.totalPnl} format="currency" />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-accent/60 transition-colors text-muted-foreground pointer-events-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem
                    className="pointer-events-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link href={`/analysts/${analyst.id}`} className="w-full">
                      View details
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="pointer-events-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link href={`/analysts/${analyst.id}/edit`} className="w-full">
                      Edit config
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* ── Subhead: config metadata with em dashes ── */}
          <div className="">
            <p className="text-xs font-mono text-muted-foreground">
              {configSubhead}
            </p>
          </div>

          {/* ── Prompt ── */}
          <div className="pt-2">
            <p className="text-sm text-foreground leading-relaxed line-clamp-2">
              {promptText ?? (
                <span className="text-muted-foreground/40 not-italic">No prompt set</span>
              )}
            </p>
          </div>
        </div>

        {/* ── Performance: win-rate bar ── */}
        <div className="px-2 pb-2">
          <WinRateBar winRate={analyst.winRate} tradeCount={analyst.tradeCount} />
        </div>

        {/* ── Stock rows: up to 3 active trades ── */}
        {analyst.openTrades.length > 0 && (
          <div className="relative z-10">
            {analyst.openTrades.map((trade) => {
              const cost = trade.entryPrice * trade.shares;
              return (
                <Link
                  key={trade.id}
                  href={`/trades/${trade.id}`}
                  className="flex items-center gap-2 px-2 py-1.5 border-t hover:bg-accent/50 transition-colors"
                >
                  <StockLogo ticker={trade.ticker} size="sm" />
                  <span className="text-xs font-mono font-medium">{trade.ticker}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    ({trade.shares} shares)
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground ml-auto">
                    ${cost.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </span>
                </Link>
              );
            })}
          </div>
        )}



      </Card>
    </div>
  );
}

// ── New Analyst card ──────────────────────────────────────────────────────────

function NewAnalystCard() {
  return (
    <Link href="/analysts/new">
      <Card className="h-full border-dashed hover:bg-muted/20 transition-colors cursor-pointer shadow-none py-0">
        <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[180px] text-muted-foreground p-4">
          <div className="h-8 w-8 rounded-full border-2 border-dashed border-current flex items-center justify-center">
            <Plus className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-foreground">New Analyst</p>
          <p className="text-xs text-center">Describe what you want to find</p>
        </div>
      </Card>
    </Link>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function AnalystsEmptyState() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NewAnalystCard />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalystsPageClient({
  analysts,
}: {
  analysts: AnalystListItem[];
}) {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold">Analysts</h1>

      {analysts.length === 0 ? (
        <AnalystsEmptyState />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {analysts.map((analyst) => (
            <AnalystCard key={analyst.id} analyst={analyst} />
          ))}
          <NewAnalystCard />
        </div>
      )}
    </div>
  );
}
