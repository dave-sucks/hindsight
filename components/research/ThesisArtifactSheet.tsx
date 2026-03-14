"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ThesisCardData } from "@/components/domain";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(from: number, to: number): string {
  return (((to - from) / from) * 100).toFixed(1);
}

function rrRatio(entry: number, target: number, stop: number): string {
  const risk = entry - stop;
  if (risk === 0) return "\u2014";
  return ((target - entry) / risk).toFixed(1);
}

// ─── ThesisArtifactSheet ──────────────────────────────────────────────────────

export function ThesisArtifactSheet({
  thesis,
  children,
}: {
  thesis: ThesisCardData;
  children?: React.ReactNode;
}) {
  const isLong = thesis.direction === "LONG";
  const isShort = thesis.direction === "SHORT";
  const isPass = thesis.direction === "PASS";
  const DirIcon = isLong ? TrendingUp : TrendingDown;

  const hasEntry = thesis.entry_price != null;
  const hasTarget = thesis.target_price != null;
  const hasStop = thesis.stop_loss != null;

  const gainPct =
    hasEntry && hasTarget ? pct(thesis.entry_price!, thesis.target_price!) : null;
  const lossPct =
    hasEntry && hasStop ? pct(thesis.stop_loss!, thesis.entry_price!) : null;
  const rr =
    hasEntry && hasTarget && hasStop
      ? rrRatio(thesis.entry_price!, thesis.target_price!, thesis.stop_loss!)
      : null;

  return (
    <Sheet>
      <SheetTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              "border bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          />
        }
      >
        <FileText className="h-3.5 w-3.5" />
        {children ?? "View full analysis"}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto"
      >
        <SheetHeader className="border-b pb-4">
          <div className="flex items-center gap-3">
            <SheetTitle className="font-mono text-xl font-bold">
              {thesis.ticker}
            </SheetTitle>
            {!isPass && (
              <Badge
                variant="secondary"
                className={cn(
                  "gap-1 text-xs font-semibold",
                  isLong
                    ? "bg-positive/10 text-positive"
                    : "bg-negative/10 text-negative",
                )}
              >
                <DirIcon className="h-3.5 w-3.5" />
                {thesis.direction}
              </Badge>
            )}
            {isPass && (
              <Badge variant="secondary" className="text-xs">
                PASS
              </Badge>
            )}
            {thesis.hold_duration && (
              <Badge variant="outline" className="text-xs">
                {thesis.hold_duration}
              </Badge>
            )}
            <span
              className={cn(
                "ml-auto flex items-center justify-center rounded-full size-12 text-base font-bold tabular-nums",
                thesis.confidence_score >= 80
                  ? "bg-positive/10 text-positive"
                  : thesis.confidence_score >= 60
                    ? "bg-amber-500/15 text-amber-500"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {thesis.confidence_score}
            </span>
          </div>
        </SheetHeader>

        <div className="p-4 space-y-6">
          {/* Signal type badges */}
          {thesis.signal_types && thesis.signal_types.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {thesis.signal_types.map((s) => (
                <Badge
                  key={s}
                  variant="outline"
                  className="text-[10px] text-muted-foreground"
                >
                  {s.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}

          {/* Price grid — larger in artifact view */}
          {hasEntry && !isPass && (
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b bg-muted/20">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Price Levels
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-4 p-5 text-center">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                    Entry
                  </p>
                  <p className="text-lg tabular-nums font-bold">
                    ${thesis.entry_price!.toFixed(2)}
                  </p>
                </div>
                {hasTarget && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                      Target
                    </p>
                    <p className="text-lg tabular-nums font-bold text-positive">
                      ${thesis.target_price!.toFixed(2)}
                    </p>
                    {gainPct && (
                      <p className="text-xs text-positive/70 tabular-nums">
                        +{gainPct}%
                      </p>
                    )}
                  </div>
                )}
                {hasStop && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                      Stop Loss
                    </p>
                    <p className="text-lg tabular-nums font-bold text-negative">
                      ${thesis.stop_loss!.toFixed(2)}
                    </p>
                    {lossPct && (
                      <p className="text-xs text-negative/70 tabular-nums">
                        &minus;{lossPct}%
                      </p>
                    )}
                  </div>
                )}
                {rr != null && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                      R:R Ratio
                    </p>
                    <p
                      className={cn(
                        "text-lg tabular-nums font-bold",
                        parseFloat(rr) >= 2
                          ? "text-positive"
                          : parseFloat(rr) >= 1
                            ? "text-foreground"
                            : "text-negative",
                      )}
                    >
                      {rr}&times;
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Reasoning summary */}
          {thesis.reasoning_summary && (
            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Summary
              </span>
              <p className="text-sm leading-relaxed text-foreground/80">
                {thesis.reasoning_summary}
              </p>
            </div>
          )}

          {/* Two-column: Thesis bullets (pros) + Risk flags (cons) */}
          {((thesis.thesis_bullets?.length ?? 0) > 0 ||
            (thesis.risk_flags?.length ?? 0) > 0) && (
            <div className="grid grid-cols-2 gap-4">
              {/* Pros */}
              {thesis.thesis_bullets && thesis.thesis_bullets.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-positive">
                    Bull Case
                  </span>
                  <div className="space-y-2">
                    {thesis.thesis_bullets.map((b, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-sm"
                      >
                        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-positive" />
                        <span className="leading-relaxed">{b}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cons */}
              {thesis.risk_flags && thesis.risk_flags.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-negative">
                    Risk Factors
                  </span>
                  <div className="space-y-2">
                    {thesis.risk_flags.map((r, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-sm text-muted-foreground"
                      >
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-negative" />
                        <span className="leading-relaxed">{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pass reason */}
          {isPass && (thesis.pass_reason || thesis.reasoning_summary) && (
            <div className="rounded-md border-l-2 border-muted-foreground/30 pl-3">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {thesis.pass_reason || thesis.reasoning_summary}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
