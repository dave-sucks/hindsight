"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TradeReviewSheet } from "@/components/TradeReviewSheet";
import ResearchChatFull from "@/components/ResearchChatFull";
import {
  Bot,
  Clock,
  Loader2,
  TrendingUp,
  TrendingDown,
  ArrowLeft,
  CheckCircle,
  XCircle,
  ExternalLink,
  Newspaper,
  BarChart2,
  Brain,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { CompanyProfile } from "@/components/research/ResearchPage";

// ─── Types ────────────────────────────────────────────────────────────────────

type SourceItem = {
  type: string;
  provider: string;
  title: string;
  url?: string | null;
  published_at?: string | null;
};

type TradeSummary = {
  id: string;
  realizedPnl: number | null;
  status: string;
  entryPrice: number;
  closePrice: number | null;
};

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
  trade: TradeSummary | null;
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

function parseSources(raw: unknown): SourceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is SourceItem =>
      s !== null && typeof s === "object" && "title" in s && "type" in s
  );
}

function sourceIcon(type: string) {
  switch (type.toLowerCase()) {
    case "news":
      return <Newspaper className="h-3 w-3 shrink-0 text-muted-foreground" />;
    case "earnings":
    case "financials":
      return <BarChart2 className="h-3 w-3 shrink-0 text-muted-foreground" />;
    default:
      return <Brain className="h-3 w-3 shrink-0 text-muted-foreground" />;
  }
}

// ─── Detail Thesis Card ───────────────────────────────────────────────────────

