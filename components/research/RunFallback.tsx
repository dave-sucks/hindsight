"use client";

/**
 * RunFallback — displayed on /runs/[id] when chat message replay is unavailable.
 *
 * Shows the run's actual output (theses, trades, events, sources) so the user
 * can still see what happened during the run. Uses the same tabbed layout as
 * AgentChat but with an events timeline instead of the chat thread.
 */

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RunSourcesPanel } from "@/components/research/run-sources-panel";
import { ThesisRow, type ThesisRowData } from "@/components/ui/thesis-row";
import type { RunSourceItem } from "@/lib/actions/run-sources.actions";
import type { MorningBrief as IntelMorningBrief } from "@/components/intelligence/types";
import {
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  FileText,
  TrendingUp,
  ListChecks,
  XCircle,
  Eye,
  Bookmark,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RunEvent {
  id: string;
  type: string;
  title: string;
  message: string | null;
  payload: unknown;
  createdAt: Date;
}

interface RunFallbackProps {
  status: string;
  analystName: string;
  error?: string;
  brief: IntelMorningBrief | null;
  sources: RunSourceItem[];
  theses: ThesisRowData[];
  runEvents: RunEvent[];
}

// ── Event icon map ─────────────────────────────────────────────────────────────

function eventIcon(type: string) {
  switch (type) {
    case "trade_placed":
      return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
    case "position_closed":
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "thesis_complete":
      return <FileText className="h-3.5 w-3.5 text-blue-500" />;
    case "skip":
      return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
    case "watchlist_add":
    case "watchlist_remove":
      return <Bookmark className="h-3.5 w-3.5 text-amber-500" />;
    case "run_complete":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "run_summary":
      return <ListChecks className="h-3.5 w-3.5 text-foreground" />;
    case "run_failed":
    case "run_error":
      return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
    case "position_modified":
      return <ArrowUpRight className="h-3.5 w-3.5 text-blue-500" />;
    default:
      return <ArrowDownRight className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function formatTime(date: Date) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

export function RunFallback({
  status,
  analystName,
  error,
  brief,
  sources,
  theses,
  runEvents,
}: RunFallbackProps) {
  const hasAnyData = runEvents.length > 0 || theses.length > 0 || sources.length > 0;

  // If truly no data at all, show the original empty state
  if (!hasAnyData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2 px-6">
        <div className="h-2.5 w-2.5 rounded-full bg-negative" />
        <p className="text-sm font-medium text-foreground">
          {status === "FAILED" ? "Run failed" : "No replay data available"}
        </p>
        <p className="text-xs max-w-xs">
          {status === "FAILED"
            ? "This run stopped before completing. It may have timed out or encountered an error."
            : "This run completed before message persistence was enabled."}
        </p>
        {status === "FAILED" && error && (
          <p className="text-xs max-w-md font-mono text-negative mt-2 bg-negative/5 rounded-md px-3 py-2 border border-negative/10">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <Tabs defaultValue={0} className="flex h-full flex-col">
      <div className="shrink-0 px-4 pt-2 flex items-center gap-3">
        <TabsList>
          <TabsTrigger value={0}>Activity</TabsTrigger>
          <TabsTrigger value={1}>Sources</TabsTrigger>
          <TabsTrigger value={2}>Theses</TabsTrigger>
        </TabsList>
        <span className="text-xs text-muted-foreground">{analystName}</span>
      </div>

      {/* Activity timeline — shows run events */}
      <TabsContent value={0} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {status === "FAILED" && error && (
            <div className="mb-4 rounded-md bg-negative/5 border border-negative/10 px-3 py-2">
              <p className="text-xs font-medium text-negative">Run failed</p>
              <p className="text-xs font-mono text-negative/80 mt-1">{error}</p>
            </div>
          )}

          {runEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <p className="text-sm">No activity events recorded</p>
              <p className="text-xs mt-1">Check the Theses and Sources tabs for run output</p>
            </div>
          ) : (
            <div className="space-y-1">
              {runEvents.map((evt) => (
                <div key={evt.id} className="flex items-start gap-3 rounded-md px-3 py-2.5 hover:bg-muted/50 transition-colors">
                  <div className="mt-0.5 shrink-0">{eventIcon(evt.type)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground leading-snug">
                      {evt.title}
                    </p>
                    {evt.message && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {evt.message}
                      </p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 mt-0.5">
                    {formatTime(evt.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      {/* Sources */}
      <TabsContent value={1} className="flex-1 min-h-0 overflow-y-auto">
        <RunSourcesPanel brief={brief} sources={sources} />
      </TabsContent>

      {/* Theses */}
      <TabsContent value={2} className="flex-1 min-h-0 overflow-y-auto">
        {theses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <p className="text-sm">No theses recorded</p>
            <p className="text-xs mt-1">Theses appear here once the agent records its picks</p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-2xl px-4 py-6 space-y-2">
            {theses.map((t) => (
              <ThesisRow key={t.id} thesis={t} />
            ))}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
