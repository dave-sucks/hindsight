"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Search,
  Briefcase,
  Package,
  GitBranch,
  Newspaper,
  MoreHorizontal,
  Play,
  Info,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import type { SignalBatch, AnalystRouteInfo } from "./types";
import { relativeTime, JOB_LABELS, URGENCY_CONFIG } from "./types";
import type { LucideIcon } from "lucide-react";

// ── Job Card Data ──────────────────────────────────────────────────────────

interface JobInfo {
  icon: LucideIcon;
  event: string;
  time: string;
  short: string;
  long: string;
}

const JOBS: Record<string, JobInfo> = {
  "Market Sweep": {
    icon: Search,
    event: "market-sweep",
    time: "6:30 AM ET",
    short: "Searches for market-moving news across all enabled queries",
    long: "Runs every enabled search query from Config through Perplexity Sonar. Also calls FMP market movers (gainers/losers/actives, 10 each) and Finnhub earnings calendar (next 7 days). Results get parsed into structured signals with tickers, sentiment, urgency, and themes. Signals are deduplicated against the last 48 hours before storage.",
  },
  "Portfolio Monitor": {
    icon: Briefcase,
    event: "portfolio-monitor",
    time: "7:00 AM ET",
    short: "Searches for news on every open position and watchlist ticker",
    long: "Collects every unique ticker from open positions and active watchlist items across all analysts. For each ticker, searches Perplexity Sonar for stock-specific news, developments, and catalysts. Catches ticker-specific news the broad sweep might miss.",
  },
  "Source Pack": {
    icon: Package,
    event: "source-pack-monitor",
    time: "7:15 AM ET",
    short: "Crawls monitored domains for new articles, filings, and releases",
    long: "Iterates over every enabled Source from Config. Uses Perplexity Sonar for domain-scoped search, then Firecrawl for full-text extraction of high-value pages. Creates artifact records with extracted content that become signals.",
  },
  "Signal Router": {
    icon: GitBranch,
    event: "signal-router",
    time: "7:30 AM ET",
    short: "Routes unprocessed signals to matching analysts by coverage area",
    long: "Takes all unrouted signals and scores them against each analyst's sector coverage, ticker watchlist, and keywords. Signals scoring 15+ get routed. Higher relevance scores mean the signal is more important to that analyst.",
  },
  "Morning Brief": {
    icon: Newspaper,
    event: "morning-brief",
    time: "7:45 AM ET",
    short: "Generates personalized daily briefs for each analyst from their signals",
    long: "Uses GPT-4o to synthesize each analyst's pending signals into a structured brief: market context, portfolio alerts, watchlist updates, new opportunities, and attention priorities. Briefs appear in the Signals tab.",
  },
};

// ── Pipeline Log ────────────────────────────────────────────────────────────

interface PipelineLogProps {
  batches: SignalBatch[];
  routes: AnalystRouteInfo[];
  onRefresh: () => void;
}

