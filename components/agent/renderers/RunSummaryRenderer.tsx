"use client";

import type { ToolResult } from "@/lib/agent/tool-result";
import { StockLogo } from "@/components/StockLogo";
import { cn } from "@/lib/utils";

interface RankedPick {
  ticker: string;
  direction: string;
  confidence: number;
  reasoning: string;
  action: string;
}

interface Props {
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

type ActionStyle = { dot: string; label: string };

function actionStyle(action: string): ActionStyle {
  const a = action.toUpperCase();
  if (a === "FAILED")                return { dot: "bg-red-500",     label: "Failed" };
  if (a === "PASS")                  return { dot: "bg-muted-foreground/40", label: "Pass" };
  if (a === "HOLD")                  return { dot: "bg-muted-foreground/40", label: "Hold" };
  if (a === "EXIT" || a === "REDUCE") return { dot: "bg-orange-400",  label: a === "EXIT" ? "Exit" : "Reduce" };
  if (a === "WATCH")                 return { dot: "bg-blue-400",     label: "Watch" };
  if (a === "REMOVE_WATCH")          return { dot: "bg-muted-foreground/40", label: "Removed" };
  // INITIATE / ADD
  return { dot: "bg-emerald-500", label: a === "ADD" ? "Add" : "Buy" };
}

export function RunSummaryRenderer({ result, loading }: Props) {
  const data = result.data as {
    rankedPicks?: RankedPick[];
    exposureBreakdown?: { longExposure: number; shortExposure: number; netExposure: number };
    traded?: number;
    analyzed?: number;
  } | null;

  const picks = data?.rankedPicks ?? [];
  const longExposure = data?.exposureBreakdown?.longExposure;

  const header =
    longExposure && longExposure > 0
      ? `Summarizing run — $${Math.round(longExposure).toLocaleString()} invested`
      : "Summarizing run";

  if (loading) {
    return (
      <div className="my-2 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
        <p className="text-sm text-muted-foreground">Summarizing run…</p>
      </div>
    );
  }

  if (picks.length === 0) {
    return (
      <div className="my-2 rounded-lg border px-4 py-3">
        <p className="text-sm text-muted-foreground">{result.summary}</p>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border overflow-hidden">
      <div className="px-4 py-2.5 border-b bg-muted/30">
        <p className="text-sm text-muted-foreground font-medium">{header}</p>
      </div>
      <div className="divide-y">
        {picks.map((pick) => {
          const style = actionStyle(pick.action);
          return (
            <div key={pick.ticker} className="flex items-center gap-3 px-4 py-2.5">
              <StockLogo ticker={pick.ticker} size="sm" />
              <span className="text-sm font-semibold tabular-nums w-14 shrink-0">
                {pick.ticker}
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className={cn("size-1.5 rounded-full shrink-0", style.dot)} />
                <span className="text-xs text-muted-foreground">{style.label}</span>
              </span>
              <span className="text-sm text-muted-foreground leading-snug line-clamp-1 min-w-0">
                {pick.reasoning}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
