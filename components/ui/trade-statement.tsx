"use client";

/**
 * TradeStatement — the shared presentational row for a trade's state:
 *
 *   [● label]  [sentence]  ……………………  [+$gain ↗ %]
 *
 * Left: a status dot + optional context label + the sentence from
 * buildTradeSentence. Right: the green/red gain via <PriceChange>, OR a custom
 * `right` slot (e.g. an approval Review dropdown) which takes precedence.
 *
 * The LABEL is context-specific and OPTIONAL — the activity feed / thesis card
 * says "Bought" / "Sold" (event log) with the sentence as muted secondary text.
 * The trade detail header + thesis sheet pass NO label, so the sentence itself
 * is the primary font-medium line ("● Bought 7 shares at $X, now trading at
 * $Y ...... −$Z"). Same component, one look.
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
  dot,
  sentence,
  gain,
  right,
  labelClassName,
  className,
}: {
  /** Optional context word. When omitted, the sentence is the primary line. */
  label?: string;
  /** Tailwind bg-* for the default dot. Ignored when `dot` is provided. */
  dotClass?: string;
  /** Custom leading dot (e.g. an animated + tooltip'd status dot). Overrides
   *  the default `dotClass` circle. */
  dot?: ReactNode;
  sentence: string | null;
  gain?: TradeStatementGain | null;
  /** Overrides `gain` on the right (e.g. an approval Review dropdown). */
  right?: ReactNode;
  labelClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="flex flex-1 items-baseline gap-1.5 min-w-0 text-sm">
        {dot ?? (
          <span className={cn("size-2 rounded-full shrink-0 self-center", dotClass)} />
        )}
        {label ? (
          <span className={cn("font-medium shrink-0", labelClassName)}>{label}</span>
        ) : null}
        {sentence ? (
          <span
            className={cn(
              "tabular-nums truncate",
              // With a label the sentence is muted secondary text; without one
              // it IS the primary line (matches the trade detail header).
              label ? "text-muted-foreground" : "font-medium",
            )}
          >
            {sentence}
          </span>
        ) : null}
      </div>
      {right ? (
        <div className="flex shrink-0 items-center justify-end">{right}</div>
      ) : gain ? (
        <PriceChange
          dollarChange={gain.dollar}
          percentChange={gain.pct}
          size="sm"
          className="shrink-0"
        />
      ) : null}
    </div>
  );
}
