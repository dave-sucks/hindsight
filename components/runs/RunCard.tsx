import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StockLogo } from "@/components/StockLogo";
import {
  buildRunSummary,
  buildActionSegments,
  type ActionColor,
} from "@/lib/run-summary";
import type { RunCardRun } from "@/lib/actions/run-cards";
import { cn } from "@/lib/utils";

/**
 * RunCard — the canonical run-feed card. Server component (computes
 * buildRunSummary inline, no client serialization), rendered on /runs AND the
 * analyst detail page's Runs tab so both surfaces stay identical. Title is
 * mode-led ("Morning review by …", "Tactical run by …"); the subtitle is the
 * tactical trigger line or the action segments; the right side carries the
 * logo stack (with action dots) + realized P&L; the footer is timestamp +
 * duration. Extracted verbatim from the original inline /runs implementation.
 */

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

export function RunCard({ run }: { run: RunCardRun }) {
  const isPodcastSegmentRun = run.podcastSegmentId != null;
  const analystName = isPodcastSegmentRun
    ? `${run.segment?.podcast?.name ?? "Podcast"} · ${run.segment?.name ?? "Segment"}`
    : run.agentConfig?.name ??
      (run.source === "MANUAL" ? "Manual Research" : "Agent");

  const summary = buildRunSummary(run);
  const segments = buildActionSegments(summary);

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

  const triggerFiredRow = run.thesisUpdates?.find((u) => u.type === "TRIGGER_FIRED");
  const tacticalSubtitle =
    isTactical && triggerFiredRow?.thesis?.ticker
      ? `$${triggerFiredRow.thesis.ticker} ${triggerFiredRow.summary ?? "trigger fired"}`
      : null;

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
        (new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000,
      )
    : null;

  const statusDotClass =
    run.status === "RUNNING"
      ? "bg-amber-500 animate-pulse"
      : run.status === "FAILED"
        ? "bg-negative"
        : null;

  const pnl = summary.realizedPnl;
  const pnlLabel =
    pnl != null
      ? `${pnl >= 0 ? "+" : "-"}$${Math.abs(Math.round(pnl)).toLocaleString("en-US")} realized`
      : null;

  return (
    <Link href={`/runs/${run.id}`} className="block">
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
                    <LogoWithDot ticker={ticker} badge={summary.tickerBadges.get(ticker)} />
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
                  (run.status === "RUNNING" ? "Researching segment…" : "No transcript saved")}
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

        {/* Section 2: timestamp + duration */}
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

        {/* Podcast transcript stats row */}
        {isPodcastSegmentRun && run.segmentTranscript && (
          <div className="flex items-center justify-between p-3 border-t text-xs font-mono tabular-nums">
            <span className="font-medium text-foreground">Segment transcript</span>
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
}
