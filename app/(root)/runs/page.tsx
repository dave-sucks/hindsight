import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { PlayCircle } from "lucide-react";
import { StockLogo } from "@/components/StockLogo";

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
          entryPrice: true,
          reasoningSummary: true,
          trade: {
            select: { id: true, shares: true, entryPrice: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-3">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Runs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Research sessions from all your analysts
        </p>
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
          <PlayCircle className="h-10 w-10 mb-4 opacity-30" />
          <p className="text-sm font-medium">No runs yet</p>
          <p className="text-xs mt-1">
            Enable an analyst to start automated research runs
          </p>
        </div>
      ) : (
        runs.map((run) => {
          const analystName =
            run.agentConfig?.name ??
            (run.source === "MANUAL" ? "Manual Research" : "Agent");

          const recommended = run.theses.filter(
            (t) => t.direction !== "PASS"
          );
          const tradesPlaced = run.theses.filter((t) => t.trade != null);

          // Unique tickers for logo stack
          const tickers = [
            ...new Set(run.theses.map((t) => t.ticker)),
          ];

          // Avg confidence
          const avgConf =
            run.theses.length > 0
              ? Math.round(
                  run.theses.reduce((sum, t) => sum + t.confidenceScore, 0) /
                    run.theses.length
                )
              : null;

          // Total capital deployed (from trades)
          const capitalDeployed = tradesPlaced.reduce((sum, t) => {
            if (!t.trade) return sum;
            return sum + t.trade.entryPrice * t.trade.shares;
          }, 0);

          // Build summary from top theses
          const summaryParts = recommended
            .slice(0, 3)
            .map(
              (t) =>
                `${t.direction === "LONG" ? "Long" : "Short"} ${t.ticker} (${t.confidenceScore}%)`
            );
          const summaryText =
            summaryParts.length > 0
              ? summaryParts.join(", ") +
                (recommended.length > 3
                  ? ` and ${recommended.length - 3} more`
                  : "")
              : run.theses.length > 0
                ? `Analyzed ${run.theses.length} stocks, none recommended`
                : "No analysis completed";

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

          return (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="block border rounded-xl p-4 hover:bg-muted/20 transition-colors"
            >
              {/* Header: analyst name | status + trades + logo stack */}
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`h-2 w-2 rounded-full shrink-0 ${statusDot}`}
                  />
                  <span className="text-sm font-medium truncate">
                    {analystName}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {formatRelativeTime(run.startedAt)}
                    {duration != null && ` · ${duration}s`}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {tradesPlaced.length > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {tradesPlaced.length} trade{tradesPlaced.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {/* Logo stack */}
                  {tickers.length > 0 && (
                    <div className="flex items-center">
                      {tickers.slice(0, 5).map((ticker, i) => (
                        <div
                          key={ticker}
                          className={i > 0 ? "-ml-1.5" : ""}
                          style={{ zIndex: tickers.length - i }}
                        >
                          <StockLogo ticker={ticker} size="sm" />
                        </div>
                      ))}
                      {tickers.length > 5 && (
                        <div className="-ml-1.5 h-6 w-6 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] font-medium text-muted-foreground">
                          +{tickers.length - 5}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Summary */}
              <p className="text-sm text-muted-foreground line-clamp-2">
                {summaryText}
              </p>

              {/* Stats row */}
              {(capitalDeployed > 0 || avgConf != null) && (
                <div className="flex items-center justify-between border-t pt-2 mt-2 text-xs text-muted-foreground tabular-nums">
                  {capitalDeployed > 0 ? (
                    <span>
                      ${capitalDeployed.toLocaleString("en-US", { maximumFractionDigits: 0 })} deployed
                    </span>
                  ) : (
                    <span>
                      {run.theses.length} analyzed · {recommended.length} recommended
                    </span>
                  )}
                  {avgConf != null && <span>{avgConf}% avg confidence</span>}
                </div>
              )}
            </Link>
          );
        })
      )}
    </div>
  );
}
