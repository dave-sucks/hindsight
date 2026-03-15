"use client";

import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MarketTheme } from "@/lib/discovery/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketThemesData = {
  themes: MarketTheme[];
  meta: {
    headlines_analyzed: number;
    reddit_tickers_found: number;
    lookback_days: number;
  };
};

export type MarketThemesCardProps = ComponentProps<typeof Card> & MarketThemesData;

// ─── Direction badge styling ──────────────────────────────────────────────────

const DIRECTION_STYLES: Record<MarketTheme["direction"], string> = {
  BULLISH: "bg-positive/10 text-positive",
  BEARISH: "bg-negative/10 text-negative",
  NEUTRAL: "",
};

// ─── MarketThemesCard ─────────────────────────────────────────────────────────

export function MarketThemesCard({
  themes,
  meta,
  className,
  ...cardProps
}: MarketThemesCardProps) {
  return (
    <Card className={cn("overflow-hidden p-0", className)} {...cardProps}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
        <span className="text-xs font-medium text-muted-foreground">Themes</span>
        <Badge variant="secondary">
          <span className="tabular-nums">{themes.length}</span>
        </Badge>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {themes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No dominant themes detected.
          </p>
        )}

        {themes.map((theme) => (
          <div key={theme.id} className="space-y-1.5">
            {/* Theme name + direction badge */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{theme.label}</span>
              <Badge
                variant="secondary"
                className={cn(DIRECTION_STYLES[theme.direction])}
              >
                {theme.direction}
              </Badge>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {theme.headline_matches} headlines
              </span>
            </div>

            {/* Strength bar */}
            <div className="h-1.5 rounded-full bg-primary/20">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${theme.strength * 100}%` }}
              />
            </div>

            {/* Ticker chips */}
            {theme.tickers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {theme.tickers.map((ticker) => (
                  <Badge
                    key={ticker}
                    variant="outline"
                    className="text-[10px] font-mono"
                  >
                    {ticker}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
