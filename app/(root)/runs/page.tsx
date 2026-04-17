import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { StockLogo } from "@/components/StockLogo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConceptTooltip } from "@/components/domain/education-card";
import { RunShowcaseTrigger, RunShowcaseButton } from "@/components/domain/run-showcase-trigger";
import { SkeletonCardStack } from "@/components/domain/skeleton-card";
import {
  PlusIcon,
  MinusIcon,
  EyeIcon,
  EyeOffIcon,
  CheckIcon,
  XIcon,
  BanIcon,
} from "lucide-react";
import {
  buildRunSummary,
  formatActionLine,
  formatStatsRow,
  type RunActionIcon,
} from "@/lib/run-summary";
import { cn } from "@/lib/utils";

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ── Action overlay config (matches ToolProgressTickerItem styling) ──────────

const ACTION_OVERLAY: Record<
  RunActionIcon,
  { Icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  buy:           { Icon: PlusIcon,   className: "bg-emerald-500 text-white" },
  sell:          { Icon: MinusIcon,  className: "bg-red-500 text-white" },
  watch:         { Icon: EyeIcon,    className: "bg-muted-foreground text-background" },
  unwatch:       { Icon: EyeOffIcon, className: "bg-muted-foreground text-background" },
  "closed-win":  { Icon: CheckIcon,  className: "bg-emerald-500 text-white" },
  "closed-loss": { Icon: XIcon,      className: "bg-red-500 text-white" },
  failed:        { Icon: BanIcon,    className: "bg-muted text-muted-foreground" },
};

function LogoWithOverlay({
  ticker,
  overlay,
}: {
  ticker: string;
  overlay?: RunActionIcon;
}) {
  const cfg = overlay ? ACTION_OVERLAY[overlay] : null;
  return (
    <div className="relative">
      <StockLogo ticker={ticker} size="sm" />
      {cfg && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-1 ring-background flex items-center justify-center",
            cfg.className,
          )}
          aria-hidden
        >
          <cfg.Icon className="size-2" />
        </span>
      )}
    </div>
  );
}

export default async function RunsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? "";

  const runs = await prisma.researchRun.findMany({
    where: { userId },
    include: {
      agentConfig: { select: { id: true, name: true } },
      theses: {
        select: {
          ticker: true,
          direction: true,
          confidenceScore: true,
        },
        orderBy: { createdAt: "asc" },
      },
      decisions: {
        select: {
          symbol: true,
          decision: true,
          position: {
            select: {
              realizedPnl: true,
              outcome: true,
              status: true,
            },
          },
        },
      },
      managementActions: {
        select: {
          actionType: true,
          prevStopLoss: true,
          newStopLoss: true,
          prevTargetPrice: true,
          newTargetPrice: true,
          prevTrailPct: true,
          newTrailPct: true,
          position: {
            select: { symbol: true },
          },
        },
      },
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-3">
      <div className="mb-4 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Runs</h1>
            <RunShowcaseButton />
          </div>
          {runs.length === 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Link
                      href="/analysts"
                      className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
                    >
                      Create an Analyst
                    </Link>
                  }
                />
                <TooltipContent side="bottom">
                  <p className="text-xs">Create an analyst to start running research sessions</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Structured <ConceptTooltip concept="run">research sessions</ConceptTooltip> from all your analysts
        </p>
      </div>

      {runs.length === 0 ? (
        <div className="pt-8">
          <RunShowcaseTrigger />
          <SkeletonCardStack
            count={3}
            title="No runs yet"
            subtitle="You'll see runs from your analysts here once they run."
          />
        </div>
      ) : (
        runs.map((run) => {
          const analystName =
            run.agentConfig?.name ??
            (run.source === "MANUAL" ? "Manual Research" : "Agent");

          const summary = buildRunSummary(run);
          const actionLine = formatActionLine(summary);
          const statsLine = formatStatsRow(summary);

          // Logo stack tickers — prioritize tickers that had an action,
          // then fill with researched tickers.
          const actionTickers = [...summary.tickerOverlays.keys()];
          const thesisTickers = run.theses.map((t) => t.ticker.toUpperCase());
          const orderedTickers = [
            ...new Set([...actionTickers, ...thesisTickers]),
          ];

          const duration = run.completedAt
            ? Math.round(
                (new Date(run.completedAt).getTime() -
                  new Date(run.startedAt).getTime()) /
                  1000
              )
            : null;

          const statusDot =
            run.status === "COMPLETE"
              ? "bg-positive"
              : run.status === "RUNNING"
                ? "bg-amber-500 animate-pulse"
                : "bg-negative";

          const pnlLabel =
            summary.realizedPnl != null
              ? `${summary.realizedPnl >= 0 ? "+" : "-"}$${Math.abs(
                  Math.round(summary.realizedPnl),
                ).toLocaleString("en-US")} realized`
              : null;

          return (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="block border rounded-xl p-4 hover:bg-muted/20 transition-colors"
            >
              {/* Header: analyst name · time · duration | pnl | logo stack */}
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${statusDot}`} />
                  <span className="text-sm font-medium truncate">{analystName}</span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {formatRelativeTime(run.startedAt)}
                    {duration != null && ` · ${duration}s`}
                  </span>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {pnlLabel && (
                    <span
                      className={cn(
                        "text-xs font-medium tabular-nums",
                        summary.realizedPnl! >= 0
                          ? "text-emerald-500"
                          : "text-red-500",
                      )}
                    >
                      {pnlLabel}
                    </span>
                  )}
                  {/* Logo stack with action overlays */}
                  {orderedTickers.length > 0 && (
                    <div className="flex items-center">
                      {orderedTickers.slice(0, 5).map((ticker, i) => (
                        <div
                          key={ticker}
                          className={i > 0 ? "-ml-1.5" : ""}
                          style={{ zIndex: orderedTickers.length - i }}
                        >
                          <LogoWithOverlay
                            ticker={ticker}
                            overlay={summary.tickerOverlays.get(ticker)}
                          />
                        </div>
                      ))}
                      {orderedTickers.length > 5 && (
                        <div className="-ml-1.5 h-6 w-6 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] font-medium text-muted-foreground">
                          +{orderedTickers.length - 5}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Primary action line */}
              <p className="text-sm text-muted-foreground line-clamp-2">
                {actionLine}
              </p>

              {/* Stats row */}
              {summary.counts.researched > 0 && (
                <div className="flex items-center justify-between border-t pt-2 mt-2 text-xs text-muted-foreground tabular-nums">
                  <span>{statsLine}</span>
                  {summary.counts.watchlist > 0 && (
                    <span>
                      +{summary.counts.watchlist} watchlist
                    </span>
                  )}
                </div>
              )}
            </Link>
          );
        })
      )}
    </div>
  );
}
