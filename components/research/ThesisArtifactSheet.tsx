"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ThesisCardData } from "@/components/domain";
import { PriceGauge } from "@/components/domain/price-gauge";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { StockLogo } from "@/components/StockLogo";

// ─── ThesisArtifactSheet ──────────────────────────────────────────────────────

export function ThesisArtifactSheet({
  thesis,
  children,
}: {
  thesis: ThesisCardData;
  children?: React.ReactNode;
}) {
  const isLong = thesis.direction === "LONG";
  const isPass = thesis.direction === "PASS";
  const DirIcon = isLong ? TrendingUp : TrendingDown;

  const hasEntry = thesis.entry_price != null;
  const hasTarget = thesis.target_price != null;
  const hasStop = thesis.stop_loss != null;

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
        {/* ── Header: Logo + name + direction + confidence ──────── */}
        <SheetHeader className="border-b pb-4">
          <div className="flex items-center gap-3">
            <StockLogo ticker={thesis.ticker} size="lg" />
            <div>
              <SheetTitle className="text-lg font-bold">
                {thesis.company_name ?? thesis.ticker}
              </SheetTitle>
              <span className="text-xs font-mono text-muted-foreground">
                {thesis.ticker}
                {thesis.exchange ? ` · ${thesis.exchange}` : ""}
              </span>
            </div>
            {!isPass && (
              <Badge variant={isLong ? "positive" : "negative"}>
                <DirIcon className="h-3.5 w-3.5" />
                {thesis.direction}
              </Badge>
            )}
            {isPass && (
              <Badge variant="secondary">
                PASS
              </Badge>
            )}
            {thesis.hold_duration && (
              <Badge variant="outline">
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
                >
                  {s.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}

          {/* Price gauge — visual overview */}
          {hasEntry && !isPass && (hasTarget || hasStop) && (
            <PriceGauge
              entry={thesis.entry_price!}
              target={thesis.target_price}
              stop={thesis.stop_loss}
              direction={thesis.direction === "SHORT" ? "SHORT" : "LONG"}
            />
          )}

          {/* Price details row */}
          {hasEntry && !isPass && (
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
              <span>
                <span className="uppercase tracking-wide">Entry</span>{" "}
                <span className="tabular-nums font-medium text-foreground/70">
                  ${thesis.entry_price!.toFixed(2)}
                </span>
              </span>
              {hasTarget && (
                <span>
                  <span className="uppercase tracking-wide">Target</span>{" "}
                  <span className="tabular-nums font-medium text-positive">
                    ${thesis.target_price!.toFixed(2)}
                  </span>
                </span>
              )}
              {hasStop && (
                <span>
                  <span className="uppercase tracking-wide">Stop</span>{" "}
                  <span className="tabular-nums font-medium text-negative">
                    ${thesis.stop_loss!.toFixed(2)}
                  </span>
                </span>
              )}
              {hasEntry && hasTarget && hasStop && (thesis.entry_price! - thesis.stop_loss!) !== 0 && (
                <span>
                  <span className="uppercase tracking-wide">R:R</span>{" "}
                  {(() => {
                    const rr = ((thesis.target_price! - thesis.entry_price!) / (thesis.entry_price! - thesis.stop_loss!)).toFixed(1);
                    return (
                      <span
                        className={cn(
                          "tabular-nums font-medium",
                          parseFloat(rr) >= 2
                            ? "text-positive"
                            : parseFloat(rr) >= 1
                              ? "text-foreground/70"
                              : "text-negative",
                        )}
                      >
                        {rr}&times;
                      </span>
                    );
                  })()}
                </span>
              )}
            </div>
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
