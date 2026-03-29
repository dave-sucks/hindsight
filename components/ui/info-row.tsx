import { cn } from "@/lib/utils";

/**
 * InfoRow — the ONE component for label-left / value-right rows.
 * Matches the Trade Details Card reference design exactly.
 *
 * Usage (display):   <InfoRow label="Direction" value="LONG" />
 * Usage (edit):      <InfoRow label="Direction"><Select ... /></InfoRow>
 * Usage (no border): <InfoRow label="P&L" value="+$12" border={false} />
 */
export function InfoRow({
  label,
  value,
  children,
  mono = false,
  border = true,
  className,
  valueClassName,
}: {
  label: string;
  value?: React.ReactNode;
  children?: React.ReactNode;
  mono?: boolean;
  border?: boolean;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-sm min-h-8",
        border && "border-b border-border pb-1",
        className,
      )}
    >
      <span className="text-muted-foreground shrink-0">{label}</span>
      {children ?? (
        <span
          className={cn(
            "font-medium text-right truncate",
            mono && "tabular-nums",
            valueClassName,
          )}
        >
          {value}
        </span>
      )}
    </div>
  );
}