export function PipelineLog({ batches, routes, onRefresh }: PipelineLogProps) {
  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Job cards */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
            Pipeline Jobs
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(JOBS).map(([label, job]) => (
              <JobCard
                key={job.event}
                label={label}
                job={job}
                onTriggered={onRefresh}
              />
            ))}
          </div>
        </div>

        <Separator />

        {/* Routing summary */}
        {routes.length > 0 && (
          <>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                Signal Routing
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {routes.map((r) => (
                  <Card key={r.analystId} className="p-4">
                    <p className="text-sm font-medium truncate">{r.analystName}</p>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-2xl font-semibold tabular-nums">
                        {r.totalRoutes}
                      </span>
                      <span className="text-xs text-muted-foreground">signals</span>
                    </div>
                    <div className="flex gap-2 mt-2 text-xs text-muted-foreground tabular-nums">
                      <span>{r.pending} pending</span>
                      <span>{r.read} read</span>
                    </div>
                    <div className="flex gap-1.5 mt-1.5">
                      {r.high > 0 && (
                        <Badge variant="destructive">{r.high} high</Badge>
                      )}
                      {r.medium > 0 && (
                        <Badge variant="secondary">{r.medium} med</Badge>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
            <Separator />
          </>
        )}

        {/* Activity log — expandable batch rows */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
            Job History
          </p>
          <div className="space-y-2">
            {batches.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No job runs yet
              </p>
            )}
            {batches.map((batch) => (
              <BatchRow key={batch.id} batch={batch} />
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── Batch Row (expandable) ──────────────────────────────────────────────────

function BatchRow({ batch }: { batch: SignalBatch }) {
  const [open, setOpen] = useState(false);
  const duration =
    batch.completedAt && batch.startedAt
      ? Math.round(
          (new Date(batch.completedAt).getTime() -
            new Date(batch.startedAt).getTime()) /
            1000
        )
      : null;

  const signalCount = batch._count.signals;
  const previews = batch.signals ?? [];

  // Extract unique tickers from signal previews
  const tickers = [...new Set(previews.flatMap((s) => s.tickers))].slice(0, 8);

  // Extract unique search queries/tools for summary
  const querySummary = summarizeBatch(previews);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="p-0 overflow-hidden">
        <CollapsibleTrigger
          render={<Button variant="ghost" className="w-full justify-start rounded-none px-4 py-3 h-auto" />}
        >
          <div className="flex items-center gap-3 w-full">
            {open ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}

            {/* Job name */}
            <span className="text-sm font-medium">
              {JOB_LABELS[batch.jobType] ?? batch.jobType}
            </span>

            {/* Status */}
            <BatchStatus status={batch.status} />

            {/* Signal count + duration */}
            <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground tabular-nums">
              <span>{signalCount} signals</span>
              {duration !== null && <span>{duration}s</span>}
              <span>{relativeTime(batch.startedAt)}</span>
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <Separator />
          <div className="p-4 space-y-3">
            {/* Tickers discovered */}
            {tickers.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                  Tickers
                </p>
                <div className="flex flex-wrap gap-1">
                  {tickers.map((t) => (
                    <Badge key={t} variant="secondary">
                      ${t}
                    </Badge>
                  ))}
                  {[...new Set(previews.flatMap((s) => s.tickers))].length > 8 && (
                    <span className="text-xs text-muted-foreground self-center">
                      +{[...new Set(previews.flatMap((s) => s.tickers))].length - 8} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* What ran — queries/endpoints */}
            {querySummary.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                  What ran
                </p>
                <div className="space-y-1">
                  {querySummary.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{item.tool}</span>
                      <span className="text-muted-foreground/40">→</span>
                      <span className="text-foreground truncate">{item.query}</span>
                      <span className="text-muted-foreground tabular-nums ml-auto shrink-0">
                        {item.count} signal{item.count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Signal previews */}
            {previews.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                  Signals (top {previews.length})
                </p>
                <div className="space-y-1">
                  {previews.map((s) => {
                    const urgency = URGENCY_CONFIG[s.urgency];
                    return (
                      <div key={s.id} className="flex items-center gap-2 text-xs">
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${urgency?.dot ?? "bg-muted-foreground/40"}`} />
                        <span className="truncate">{s.headline}</span>
                        {s.tickers.length > 0 && (
                          <span className="text-muted-foreground shrink-0">
                            {s.tickers.slice(0, 2).map((t) => `$${t}`).join(", ")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/** Group signal previews by tool+query to show what actually ran */
function summarizeBatch(previews: SignalBatch["signals"]): Array<{ tool: string; query: string; count: number }> {
  const groups = new Map<string, { tool: string; query: string; count: number }>();
  for (const s of previews) {
    const tool = s.searchTool ?? "Unknown";
    const query = s.searchQuery ?? s.searchContext ?? "—";
    const key = `${tool}::${query}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      const toolLabel =
        tool === "PERPLEXITY_SONAR" ? "Sonar" :
        tool === "FMP" ? "FMP" :
        tool === "FINNHUB" ? "Finnhub" :
        tool;
      groups.set(key, { tool: toolLabel, query, count: 1 });
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count);
}

// ── Batch Status Badge ──────────────────────────────────────────────────────

function BatchStatus({ status }: { status: string }) {
  switch (status) {
    case "COMPLETE":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-500 font-medium">
          <CheckCircle2 className="h-3 w-3" />
          Done
        </span>
      );
    case "RUNNING":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-blue-500 font-medium">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-red-500 font-medium">
          <XCircle className="h-3 w-3" />
          Failed
        </span>
      );
    default:
      return <span className="text-xs text-muted-foreground">{status}</span>;
  }
}

// ── Job Card ────────────────────────────────────────────────────────────────

function JobCard({
  label,
  job,
  onTriggered,
}: {
  label: string;
  job: JobInfo;
  onTriggered: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const Icon = job.icon;

  const trigger = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/intelligence/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: job.event }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`${label} triggered`);
      setTimeout(onTriggered, 3000);
    } catch (err) {
      toast.error(`Failed to trigger ${label}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 relative">
      {/* 3-dot menu */}
      <div className="absolute top-3 right-3">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={trigger} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run now
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDialogOpen(true)}>
              <Info className="h-4 w-4" />
              Learn more
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Icon */}
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Name */}
      <p className="text-sm font-medium mt-3">{label}</p>

      {/* Description */}
      <p className="text-xs text-muted-foreground mt-1">{job.short}</p>

      {/* Schedule time */}
      <div className="flex items-center gap-1 mt-3">
        <Clock className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs text-muted-foreground tabular-nums">
          {job.time}
        </span>
      </div>

      {/* Learn more dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{job.long}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="tabular-nums">Scheduled: {job.time} weekdays</span>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
