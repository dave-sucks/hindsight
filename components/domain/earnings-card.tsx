"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EarningsCardData = {
  ticker?: string;
  nextEarnings?: {
    date: string;
    epsEstimate: number | null;
  } | null;
  beatRate?: string;
  recentQuarters?: {
    period: string;
    actualEps: number | null;
    estimatedEps: number | null;
    surprise: number | null;
    surprisePct: number | null;
  }[];
};

export type EarningsCardProps = ComponentProps<typeof Card> & EarningsCardData;

// ─── EarningsCard — compact inline block ─────────────────────────────────────

export function EarningsCard({
  ticker,
  nextEarnings,
  beatRate,
  recentQuarters = [],
  className,
  ...cardProps
}: EarningsCardProps) {
  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* Compact header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <span className="text-xs font-medium text-muted-foreground">Earnings</span>
        {ticker && <span className="text-xs font-mono font-medium">{ticker}</span>}
        <div className="ml-auto flex items-center gap-2">
          {beatRate && beatRate !== "no history" && (
            <Badge variant="secondary" className="text-[10px] py-0 tabular-nums">
              {beatRate} beat
            </Badge>
          )}
          {nextEarnings && (
            <span className="text-[10px] text-muted-foreground">
              Next: <span className="font-medium text-foreground/70">{nextEarnings.date}</span>
              {nextEarnings.epsEstimate != null && (
                <> · Est ${nextEarnings.epsEstimate.toFixed(2)}</>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Recent quarters — tight horizontal rows */}
      {recentQuarters.length > 0 && (
        <div className="divide-y divide-border/40">
          {recentQuarters.slice(0, 4).map((q, i) => {
            const beat = q.actualEps != null && q.estimatedEps != null && q.actualEps > q.estimatedEps;
            const miss = q.actualEps != null && q.estimatedEps != null && q.actualEps < q.estimatedEps;
            return (
              <div key={i} className="flex items-center gap-2 px-4 py-1.5 text-xs">
                {beat ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                ) : miss ? (
                  <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                ) : (
                  <div className="h-3 w-3 rounded-full bg-muted-foreground/20 shrink-0" />
                )}
                <span className="font-mono text-muted-foreground w-12 shrink-0">{q.period}</span>
                <span className="tabular-nums">
                  {q.actualEps != null ? `$${q.actualEps.toFixed(2)}` : "—"}
                </span>
                <span className="text-muted-foreground">vs</span>
                <span className="tabular-nums text-muted-foreground">
                  {q.estimatedEps != null ? `$${q.estimatedEps.toFixed(2)}` : "—"}
                </span>
                {q.surprisePct != null && (
                  <span
                    className={cn(
                      "ml-auto tabular-nums font-medium",
                      beat ? "text-emerald-500" : miss ? "text-red-500" : "",
                    )}
                  >
                    {q.surprisePct >= 0 ? "+" : ""}{q.surprisePct.toFixed(1)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
