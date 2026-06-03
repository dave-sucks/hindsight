"use client";

/**
 * TradeStatement — the shared presentational row for a trade's state:
 *
 *   [● label]  [sentence]  ……………………  [+$gain ↗ %]
 *
 * Left: a status dot + context label + the sentence from buildTradeSentence.
 * Right: the green/red gain via <PriceChange> (the styling used on the trade
 * detail header), OR a custom `right` slot (e.g. an approval Review dropdown)
 * which takes precedence over `gain`.
 *
 * The LABEL is passed in by the caller because it's context-specific — the
 * activity feed says "Bought" / "Sold" (event log), the live surfaces say
 * "Holding" / "Won" / "Loss" (current state). The sentence + gain are the
 * parts that unify.
 *
 * This component is chrome-agnostic: it renders just the flex row. Callers
 * wrap it however they need — a rounded muted box (thesis card / sheet), a
 * list row (activity feed), or bare (trade header).
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PriceChange } from "@/components/ui/price-change";

export interface TradeStatementGain {
  dollar: number;
  pct: number | null;
}

export function TradeStatement({
  label,
  dotClass,
  sentence,
  gain,
  right,
  labelClassName,
  className,
}: {
  label: string;
  dotClass: string;
  sentence: string | null;
  gain?: TradeStatementGain | null;
  /** Overrides `gain` on the right (e.g. an approval Review dropdown). */
  right?: ReactNode;
  labelClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="flex items-baseline gap-1.5 min-w-0 text-sm">
        <span className={cn("size-2 rounded-full shrink-0 self-center", dotClass)} />
        <span className={cn("font-medium shrink-0", labelClassName)}>{label}</span>
        {sentence ? (
          <span className="text-muted-foreground tabular-nums truncate">
            {sentence}
          </span>
        ) : null}
      </div>
      {right ??
        (gain ? (
          <PriceChange
            dollarChange={gain.dollar}
            percentChange={gain.pct}
            size="sm"
            className="shrink-0"
          />
        ) : null)}
    </div>
  );
}
