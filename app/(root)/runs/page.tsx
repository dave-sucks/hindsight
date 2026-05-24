import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";
import { Card } from "@/components/ui/card";
import { StockLogo } from "@/components/StockLogo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConceptTooltip } from "@/components/domain/education-card";
import { RunShowcaseTrigger, RunShowcaseButton } from "@/components/domain/run-showcase-trigger";
import { SkeletonCardStack } from "@/components/domain/skeleton-card";
import {
  buildRunSummary,
  buildActionSegments,
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

// ── Corner-dot overlay for logos ────────────────────────────────────────────
//
// Small solid dot in the bottom-right of the logo — green = bought/added,
// red = sold/trimmed, blue = watched. `muted` → no dot (plain logo).

function dotColorBg(color: ActionColor): string {
  if (color === "green") return "bg-emerald-500";
  if (color === "red") return "bg-red-500";
  if (color === "blue") return "bg-sky-500";
  return "";
}

function LogoWithDot({
  ticker,
  badge,
}: {
  ticker: string;
  badge?: { color: ActionColor; partial: boolean };
}) {
  return (
    <div className="relative">
      <StockLogo ticker={ticker} size="sm" className="rounded-full" />
      {badge && badge.color !== "muted" && (
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
            dotColorBg(badge.color),
          )}
        />
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
  const environment = await getCurrentEnvironment();

  const runs = await prisma.researchRun.findMany({
    where: {
      userId,
      environment,
      // PRINCIPAL_CHAT rows are chat-session containers, not analytical
      // runs — they're created automatically when /chat is scoped to an
      // analyst and stay RUNNING for the chat's lifetime. Showing them
      // on /runs cluttered the feed with "Run by [analyst]" rows that
      // would never reach a terminal state. Past chat sessions live in
      // the Recent Chats sidebar on /chat (see RecentChatsSidebar).
      mode: { not: "PRINCIPAL_CHAT" },
    },
    include: {
      // mode + parameters drive the run-card title and tactical context.
      // mode is on the schema (MORNING_PLAN / INTRADAY_TACTICAL / EOD_REFLECTIVE);
      // parameters carries the trigger fire info for tactical runs.
      agentConfig: { select: { id: true, name: true } },
      // Podcast feature — render segment runs with "Podcast · Segment" name
      // instead of falling back to "Manual Research". See docs/PODCAST_PLAN.md.
      segment: {
        select: {
          id: true,
          name: true,
          podcast: { select: { id: true, name: true } },
        },
      },
      segmentTranscript: {
        select: { title: true, durationSec: true, citations: true },
      },
      theses: {
        select: {
          ticker: true,
          direction: true,
          scoring: true,
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
      // ThesisUpdate audit rows tied to this run. Drives the new-model
      // action segments (Updated / Invalidated / Reviewed / Watching).
      // `summary` is read for tactical runs to surface the trigger-fired
      // line in the card subtitle ("REVIEW trigger matched: PRICE_BELOW").
      thesisUpdates: {
        select: {
          type: true,
          summary: true,
          thesis: { select: { ticker: true, status: true } },
        },
      },
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-3">
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
          const isPodcastSegmentRun = run.podcastSegmentId != null;
          const analystName = isPodcastSegmentRun
            ? `${run.segment?.podcast?.name ?? "Podcast"} · ${run.segment?.name ?? "Segment"}`
            : run.agentConfig?.name ??
              (run.source === "MANUAL" ? "Manual Research" : "Agent");

          const summary = buildRunSummary(run);
          const segments = buildActionSegments(summary);

          // Mode-led title — schema-backed (no heuristics). Defaults to
          // "Run by" for unknown modes and manual runs.
          const isTactical = run.mode === "INTRADAY_TACTICAL";
          const titlePrefix = isPodcastSegmentRun
            ? null
            : run.mode === "INTRADAY_TACTICAL"
              ? "Tactical run by"
              : run.mode === "EOD_REFLECTIVE"
                ? "EOD recap by"
                : run.mode === "MORNING_PLAN"
                  ? "Morning review by"
                  : run.mode === "DISCOVERY"
                    ? "Discovery run by"
                    : run.mode === "THESIS_WRITER"
                      ? "Thesis research by"
                      : "Run by";

          // For tactical runs the action line IS the trigger that fired —
          // pulled directly from the TRIGGER_FIRED audit row's summary.
          // Falls back to action segments if for some reason the row's
          // missing (older runs pre-PR 200).
          const triggerFiredRow = run.thesisUpdates?.find(
            (u) => u.type === "TRIGGER_FIRED",
          );
          const tacticalSubtitle =
            isTactical && triggerFiredRow?.thesis?.ticker
              ? `$${triggerFiredRow.thesis.ticker} ${triggerFiredRow.summary ?? "trigger fired"}`
              : null;

          // Logo stack tickers — action tickers first, then researched fill,
          // then audit-only tickers (tactical runs that only update_thesis
          // touched these — they wouldn't appear otherwise).
          const actionTickers = [...summary.tickerBadges.keys()];
          const thesisTickers = run.theses.map((t) => t.ticker.toUpperCase());
          const auditTickers = [
            ...summary.actions.invalidated,
            ...summary.actions.updated,
            ...summary.actions.reviewed,
          ];
          const orderedTickers = [
            ...new Set([...actionTickers, ...thesisTickers, ...auditTickers]),
          ];

          const duration = run.completedAt
            ? Math.round(
                (new Date(run.completedAt).getTime() -
                  new Date(run.startedAt).getTime()) /
                  1000
              )
            : null;

          // Only render a status dot for non-COMPLETE runs — green dot
          // on every successful run was visual noise.
          const statusDotClass =
            run.status === "RUNNING"
              ? "bg-amber-500 animate-pulse"
              : run.status === "FAILED"
                ? "bg-negative"
                : null;

          const pnl = summary.realizedPnl;
          const pnlLabel =
            pnl != null
              ? `${pnl >= 0 ? "+" : "-"}$${Math.abs(
                  Math.round(pnl),
                ).toLocaleString("en-US")} realized`
              : null;

          return (
            <Link key={run.id} href={`/runs/${run.id}`} className="block">
              <Card className="p-0 gap-0 py-0 shadow-none hover:bg-accent/50 transition-colors overflow-hidden">
                {/* Section 1: title (line 1) + action line (line 2) */}
                <div className="p-3 flex flex-col gap-1 min-w-0">
                  {/* Row 1: title · logo stack */}
                  <div className="flex items-center justify-between gap-3 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {statusDotClass && (
                        <div className={`h-2 w-2 rounded-full shrink-0 ${statusDotClass}`} />
                      )}
                      <span className="text-sm font-medium text-foreground truncate">
                        {titlePrefix ? `${titlePrefix} ${analystName}` : analystName}
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
                            <LogoWithDot
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

                  {/* Row 2: action line · realized P&L (if any) */}
                  <div className="flex items-baseline justify-between gap-3 min-w-0">
                    {isPodcastSegmentRun ? (
                      <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed min-w-0">
                        {run.segmentTranscript?.title ??
                          (run.status === "RUNNING"
                            ? "Researching segment…"
                            : "No transcript saved")}
                      </p>
                    ) : tacticalSubtitle ? (
                      <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed min-w-0">
                        {tacticalSubtitle}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed min-w-0">
                        {segments.map((seg, i) => (
                          <span key={i}>
                            {i > 0 && <span className="mx-1.5 opacity-40">·</span>}
                            <span>{seg.text}</span>
                          </span>
                        ))}
                      </p>
                    )}
                    {pnlLabel && (
                      <span
                        className={cn(
                          "text-xs font-medium tabular-nums shrink-0",
                          pnl! >= 0 ? "text-emerald-500" : "text-red-500",
                        )}
                      >
                        {pnlLabel}
                      </span>
                    )}
                  </div>
                </div>

                {/* Section 2: timestamp + duration, separated by full-width border */}
                {!isPodcastSegmentRun && (
                  <div className="flex items-center gap-2 px-3 py-2 border-t text-xs font-mono tabular-nums text-muted-foreground">
                    <span>{formatRelativeTime(run.startedAt)}</span>
                    {duration != null && (
                      <>
                        <span className="opacity-40">·</span>
                        <span>{duration}s</span>
                      </>
                    )}
                  </div>
                )}

                {/* Podcast transcript stats row stays — distinct surface */}
                {isPodcastSegmentRun && run.segmentTranscript && (
                  <div className="flex items-center justify-between p-3 border-t text-xs font-mono tabular-nums">
                    <span className="font-medium text-foreground">
                      Segment transcript
                    </span>
                    <span className="text-muted-foreground">
                      {run.segmentTranscript.durationSec != null && (
                        <>~{run.segmentTranscript.durationSec}s · </>
                      )}
                      {Array.isArray(run.segmentTranscript.citations)
                        ? (run.segmentTranscript.citations as unknown[]).length
                        : 0}{" "}
                      citations
                    </span>
                  </div>
                )}
              </Card>
            </Link>
          );
        })
      )}
    </div>
  );
}
