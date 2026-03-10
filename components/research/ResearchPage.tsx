"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Bot, FlaskConical, Loader2, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { ThesisCard } from "@/components/ThesisCard";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Analyst = {
  id: string;
  name: string;
  enabled: boolean;
};

export type TradeSummary = {
  id: string;
  realizedPnl: number | null;
  status: string;
  entryPrice: number;
  closePrice: number | null;
};

export type ThesisSummary = {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  holdDuration: string;
  signalTypes: string[];
  sector: string | null;
  reasoningSummary: string;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  createdAt: Date;
  trade: TradeSummary | null;
};

export type ResearchRun = {
  id: string;
  agentConfigId: string | null;
  analystName: string;
  status: string;
  source: string;
  startedAt: Date;
  completedAt: Date | null;
  theses: ThesisSummary[];
};

export type CompanyProfile = {
  name: string;
  logo: string;
  exchange: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ResearchPage({
  analysts,
  initialRuns,
  profiles,
  hasRunning,
}: {
  analysts: Analyst[];
  initialRuns: ResearchRun[];
  profiles: Record<string, CompanyProfile>;
  hasRunning: boolean;
}) {
  const [selectedAnalystId, setSelectedAnalystId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(hasRunning);

  const selectedAnalyst = analysts.find((a) => a.id === selectedAnalystId);

  const filteredRuns = selectedAnalystId
    ? initialRuns.filter((r) => r.agentConfigId === selectedAnalystId)
    : initialRuns;

  const handleRunNow = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/research/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentConfigId: selectedAnalystId }),
      });
      if (!res.ok) throw new Error("Request failed");
      setIsRunning(true);
      toast.success(
        selectedAnalyst
          ? `${selectedAnalyst.name} is running — results will appear shortly`
          : "All analysts running — results will appear shortly"
      );
    } catch {
      toast.error("Failed to start research. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const buttonDisabled = loading || isRunning;
  const buttonLabel = isRunning
    ? "Running…"
    : selectedAnalyst
      ? `Run ${selectedAnalyst.name}`
      : "Run All Analysts";

  return (
    <div className="flex flex-col min-h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-4 flex items-start justify-between gap-4 border-b">
        <div>
          <h1 className="text-2xl font-semibold">Research</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            AI analysts research markets and generate trade theses
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleRunNow}
          disabled={buttonDisabled}
          className="gap-2 shrink-0"
        >
          {buttonDisabled ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FlaskConical className="h-3.5 w-3.5" />
          )}
          {buttonLabel}
        </Button>
      </div>

      {/* ── Analyst pill bar ───────────────────────────────────────────────── */}
      {analysts.length > 0 && (
        <div className="px-6 py-3 border-b flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mr-1">
            Analyst
          </span>
          <button
            onClick={() => setSelectedAnalystId(null)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              selectedAnalystId === null
                ? "bg-foreground text-background border-foreground"
                : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
            }`}
          >
            All
          </button>
          {analysts.map((analyst) => (
            <button
              key={analyst.id}
              onClick={() =>
                setSelectedAnalystId(
                  analyst.id === selectedAnalystId ? null : analyst.id
                )
              }
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                selectedAnalystId === analyst.id
                  ? "bg-foreground text-background border-foreground"
                  : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
              }`}
            >
              <Bot className="h-3 w-3 shrink-0" />
              {analyst.name}
              {!analyst.enabled && (
                <span className="opacity-40 text-[10px]">off</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Feed ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 p-6 space-y-4">
        {/* No analysts */}
        {analysts.length === 0 && (
          <div className="rounded-lg border bg-card p-12 text-center">
            <Bot className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No analysts configured</p>
            <p className="text-sm text-muted-foreground mt-1">
              Go to Settings to create your first analyst.
            </p>
            <Link href="/settings">
              <Button size="sm" variant="outline" className="mt-4">
                Go to Settings
              </Button>
            </Link>
          </div>
        )}

        {/* Analysts exist but no runs */}
        {analysts.length > 0 && filteredRuns.length === 0 && (
          <div className="rounded-lg border bg-card p-12 text-center">
            <FlaskConical className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No research runs yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              {selectedAnalyst
                ? `${selectedAnalyst.name} hasn't run yet.`
                : 'Click "Run All Analysts" to kick off your first session.'}
            </p>
          </div>
        )}

        {/* Run cards */}
        {filteredRuns.map((run) => (
          <RunCard key={run.id} run={run} profiles={profiles} />
        ))}
      </div>
    </div>
  );
}

// ─── Run card ─────────────────────────────────────────────────────────────────

function RunCard({
  run,
  profiles,
}: {
  run: ResearchRun;
  profiles: Record<string, CompanyProfile>;
}) {
  const [expanded, setExpanded] = useState(true);

  const tradesPlaced = run.theses.filter((t) => t.trade !== null).length;
  const actionable = run.theses.filter((t) => t.direction !== "PASS").length;
  const isRunning = run.status === "RUNNING";
  const isFailed = run.status === "FAILED";

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Run header — link area navigates to detail, chevron collapses */}
      <div className="px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors">
        <Link
          href={`/research/runs/${run.id}`}
          className="flex items-center gap-3 flex-1 min-w-0"
        >
          {/* Analyst avatar */}
          <div className="h-7 w-7 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
            <Bot className="h-3.5 w-3.5 text-violet-500" />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{run.analystName}</span>
              {isRunning && (
                <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-amber-500/10 text-amber-500 uppercase tracking-wide leading-none">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  Running
                </span>
              )}
              {isFailed && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-red-500/10 text-red-500 uppercase tracking-wide leading-none">
                  Failed
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                {timeAgo(run.startedAt)}
              </span>
              {run.theses.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {run.theses.length} thesis{run.theses.length !== 1 ? "es" : ""}
                </span>
              )}
              {actionable > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {actionable} actionable
                </span>
              )}
              {tradesPlaced > 0 && (
                <span className="text-[11px] font-medium text-emerald-500">
                  {tradesPlaced} trade{tradesPlaced !== 1 ? "s" : ""} placed
                </span>
              )}
            </div>
          </div>
        </Link>

        {/* Collapse chevron — separate button */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-muted-foreground shrink-0 p-1 rounded hover:text-foreground transition-colors"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Thesis grid */}
      {expanded && !isRunning && run.theses.length > 0 && (
        <div className="border-t p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {run.theses.map((thesis) => (
              <ThesisCard
                key={thesis.id}
                thesis={thesis}
                profile={profiles[thesis.ticker]}
              />
            ))}
          </div>
        </div>
      )}

      {/* Running spinner */}
      {expanded && isRunning && (
        <div className="border-t px-4 py-8 text-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">Research in progress…</p>
        </div>
      )}

      {/* Empty / failed state */}
      {expanded && !isRunning && run.theses.length === 0 && (
        <div className="border-t px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            {isFailed
              ? "This run failed to produce results."
              : "No theses were generated in this run."}
          </p>
        </div>
      )}
    </div>
  );
}

