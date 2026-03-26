"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  Globe,
  GitBranch,
  Newspaper,
  MoreHorizontal,
  Play,
  Info,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import type { SignalBatch, AnalystRouteInfo } from "./types";
import { relativeTime, JOB_LABELS } from "./types";
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
  "Search Monitors": {
    icon: Search,
    event: "market-sweep",
    time: "6:30 AM ET",
    short: "Runs all search monitors and API monitors via Perplexity Sonar",
    long: "Runs every enabled search monitor through Perplexity Sonar, then calls FMP (gainers, losers, most active) and Finnhub (earnings calendar) APIs. Results are parsed into findings with tickers, sentiment, and urgency, then deduplicated.",
  },
  "Ticker Monitors": {
    icon: Briefcase,
    event: "portfolio-monitor",
    time: "7:00 AM ET",
    short: "Searches all portfolio positions and watchlist tickers for news",
    long: "For every open position and watchlist item across all analysts, searches Perplexity Sonar for recent news, developments, and catalysts. Each ticker gets its own search so nothing is missed.",
  },
  "Domain Monitors": {
    icon: Globe,
    event: "source-pack-monitor",
    time: "7:15 AM ET",
    short: "Checks monitored domains for new articles and extracts content",
    long: "Searches all enabled domain monitors via Perplexity Sonar with domain filtering. High-priority domains get full article extraction via Firecrawl for deep content analysis.",
  },
  "Route Findings": {
    icon: GitBranch,
    event: "signal-router",
    time: "7:30 AM ET",
    short: "Scores and routes findings to matching analysts",
    long: "Takes all unrouted findings and scores them against each analyst's sectors, watchlist, and coverage area. Each finding gets a relevance score so analysts see the most important items first in their briefs.",
  },
  "Generate Briefs": {
    icon: Newspaper,
    event: "morning-brief",
    time: "7:45 AM ET",
    short: "Creates personalized daily briefs for each analyst",
    long: "Uses GPT-4o to synthesize each analyst's routed findings into a structured brief: market context, portfolio alerts, watchlist updates, new opportunities, and attention priorities.",
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

        {/* Activity log table */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
            Job History
          </p>
          <Card className="p-0 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Signals</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      No job runs yet
                    </TableCell>
                  </TableRow>
                )}
                {batches.map((batch) => {
                  const duration =
                    batch.completedAt && batch.startedAt
                      ? Math.round(
                          (new Date(batch.completedAt).getTime() -
                            new Date(batch.startedAt).getTime()) /
                            1000
                        )
                      : null;

                  return (
                    <TableRow key={batch.id}>
                      <TableCell className="font-medium text-sm">
                        {JOB_LABELS[batch.jobType] ?? batch.jobType}
                      </TableCell>
                      <TableCell>
                        <BatchStatus status={batch.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {batch._count.signals}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {duration !== null ? `${duration}s` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                        {relativeTime(batch.startedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── Batch Status Badge ──────────────────────────────────────────────────────

function BatchStatus({ status }: { status: string }) {
  switch (status) {
    case "COMPLETE":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-500 font-medium">
          <CheckCircle2 className="h-3 w-3" />
          Completed
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
