"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bot,
  FlaskConical,
  Loader2,
  TrendingUp,
  TrendingDown,
  Clock,
  ChevronDown,
  ChevronUp,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { TradeReviewSheet } from "@/components/TradeReviewSheet";

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

// ─── New Run Sheet ─────────────────────────────────────────────────────────────

function NewRunSheet({
  analysts,
  open,
  onOpenChange,
}: {
  analysts: Analyst[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [tickers, setTickers] = useState("");
  const [analystId, setAnalystId] = useState<string>("none");
  const [submitting, setSubmitting] = useState(false);

  const handleStart = async () => {
    setSubmitting(true);
    try {
      const tickerList = tickers
        .split(/[\s,]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);

      const res = await fetch("/api/research/run/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "MANUAL",
          tickers: tickerList.length > 0 ? tickerList : undefined,
          agentConfigId: analystId !== "none" ? analystId : undefined,
        }),
      });

      if (!res.body) throw new Error("No stream body");

      // Read just enough to get the run.created event
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let runId: string | null = null;

      while (!runId) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            if (ev.type === "run.created" && typeof ev.runId === "string") {
              runId = ev.runId;
            }
          } catch {
            // continue
          }
        }
      }

      reader.cancel().catch(() => undefined);

      if (runId) {
        onOpenChange(false);
        router.push(`/research/runs/${runId}`);
      } else {
        throw new Error("Did not receive run ID");
      }
    } catch {
      toast.error("Failed to start run. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>New Research Run</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 px-1 py-4">
          {/* Tickers */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Tickers{" "}
              <span className="normal-case font-normal text-muted-foreground/60">(optional)</span>
            </Label>
            <Input
              placeholder="AAPL, TSLA, NVDA"
              value={tickers}
              onChange={(e) => setTickers(e.target.value)}
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to let the scanner discover candidates automatically.
            </p>
          </div>

          {/* Analyst */}
          {analysts.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Analyst{" "}
                <span className="normal-case font-normal text-muted-foreground/60">(optional)</span>
              </Label>
              <Select value={analystId} onValueChange={setAnalystId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="No analyst" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No analyst (default settings)</SelectItem>
                  {analysts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row gap-2 border-t pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={submitting} className="flex-1 gap-2">
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <FlaskConical className="h-3.5 w-3.5" />
                Start Run
              </>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
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
  const [newRunOpen, setNewRunOpen] = useState(false);

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
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setNewRunOpen(true)}
            className="gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            New Run
          </Button>
          <Button
            size="sm"
            onClick={handleRunNow}
            disabled={buttonDisabled}
            className="gap-2"
          >
            {buttonDisabled ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FlaskConical className="h-3.5 w-3.5" />
            )}
            {buttonLabel}
          </Button>
        </div>
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

      <NewRunSheet
        analysts={analysts}
        open={newRunOpen}
        onOpenChange={setNewRunOpen}
      />
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

// ─── Thesis card ──────────────────────────────────────────────────────────────

function ThesisCard({
  thesis,
  profile,
}: {
  thesis: ThesisSummary;
  profile?: CompanyProfile;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

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

  const statCols = [
    { label: "Entry", value: thesis.entryPrice, color: "text-foreground" },
    { label: "Target", value: thesis.targetPrice, color: "text-emerald-500" },
    { label: "Stop", value: thesis.stopLoss, color: "text-red-500" },
  ] as const;

  return (
    <>
      <div className="rounded-lg border bg-background flex flex-col hover:border-foreground/25 transition-colors">
        {/* Body */}
        <div className="p-3 flex-1 space-y-2">
          <div className="flex items-start gap-2.5">
            {/* Logo */}
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

          <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {thesis.reasoningSummary}
          </p>
        </div>

        {/* Price stats bar */}
        <div className="border-t px-3 py-2 grid grid-cols-4 gap-2 bg-muted/20">
          {statCols.map(({ label, value, color }) => (
            <div key={label}>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-none">
                {label}
              </p>
              <p
                className={`text-xs font-semibold tabular-nums mt-0.5 ${color}`}
              >
                {value != null ? `$${value.toFixed(2)}` : "—"}
              </p>
            </div>
          ))}
          <div>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide leading-none">
              Conf.
            </p>
            <p
              className={`text-xs font-semibold tabular-nums mt-0.5 ${confidenceClass}`}
            >
              {thesis.confidenceScore}%
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-3 py-2 flex items-center justify-between">
          <div>
            {pnl != null ? (
              <span
                className={`text-xs font-semibold tabular-nums ${pnlColor}`}
              >
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
            <Link href={`/trades/${trade.id}`}>
              <Button size="sm" variant="ghost" className="h-6 text-[11px] px-2">
                View →
              </Button>
            </Link>
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
