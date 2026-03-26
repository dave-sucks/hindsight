"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Plus,
  MoreHorizontal,
  Loader2,
  Zap,
  TrendingUp,
  BarChart3,
  Beaker,
  ArrowLeftRight,
  Shield,
  Activity,
  Layers,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { StockLogo } from "@/components/StockLogo";
import { PnlBadge } from "@/components/ui/pnl-badge";
import { cn } from "@/lib/utils";
import { SilkOrb } from "@/components/effects/silk-orb";
import { deleteAnalyst } from "@/lib/actions/analyst.actions";
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
                  ? "bg-positive"
                  : "bg-negative"
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

function AnalystCard({ analyst, onDelete }: { analyst: AnalystListItem; onDelete: (id: string) => void }) {
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
          {/* ── Header: orb + name | PnlBadge + 3-dot menu ── */}
          <div className="flex items-center gap-2 min-w-0">
            <SilkOrb size={28} speed={10} color="#AEFD83" scale={0.08} noiseIntensity={1.5} />
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
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-negative focus:text-negative pointer-events-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(analyst.id);
                    }}
                  >
                    Delete analyst
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

// ── Idea cards ────────────────────────────────────────────────────────────────

const ANALYST_IDEAS = [
  {
    icon: Zap,
    title: "Momentum day trader",
    description: "Catches intraday breakouts on high-volume tech stocks.",
    prompt: "Build me an aggressive day trader focused on momentum and technical breakouts in tech stocks. Show me some real examples of stocks that fit this strategy right now.",
  },
  {
    icon: BarChart3,
    title: "Earnings player",
    description: "Trades the run-up and post-earnings drift.",
    prompt: "I want an analyst that trades around earnings — catches the run-up and post-earnings momentum. Research a stock with upcoming earnings to show me how it would work.",
  },
  {
    icon: Beaker,
    title: "Biotech catalyst hunter",
    description: "FDA approvals, trial data, unusual options flow.",
    prompt: "Build a biotech-focused analyst that watches for FDA catalysts, clinical trial data, and unusual options flow.",
  },
  {
    icon: ArrowLeftRight,
    title: "Mean reversion swing",
    description: "Buys oversold dips on quality large-caps.",
    prompt: "Create a swing trader that uses mean reversion — buys oversold dips on quality large-cap stocks when RSI drops below 30, targets a bounce back to the moving average.",
  },
  {
    icon: Shield,
    title: "Defensive value",
    description: "Low-beta dividend stocks for uncertain markets.",
    prompt: "Build a conservative value analyst focused on low-beta, high-dividend stocks. Focus on sectors like utilities, consumer staples, and healthcare.",
  },
  {
    icon: Activity,
    title: "Options flow tracker",
    description: "Follows smart money through unusual options activity.",
    prompt: "Create an analyst that tracks unusual options flow as its primary signal — large block trades, put/call ratio extremes, and dark pool activity.",
  },
  {
    icon: TrendingUp,
    title: "Sector rotator",
    description: "Rides capital rotation between market sectors.",
    prompt: "Build an analyst that trades sector rotation — identifies which sectors capital is flowing into and out of, and rides the rotation with sector ETFs and leading stocks.",
  },
  {
    icon: Layers,
    title: "Multi-signal quant",
    description: "Combines technicals, sentiment, and fundamentals.",
    prompt: "Create a quantitative analyst that combines multiple signal types — technical breakouts, social sentiment, and fundamental value metrics — to find high-conviction setups.",
  },
];

function IdeaCard({
  icon: Icon,
  title,
  description,
}: (typeof ANALYST_IDEAS)[number]) {
  return (
    <Link
      href="/analysts/new"
      className="shrink-0 w-[180px] group"
    >
      <Card className="h-full shadow-none py-0 hover:border-foreground/25 transition-colors">
        <div className="p-3 flex flex-col gap-1.5">
          <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          <p className="text-sm font-medium leading-tight">{title}</p>
          <p className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
            {description}
          </p>
        </div>
      </Card>
    </Link>
  );
}

function AnalystIdeasSection() {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Try an idea
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-6 px-6 scrollbar-hide">
        {ANALYST_IDEAS.map((idea) => (
          <IdeaCard key={idea.title} {...idea} />
        ))}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function AnalystsEmptyState() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <NewAnalystCard />
      </div>
      <AnalystIdeasSection />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalystsPageClient({
  analysts,
}: {
  analysts: AnalystListItem[];
}) {
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const targetAnalyst = analysts.find((a) => a.id === deleteTarget);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteAnalyst(deleteTarget);
      toast.success("Analyst deleted");
      setDeleteTarget(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete analyst");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold">Analysts</h1>

      {analysts.length === 0 ? (
        <AnalystsEmptyState />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {analysts.map((analyst) => (
              <AnalystCard key={analyst.id} analyst={analyst} onDelete={setDeleteTarget} />
            ))}
            <NewAnalystCard />
          </div>
          <AnalystIdeasSection />
        </>
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete {targetAnalyst?.name ?? "Analyst"}</DialogTitle>
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
              onClick={() => setDeleteTarget(null)}
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
    </div>
  );
}
