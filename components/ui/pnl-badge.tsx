import { cn, pnlBadgeClasses } from "@/lib/utils";
import { formatSignedCurrency } from "@/lib/format";

interface PnlBadgeProps {
  value: number;
  format?: "percent" | "currency";
  showSign?: boolean;
  className?: string;
}

export function PnlBadge({
  value,
  format = "percent",
  showSign = true,
  className,
}: PnlBadgeProps) {
  const isPositive = value > 0;

  // Currency went through `Math.abs` and only ever added a "+", so a loss
  // rendered as "$82.40" — red, but unsigned, and identical in text to a gain.
  // `formatSignedCurrency` is the one place that decides, and ColoredValue
  // already used it.
  const formatted =
    format === "percent"
      ? `${showSign && isPositive ? "+" : ""}${value.toFixed(2)}%`
      : showSign
        ? formatSignedCurrency(value)
        : `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium tabular-nums",
        pnlBadgeClasses(value),
        className,
      )}
    >
      {formatted}
    </span>
  );
}
