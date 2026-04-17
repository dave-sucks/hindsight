import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { StockLogo } from "@/components/StockLogo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConceptTooltip } from "@/components/domain/education-card";
import { RunShowcaseTrigger, RunShowcaseButton } from "@/components/domain/run-showcase-trigger";
import { SkeletonCardStack } from "@/components/domain/skeleton-card";
import {
  buildRunSummary,
  buildActionSegments,
  formatStatsRow,
  type ActionColor,
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

// ── Color tokens ────────────────────────────────────────────────────────────
//
// One palette, used by both the logo rings AND the inline dots in the
// action line. `partial` switches solid → dashed (for ADD / PARTIAL_EXIT /
// REMOVE_WATCH — any half-capital move). `muted` gets no visible indicator
// on logos (plain circle) and no dot in the text (just label).

function ringClasses(color: ActionColor, partial: boolean): string {
  if (color === "muted") return "";
  const stroke =
    color === "green"
      ? "outline-emerald-500"
      : color === "red"
        ? "outline-red-500"
        : "outline-sky-500";
  const style = partial ? "outline-dashed" : "outline-solid";
  return cn("outline-2", style, stroke, "outline-offset-1");
}

function dotClasses(color: ActionColor, partial: boolean): string {
  if (color === "muted") return "";
  const base = "inline-block size-2 rounded-full mr-1.5 align-middle shrink-0";
  if (partial) {
    // Open/dashed variant: colored border, transparent center.
    const border =
      color === "green"
        ? "border-emerald-500"
        : color === "red"
          ? "border-red-500"
          : "border-sky-500";
    return cn(base, "border-[1.5px] border-dashed bg-transparent", border);
  }
  const fill =
    color === "green"
      ? "bg-emerald-500"
      : color === "red"
        ? "bg-red-500"
        : "bg-sky-500";
  return cn(base, fill);
}

// ── Logo with optional colored ring ─────────────────────────────────────────

function LogoWithRing({
  ticker,
  badge,
}: {
  ticker: string;
  badge?: { color: ActionColor; partial: boolean };
}) {
  const rounded = "rounded-full";
  return (
    <div className={cn("rounded-full", badge && ringClasses(badge.color, badge.partial))}>
      <StockLogo ticker={ticker} size="sm" className={rounded} />
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
          const segments = buildActionSegments(summary);
          const statsLine = formatStatsRow(summary);

          // Logo stack tickers — action tickers first, then researched fill.
          const actionTickers = [...summary.tickerBadges.keys()];
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

          const pnl = summary.realizedPnl;
          const pnlLabel =
            pnl != null
              ? `${pnl >= 0 ? "+" : "-"}$${Math.abs(
                  Math.round(pnl),
                ).toLocaleString("en-US")} realized`
              : null;

          return (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="block border rounded-xl p-4 hover:bg-muted/20 transition-colors"
            >
              {/* Header: analyst name · time · duration | logo stack */}
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${statusDot}`} />
                  <span className="text-sm font-medium truncate">{analystName}</span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {formatRelativeTime(run.startedAt)}
                    {duration != null && ` · ${duration}s`}
                  </span>
                </div>

                {orderedTickers.length > 0 && (
                  <div className="flex items-center shrink-0">
                    {orderedTickers.slice(0, 5).map((ticker, i) => (
                      <div
                        key={ticker}
                        className={i > 0 ? "-ml-1" : ""}
                        style={{ zIndex: orderedTickers.length - i }}
                      >
                        <LogoWithRing
                          ticker={ticker}
                          badge={summary.tickerBadges.get(ticker)}
                        />
                      </div>
                    ))}
                    {orderedTickers.length > 5 && (
                      <div className="-ml-1 h-6 w-6 rounded-full bg-muted border border-background flex items-center justify-center text-xs font-medium text-muted-foreground">
                        +{orderedTickers.length - 5}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Primary action line with colored dots */}
              <p className="text-sm text-muted-foreground line-clamp-2">
                {segments.map((seg, i) => (
                  <span key={i}>
                    {i > 0 && <span className="mx-1.5 opacity-40">·</span>}
                    {seg.color !== "muted" && (
                      <span className={dotClasses(seg.color, seg.partial)} aria-hidden />
                    )}
                    <span>{seg.text}</span>
                  </span>
                ))}
              </p>

              {/* Stats row — counts left, realized P&L right */}
              {summary.counts.researched > 0 && (
                <div className="flex items-center justify-between border-t pt-2 mt-2 text-xs tabular-nums">
                  <span className="text-muted-foreground">
                    {statsLine}
                    {summary.counts.watchlist > 0 && (
                      <span> · +{summary.counts.watchlist} watchlist</span>
                    )}
                  </span>
                  {pnlLabel && (
                    <span
                      className={cn(
                        "font-medium",
                        pnl! >= 0 ? "text-emerald-500" : "text-red-500",
                      )}
                    >
                      {pnlLabel}
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
