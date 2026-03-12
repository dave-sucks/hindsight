"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { CitedText } from "../chat/CitedText";
import type { SourceChipData } from "../chat/SourceChip";
import { SourceChipRow } from "../chat/SourceChip";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ThesisCardData = {
  ticker: string;
  direction: "LONG" | "SHORT" | "PASS";
  confidence_score: number;
  reasoning_summary?: string;
  thesis_bullets?: string[];
  risk_flags?: string[];
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  hold_duration?: string;
  signal_types?: string[];
  sources?: SourceChipData[];
  pass_reason?: string;
};

export type ThesisCardProps = ComponentProps<typeof Card> & ThesisCardData;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(from: number, to: number): string {
  return (((to - from) / from) * 100).toFixed(1);
}

function rrRatio(entry: number, target: number, stop: number): string {
  const risk = entry - stop;
  if (risk === 0) return "\u2014";
  return ((target - entry) / risk).toFixed(1);
}

// ─── ThesisCard ───────────────────────────────────────────────────────────────

export function ThesisCard({
  ticker,
  direction,
  confidence_score,
  reasoning_summary,
  thesis_bullets = [],
  risk_flags = [],
  entry_price,
  target_price,
  stop_loss,
  hold_duration,
  signal_types = [],
  sources = [],
  pass_reason,
  className,
  ...cardProps
}: ThesisCardProps) {
  const isLong = direction === "LONG";
  const isShort = direction === "SHORT";
  const isPass = direction === "PASS";
  const dirColor = isLong
    ? "text-emerald-500"
    : isShort
      ? "text-red-500"
      : "text-muted-foreground";

  const DirIcon = isLong ? TrendingUp : isShort ? TrendingDown : Minus;

  const hasEntry = entry_price != null;
  const hasTarget = target_price != null;
  const hasStop = stop_loss != null;

  const gainPct =
    hasEntry && hasTarget ? pct(entry_price!, target_price!) : null;
  const lossPct = hasEntry && hasStop ? pct(stop_loss!, entry_price!) : null;
  const rr =
    hasEntry && hasTarget && hasStop
      ? rrRatio(entry_price!, target_price!, stop_loss!)
      : null;

  // Pass state — minimal card
  if (isPass) {
    return (
      <Card
        className={cn("overflow-hidden p-0", className)}
        {...cardProps}
      >
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold font-mono">{ticker}</span>
            <Badge variant="secondary" className="text-xs">
              PASS
            </Badge>
          </div>
          <span className="text-sm text-muted-foreground tabular-nums font-medium">
            {confidence_score}%
          </span>
        </div>
        {(pass_reason || reasoning_summary) && (
          <div className="px-5 pb-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {pass_reason || reasoning_summary}
            </p>
          </div>
        )}
      </Card>
    );
  }

  return (
    <Card
      className={cn("overflow-hidden p-0", className)}
      {...cardProps}
    >
      {/* ── Sources row at top (Perplexity style) ─────────────────────── */}
      {sources.length > 0 && (
        <div className="px-5 pt-4 pb-0">
          <SourceChipRow sources={sources} />
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold font-mono">{ticker}</span>
          <Badge
            variant="secondary"
            className={cn(
              "gap-1 text-xs font-semibold",
              dirColor,
              isLong ? "bg-emerald-500/10" : "bg-red-500/10"
            )}
          >
            <DirIcon className="h-3.5 w-3.5" />
            {direction}
          </Badge>
          {hold_duration && (
            <span className="text-xs text-muted-foreground">
              {hold_duration}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {signal_types.slice(0, 2).map((s) => (
            <Badge
              key={s}
              variant="outline"
              className="text-[10px] text-muted-foreground"
            >
              {s.replace(/_/g, " ")}
            </Badge>
          ))}
          <div
            className={cn(
              "flex items-center justify-center rounded-full size-10 text-sm font-bold tabular-nums",
              confidence_score >= 80
                ? "bg-emerald-500/15 text-emerald-500"
                : confidence_score >= 60
                  ? "bg-amber-500/15 text-amber-500"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {confidence_score}
          </div>
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* ── Price grid ──────────────────────────────────────────────── */}
        {hasEntry && (
          <div className="grid grid-cols-4 gap-3 rounded-xl bg-muted/40 p-4 text-center">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Entry
              </p>
              <p className="text-base tabular-nums font-bold">
                ${entry_price!.toFixed(2)}
              </p>
            </div>
            {hasTarget && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  Target
                </p>
                <p className="text-base tabular-nums font-bold text-emerald-500">
                  ${target_price!.toFixed(2)}
                </p>
                {gainPct && (
                  <p className="text-[10px] text-emerald-500/70 tabular-nums">
                    +{gainPct}%
                  </p>
                )}
              </div>
            )}
            {hasStop && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  Stop
                </p>
                <p className="text-base tabular-nums font-bold text-red-500">
                  ${stop_loss!.toFixed(2)}
                </p>
                {lossPct && (
                  <p className="text-[10px] text-red-500/70 tabular-nums">
                    &minus;{lossPct}%
                  </p>
                )}
              </div>
            )}
            {rr != null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  R:R
                </p>
                <p
                  className={cn(
                    "text-base tabular-nums font-bold",
                    parseFloat(rr) >= 2
                      ? "text-emerald-500"
                      : parseFloat(rr) >= 1
                        ? "text-foreground"
                        : "text-red-500"
                  )}
                >
                  {rr}&times;
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Reasoning (with inline citation support) ────────────────── */}
        {reasoning_summary && (
          <CitedText
            text={reasoning_summary}
            sources={sources}
            className="text-sm text-foreground/80 leading-relaxed"
          />
        )}

        {/* ── Thesis bullets ──────────────────────────────────────────── */}
        {thesis_bullets.length > 0 && (
          <div className="space-y-2">
            {thesis_bullets.map((b, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
                <span className="leading-relaxed">{b}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Risk flags ──────────────────────────────────────────────── */}
        {risk_flags.length > 0 && (
          <div className="space-y-2">
            {risk_flags.map((r, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 text-sm text-muted-foreground"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                <span className="leading-relaxed">{r}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
