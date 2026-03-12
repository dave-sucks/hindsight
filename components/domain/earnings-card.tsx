"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Calendar, CheckCircle2, XCircle } from "lucide-react";

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

// ─── EarningsCard ─────────────────────────────────────────────────────────────

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
      <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold">
            Earnings
            {ticker && (
              <span className="ml-1.5 font-mono text-muted-foreground">
                {ticker}
              </span>
            )}
          </span>
        </div>
        {beatRate && beatRate !== "no history" && (
          <Badge variant="secondary" className="text-[10px] tabular-nums">
            Beat Rate: {beatRate}
          </Badge>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Next earnings */}
        {nextEarnings && (
          <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">Next Earnings</p>
              <p className="text-sm font-semibold">{nextEarnings.date}</p>
            </div>
            {nextEarnings.epsEstimate != null && (
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">
                  EPS Est.
                </p>
                <p className="text-sm tabular-nums font-semibold">
                  ${nextEarnings.epsEstimate.toFixed(2)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Recent quarters */}
        {recentQuarters.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recent Quarters
            </span>
            <div className="space-y-1.5">
              {recentQuarters.map((q, i) => {
                const beat =
                  q.actualEps != null &&
                  q.estimatedEps != null &&
                  q.actualEps > q.estimatedEps;
                const miss =
                  q.actualEps != null &&
                  q.estimatedEps != null &&
                  q.actualEps < q.estimatedEps;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2"
                  >
                    {beat ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    ) : miss ? (
                      <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full bg-muted-foreground/30 shrink-0" />
                    )}
                    <span className="text-xs font-mono text-muted-foreground w-16">
                      {q.period}
                    </span>
                    <div className="flex-1 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <p className="text-[10px] text-muted-foreground">
                          Actual
                        </p>
                        <p className="text-xs tabular-nums font-semibold">
                          {q.actualEps != null
                            ? `$${q.actualEps.toFixed(2)}`
                            : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">
                          Est.
                        </p>
                        <p className="text-xs tabular-nums font-semibold">
                          {q.estimatedEps != null
                            ? `$${q.estimatedEps.toFixed(2)}`
                            : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">
                          Surprise
                        </p>
                        <p
                          className={cn(
                            "text-xs tabular-nums font-semibold",
                            beat ? "text-emerald-500" : miss ? "text-red-500" : ""
                          )}
                        >
                          {q.surprisePct != null
                            ? `${q.surprisePct >= 0 ? "+" : ""}${q.surprisePct.toFixed(1)}%`
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