function DetailThesisCard({
  thesis,
  profile,
}: {
  thesis: ThesisDetail;
  profile?: CompanyProfile;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const isLong = thesis.direction === "LONG";
  const isShort = thesis.direction === "SHORT";
  const isPass = thesis.direction === "PASS";

  const dirClass = isLong
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : isShort
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : "bg-muted text-muted-foreground";

  const trade = thesis.trade;
  const pnl = trade?.realizedPnl ?? null;
  const pnlColor =
    pnl != null ? (pnl >= 0 ? "text-emerald-500" : "text-red-500") : "";
  const alreadyTraded = trade !== null;

  const tradeStatusClass =
    trade?.status === "OPEN"
      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
      : trade?.status === "CLOSED" || trade?.status === "WIN"
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        : trade?.status === "LOSS"
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : "";

  const confidenceClass =
    thesis.confidenceScore >= 70
      ? "text-emerald-500"
      : thesis.confidenceScore >= 50
        ? "text-amber-500"
        : "text-red-500";

  const companyName =
    profile?.name && profile.name !== thesis.ticker ? profile.name : null;
  const exchange = profile?.exchange ?? null;
  const logoUrl = profile?.logo && !imgError ? profile.logo : null;
  const subtitle = [companyName, exchange].filter(Boolean).join(" · ");

  const sources = parseSources(thesis.sourcesUsed);

  return (
    <>
      <div className="rounded-lg border bg-background flex flex-col hover:border-foreground/25 transition-colors">
        {/* Body */}
        <div className="p-3 flex-1 space-y-2.5">
          {/* Header row */}
          <div className="flex items-start gap-2.5">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={thesis.ticker}
                onError={() => setImgError(true)}
                className="h-9 w-9 rounded-md object-contain bg-muted shrink-0 border border-border"
              />
            ) : (
              <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0 border border-border">
                {thesis.ticker.slice(0, 2)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Link
                  href={`/research/${thesis.id}`}
                  className="font-semibold text-sm text-foreground hover:underline leading-tight"
                >
                  {thesis.ticker}
                </Link>
                <span className="ml-auto flex items-center gap-1.5 shrink-0">
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full leading-none ${dirClass}`}
                  >
                    {thesis.direction}
                  </span>
                  {trade && (
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full leading-none ${tradeStatusClass}`}
                    >
                      {trade.status}
                    </span>
                  )}
                </span>
              </div>
              {subtitle && (
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight truncate">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {/* Reasoning summary */}
          <p className="text-xs text-muted-foreground leading-relaxed">
            {thesis.reasoningSummary}
          </p>

          {/* Thesis bullets */}
          {thesis.thesisBullets.length > 0 && (
            <ul className="space-y-1">
              {thesis.thesisBullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <CheckCircle className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" />
                  <span className="text-xs text-muted-foreground leading-snug">
                    {bullet}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Risk flags */}
          {thesis.riskFlags.length > 0 && (
            <ul className="space-y-1">
              {thesis.riskFlags.map((flag, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <XCircle className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />
                  <span className="text-xs text-muted-foreground leading-snug">
                    {flag}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Signal type badges */}
          {thesis.signalTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {thesis.signalTypes.map((s) => (
                <Badge
                  key={s}
                  variant="outline"
                  className="text-[10px] px-1.5 py-0"
                >
                  {s.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}

          {/* Sources — collapsible */}
          {sources.length > 0 && (
            <div>
              <Separator className="mb-2" />
              <button
                onClick={() => setSourcesExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                <Newspaper className="h-3 w-3" />
                <span>
                  {sources.length} source{sources.length !== 1 ? "s" : ""} read
                </span>
                <span className="ml-auto">
                  {sourcesExpanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                </span>
              </button>
              {sourcesExpanded && (
                <ul className="mt-2 space-y-1.5">
                  {sources.map((src, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      {sourceIcon(src.type)}
                      <div className="flex-1 min-w-0">
                        {src.url ? (
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-foreground hover:underline flex items-center gap-1 leading-snug"
                          >
                            <span className="truncate">{src.title}</span>
                            <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                            {src.title}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
                          {src.provider}
                          {src.published_at
                            ? ` · ${new Date(src.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                            : ""}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Model used */}
          {thesis.modelUsed && (
            <p className="text-[10px] text-muted-foreground/50 font-mono">
              {thesis.modelUsed}
            </p>
          )}
        </div>

        {/* Price stats bar */}
        <div className="border-t px-3 py-2 grid grid-cols-4 gap-2 bg-muted/20">
          {(
            [
              { label: "Entry", value: thesis.entryPrice, color: "text-foreground" },
              { label: "Target", value: thesis.targetPrice, color: "text-emerald-500" },
              { label: "Stop", value: thesis.stopLoss, color: "text-red-500" },
            ] as const
          ).map(({ label, value, color }) => (
            <div key={label}>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-none">
                {label}
              </p>
              <p className={`text-xs font-semibold tabular-nums mt-0.5 ${color}`}>
                {value != null ? `$${value.toFixed(2)}` : "—"}
              </p>
            </div>
          ))}
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-none">
              Conf.
            </p>
            <p className={`text-xs font-semibold tabular-nums mt-0.5 ${confidenceClass}`}>
              {thesis.confidenceScore}%
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-3 py-2 flex items-center justify-between">
          <div>
            {pnl != null ? (
              <span className={`text-xs font-semibold tabular-nums ${pnlColor}`}>
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} P&L
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {thesis.holdDuration}
              </span>
            )}
          </div>
          {!alreadyTraded && !isPass ? (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px] gap-1 px-2"
              onClick={() => setSheetOpen(true)}
            >
              {isLong ? (
                <TrendingUp className="h-3 w-3 text-emerald-500" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              Trade
            </Button>
          ) : alreadyTraded && trade ? (
            <Button
              render={<Link href={`/trades/${trade.id}`} />}
              size="sm"
              variant="ghost"
              className="h-6 text-[11px] px-2"
            >
              View →
            </Button>
          ) : null}
        </div>
      </div>

      <TradeReviewSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        thesis={{
          id: thesis.id,
          ticker: thesis.ticker,
          direction: thesis.direction,
          entryPrice: thesis.entryPrice,
          targetPrice: thesis.targetPrice,
          stopLoss: thesis.stopLoss,
          confidenceScore: thesis.confidenceScore,
          holdDuration: thesis.holdDuration,
        }}
      />
    </>
  );
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

  // Total sources read across all theses
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

              {/* Timing + stats row */}
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

              {/* Agent config params */}
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
                <DetailThesisCard
                  key={thesis.id}
                  thesis={thesis}
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
