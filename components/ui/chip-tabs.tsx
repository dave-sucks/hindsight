"use client";

import { cn } from "@/lib/utils";

/**
 * ChipTabs — reusable segmented filter shaped like the Trades All/Open/Closed
 * row on the analyst page. Single visual language for small inline filters:
 *
 *   - Rounded full pill
 *   - Active  → secondary fill
 *   - Inactive → ghost, text at 60% opacity, full opacity on hover
 *   - No counts in the chip itself (caller surfaces totals separately if needed)
 *
 * Used on:
 *   - Analyst page trades filter
 *   - Intelligence Briefs date selector
 *   - Analyst page Routing stats strip
 *
 * `variant="tray"` is the OTHER segmented look the app already uses: pills
 * inside a bordered tray, active one lifted on the card background. It was
 * hand-rolled in four places (the dashboard chart's range tabs, the coverage
 * table's Trades/Watching/Passed bar, that table's mobile All/1D toggle, and
 * the %/$ toggle beside it) and they had already drifted apart. Pick a
 * variant; never re-type the classes.
 */

export interface ChipTabOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional accessible tooltip — useful when the label is an abbreviation. */
  title?: string;
}

interface ChipTabsProps<T extends string = string> {
  options: readonly ChipTabOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  /**
   * When true, clicking the active chip clears the selection (returns null).
   * When false, the active chip is non-toggleable. Default: true.
   */
  clearable?: boolean;
  /** "chip" = free-standing rounded pills. "tray" = pills in a bordered tray. */
  variant?: "chip" | "tray";
  /** "sm" is the compact tray used where a header cell is the whole width. */
  size?: "default" | "sm";
  className?: string;
}

export function ChipTabs<T extends string = string>({
  options,
  value,
  onChange,
  clearable = true,
  variant = "chip",
  size = "default",
  className,
}: ChipTabsProps<T>) {
  const tray = variant === "tray";
  return (
    <div
      className={cn(
        tray
          ? "inline-flex items-center gap-0.5 rounded-md border bg-muted/50 px-1 py-0.5"
          : "flex items-center gap-1 flex-wrap",
        className,
      )}
    >
      {options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={(e) => {
              // A tray can sit inside a clickable row (a table header cell, a
              // card) — picking a tab is not picking the row.
              if (tray) e.stopPropagation();
              if (isActive && clearable) onChange(null);
              else if (!isActive) onChange(opt.value);
            }}
            title={opt.title}
            className={cn(
              tray
                ? cn(
                    "text-xs rounded transition-colors",
                    size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1",
                    isActive
                      ? "bg-background text-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )
                : cn(
                    "px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors",
                    isActive
                      ? "bg-secondary text-secondary-foreground border-secondary"
                      : "text-muted-foreground opacity-60 hover:opacity-100 border-transparent",
                  ),
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
