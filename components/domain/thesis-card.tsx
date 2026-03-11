"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { CitedText } from "../chat/CitedText";
import type { SourceChipData } from "../chat/SourceChip";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
} from "../ai-elements/sources";

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
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold font-mono">{ticker}</span>
            <Badge variant="secondary" className="text-[10px]">
              PASS
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {confidence_score}%
          </span>
        </div>
        {(pass_reason || reasoning_summary) && (
          <div className="px-4 pb-3">
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
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold font-mono">{ticker}</span>
          <span
            className={cn(
              "flex items-center gap-1 text-sm font-semibold",
              dirColor
            )}
          >
            <DirIcon className="h-3.5 w-3.5" />
            {direction}
          </span>
          {hold_duration && (
            <span className="text-xs text-muted-foreground">
              {hold_duration}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {signal_types.slice(0, 2).map((s) => (
            <span
              key={s}
              className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
            >
              {s.replace(/_/g, " ")}
            </span>
          ))}
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              confidence_score >= 70 ? "text-emerald-500" : "text-amber-500"
            )}
          >
            {confidence_score}%
          </span>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Price grid */}
        {hasEntry && (
          <div className="grid grid-cols-4 gap-3 rounded-lg bg-muted/40 p-3 text-center">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Entry
              </p>
              <p className="text-sm tabular-nums font-semibold">
                ${entry_price!.toFixed(2)}
              </p>
            </div>
            {hasTarget && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                  Target
                </p>
                <p className="text-sm tabular-nums font-semibold text-emerald-500">
                  ${target_price!.toFixed(2)}
                  {gainPct && (
                    <span className="text-[10px] text-muted-foreground ml-1">
                      +{gainPct}%
                    </span>
                  )}
                </p>
              </div>
            )}
            {hasStop && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                  Stop
                </p>
                <p className="text-sm tabular-nums font-semibold text-red-500">
                  ${stop_loss!.toFixed(2)}
                  {lossPct && (
                    <span className="text-[10px] text-muted-foreground ml-1">
                      &minus;{lossPct}%
                    </span>
                  )}
                </p>
              </div>
            )}
            {rr != null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                  R:R
                </p>
                <p
                  className={cn(
                    "text-sm tabular-nums font-semibold",
                    parseFloat(rr) >= 2
                      ? "text-emerald-500"
                      : parseFloat(rr) >= 1
                        ? "text-muted-foreground"
                        : "text-red-500"
                  )}
                >
                  {rr}&times;
                </p>
              </div>
            )}
          </div>
        )}

        {/* Reasoning (with inline citation support) */}
        {reasoning_summary && (
          <CitedText
            text={reasoning_summary}
            sources={sources}
            className="text-sm text-foreground/80 leading-relaxed"
          />
        )}

        {/* Thesis bullets */}
        {thesis_bullets.length > 0 && (
          <ul className="space-y-1.5">
            {thesis_bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-500" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Risk flags */}
        {risk_flags.length > 0 && (
          <ul className="space-y-1.5">
            {risk_flags.map((r, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Sources — collapsible numbered list */}
        {sources.length > 0 && (
          <Sources className="pt-1">
            <SourcesTrigger count={sources.length} />
            <SourcesContent>
              {sources.map((s, i) => (
                <div key={`${s.provider}-${i}`} className="flex items-center gap-2 text-xs">
                  <span className="tabular-nums text-muted-foreground w-4 text-right shrink-0">
                    {i + 1}.
                  </span>
                  <span className="font-medium truncate max-w-[240px]">
                    {s.title || s.provider}
                  </span>
                  {s.url && (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline shrink-0"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </SourcesContent>
          </Sources>
        )}
      </div>
    </Card>
  );
}
