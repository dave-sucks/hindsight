"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import ResearchChatFull from "@/components/ResearchChatFull";
import { Bot, Clock, Loader2, ArrowLeft, Newspaper } from "lucide-react";
import type { CompanyProfile } from "@/components/research/ResearchPage";
import { ThesisCard, parseSources } from "@/components/ThesisCard";

// ─── Types ────────────────────────────────────────────────────────────────────

type ThesisDetail = {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  holdDuration: string;
  signalTypes: string[];
  sector: string | null;
  reasoningSummary: string;
  thesisBullets: string[];
  riskFlags: string[];
  sourcesUsed: unknown;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  modelUsed: string | null;
  createdAt: Date;
  currentPrice?: number | null;
  trade: {
    id: string;
    realizedPnl: number | null;
    status: string;
    entryPrice: number;
    closePrice: number | null;
  } | null;
};

type RunDetail = {
  id: string;
  analystId: string | null;
  analystName: string;
  status: string;
  source: string;
  startedAt: Date;
  completedAt: Date | null;
  parameters: unknown;
  theses: ThesisDetail[];
};

type RecentThesis = {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  reasoningSummary: string;
  createdAt: Date;
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

// ─── Run Parameters badge row ─────────────────────────────────────────────────

function RunParamBadges({ params }: { params: unknown }) {
  if (!params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;

  const items: { label: string; value: string }[] = [];
  if (p.directionBias) items.push({ label: "Bias", value: String(p.directionBias) });
  if (p.minConfidence != null) items.push({ label: "Min conf.", value: `${p.minConfidence}%` });
  if (Array.isArray(p.holdDurations) && p.holdDurations.length)
    items.push({ label: "Hold", value: p.holdDurations.join(", ") });
  if (p.maxOpenPositions != null)
    items.push({ label: "Max pos.", value: String(p.maxOpenPositions) });
  if (p.maxPositionSize != null)
    items.push({ label: "Size", value: `$${p.maxPositionSize}` });

  if (!items.length) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {items.map(({ label, value }) => (
        <span
          key={label}
          className="text-[11px] text-muted-foreground border rounded-sm px-2 py-0.5"
        >
          <span className="font-medium uppercase tracking-wide text-[10px]">
            {label}
          </span>{" "}
          {value}
        </span>
      ))}
    </div>
  );
}


// ─── Main Component ───────────────────────────────────────────────────────────

export default function RunDetailClient({
  run,
  profiles,
  userId,
  recentTheses,
  hasRunning,
}: {
  run: RunDetail;
  profiles: Record<string, CompanyProfile>;
  userId: string;
  recentTheses: RecentThesis[];
  hasRunning: boolean;
}) {
  const isRunning = run.status === "RUNNING";
  const isFailed = run.status === "FAILED";
  const tradesPlaced = run.theses.filter((t) => t.trade !== null).length;
  const actionable = run.theses.filter((t) => t.direction !== "PASS").length;
  const totalSources = run.theses.reduce(
    (acc, t) => acc + parseSources(t.sourcesUsed).length,
    0
  );

  return (
    <div className="flex h-[calc(100dvh-5.25rem)] overflow-hidden">
      {/* ── LEFT: Run info + thesis grid ──────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {/* Run header */}
        <div className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center gap-2 mb-3">
            <Link
              href="/research"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Research
            </Link>
          </div>
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="h-4 w-4 text-violet-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-medium">{run.analystName}</h1>
                {isRunning && (
                  <Badge className="bg-amber-500/10 text-amber-500 border-0 text-[11px]">
                    <Loader2 className="h-2.5 w-2.5 animate-spin mr-1" />
                    Running
                  </Badge>
                )}
                {isFailed && (
                  <Badge variant="destructive" className="text-[11px]">
                    Failed
                  </Badge>
                )}
                {!isRunning && !isFailed && (
                  <Badge variant="secondary" className="text-[11px]">
                    Complete
                  </Badge>
                )}
                <Badge variant="outline" className="text-[11px]">
                  {run.source}
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {timeAgo(run.startedAt)}
                </span>
                {run.theses.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {run.theses.length} thesis{run.theses.length !== 1 ? "es" : ""}
                  </span>
                )}
                {actionable > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {actionable} actionable
                  </span>
                )}
                {tradesPlaced > 0 && (
                  <span className="text-xs font-medium text-emerald-500">
                    {tradesPlaced} trade{tradesPlaced !== 1 ? "s" : ""} placed
                  </span>
                )}
                {totalSources > 0 && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Newspaper className="h-3 w-3" />
                    {totalSources} sources read
                  </span>
                )}
              </div>
              <RunParamBadges params={run.parameters} />
            </div>
          </div>
        </div>

        {/* Thesis grid */}
        <div className="p-6">
          {isRunning ? (
            <div className="py-16 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Research in progress…</p>
            </div>
          ) : run.theses.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {isFailed
                  ? "This run failed to produce results."
                  : "No theses were generated in this run."}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {run.theses.map((thesis) => (
                <ThesisCard
                  key={thesis.id}
                  thesis={{ ...thesis, createdAt: thesis.createdAt.toISOString() }}
                  profile={profiles[thesis.ticker]}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Chat panel ─────────────────────────────────────────────── */}
      <div className="hidden lg:flex w-[420px] border-l flex-col overflow-hidden shrink-0">
        <ResearchChatFull
          userId={userId}
          recentTheses={recentTheses}
          hasRunning={hasRunning}
          analystId={run.analystId ?? undefined}
          className="flex flex-col h-full"
        />
      </div>
    </div>
  );
}
