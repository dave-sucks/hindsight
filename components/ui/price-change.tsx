import { cn } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

/**
 * PriceChange — the header-scale "$delta ↗ X%" element used everywhere a
 * price or portfolio equity change is surfaced in a primary view (dashboard
 * header, stock-detail header, trade-detail header).
 *
 * Single source of truth for:
 *   • which arrow icon is used for up vs. down (ArrowUpRight / ArrowDownRight)
 *   • color semantics (text-positive / text-negative)
 *   • spacing + tabular-nums + explicit sign on the dollar delta
 *
 * Sibling to `PnlBadge` (components/ui/pnl-badge.tsx) — the small chip-style
 * variant for table rows. Use this one for large header contexts; use
 * PnlBadge for inline table cells.
 */

interface PriceChangeProps {
  /** Dollar delta (e.g. +13.25 means +$13.25). Sign drives color + arrow. */
  dollarChange: number;
  /**
   * Percent change as a number (e.g. 14.16 for 14.16%). If null, the percent
   * is omitted and only the dollar change + arrow render.
   */
  percentChange?: number | null;
  /**
   * Visual size. Keep in sync with the surrounding header text:
   *   "xl"  → matches text-xl font-semibold header (dashboard, trade detail)
   *   "base" → one size down; used for the mobile-collapsed row
   *   "sm"  → inline cell / subheader
   */
  size?: "xl" | "base" | "sm";
  /** Hide the dollar prefix and show only the percentage. Rare. */
  percentOnly?: boolean;
  className?: string;
}

export function PriceChange({
  dollarChange,
  percentChange = null,
  size = "xl",
  percentOnly = false,
  className,
}: PriceChangeProps) {
  const isUp = dollarChange >= 0;
  const colorClass = isUp ? "text-positive" : "text-negative";

  // Size mapping — text size for the whole element; arrow size tracks it.
  const sizeCls =
    size === "xl" ? "text-xl" : size === "base" ? "text-base" : "text-sm";
  const iconCls =
    size === "xl" ? "h-5 w-5" : size === "base" ? "h-4 w-4" : "h-3.5 w-3.5";

  const Arrow = isUp ? ArrowUpRight : ArrowDownRight;

  // Both dollar and percent render as absolute values — the arrow icon +
  // color already convey direction, so a "-5.00% ↘" double-encodes. Sign
  // shown only on the dollar prefix (+$X / -$X).
  const dollarText = `${isUp ? "+" : "-"}$${Math.abs(dollarChange).toFixed(2)}`;
  const percentText =
    percentChange != null ? `${Math.abs(percentChange).toFixed(2)}%` : null;

  return (
    <span
      className={cn(
        sizeCls,
        "tabular-nums inline-flex items-center gap-2",
        colorClass,
        className,
      )}
    >
      {!percentOnly && dollarText}
      <span className="inline-flex items-center">
        <Arrow className={iconCls} />
        {percentText ?? ""}
      </span>
    </span>
  );
}
