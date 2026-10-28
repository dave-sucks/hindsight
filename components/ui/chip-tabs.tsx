"use client";

import { cn } from "@/lib/utils";

/**
 * ChipTabs — free-standing pills that pick which slice of a list you're
 * looking at: Trades / Sold / Watching / Passed, All / Open / Closed / Won /
 * Lost, Active / Watching / Closed, Gainers / Losers.
 *
 * The app has three switch controls, one job each:
 *   - Tabs (`components/ui/tabs`): sections of a page, sheet or panel.
 *   - Tabs `size="sm"`: view settings over the same data — date ranges,
 *     % / $, Lifetime / 1D / 5D / 30D, Shares / Dollars.
 *   - ChipTabs (this): slices of one list.
 * Many options, or several filters at once, is a Select starting on a real
 * "All …" item instead. Pick the control by its job; never re-type the
 * classes by hand.
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
  /** default: a list's slice picker. sm: tight spots, e.g. over a chart. */
  size?: "default" | "sm";
  className?: string;
}

export function ChipTabs<T extends string = string>({
  options,
  value,
  onChange,
  clearable = true,
  size = "default",
  className,
}: ChipTabsProps<T>) {
  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {options.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={isActive}
            onClick={(e) => {
              // Chips can sit inside a clickable row or card — picking a
              // slice is not clicking the row.
              e.stopPropagation();
              if (isActive && clearable) onChange(null);
              else if (!isActive) onChange(opt.value);
            }}
            title={opt.title}
            className={cn(
              "rounded-full font-medium transition-colors",
              size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm",
              // Hover is the active fill, faint.
              isActive
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
