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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import type { SignalBatch, AnalystRouteInfo } from "./types";
import { relativeTime, JOB_LABELS, JOB_TRIGGERS } from "./types";

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
        {/* Job triggers */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
            Manual Triggers
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(JOB_TRIGGERS).map(([label, { event, time }]) => (
              <JobTriggerButton
                key={event}
                label={label}
                event={event}
                time={time}
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

// ── Job Trigger Button ──────────────────────────────────────────────────────

function JobTriggerButton({
  label,
  event,
  time,
  onTriggered,
}: {
  label: string;
  event: string;
  time: string;
  onTriggered: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const trigger = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/intelligence/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: event }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`${label} triggered`);
      // Wait a bit for the job to register, then refresh
      setTimeout(onTriggered, 3000);
    } catch (err) {
      toast.error(`Failed to trigger ${label}`);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          variant="outline"
          size="sm"
          onClick={trigger}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-1.5" />
          )}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-center">
          <p>Run {label.toLowerCase()} now</p>
          <p className="text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Auto: {time} ET weekdays
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
