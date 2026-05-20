import { cn } from "@/lib/utils";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * InfoRow — the ONE component for label-left / value-right rows.
 * Matches the Trade Details Card reference design exactly.
 *
 * Usage (display):     <InfoRow label="Direction" value="LONG" />
 * Usage (edit):        <InfoRow label="Direction"><Select ... /></InfoRow>
 * Usage (no border):   <InfoRow label="P&L" value="+$12" border={false} />
 * Usage (tooltip):     <InfoRow label="Min Confidence" value="70%"
 *                                tooltip="Lowest thesis confidence that can place a trade." />
 * Usage (description): <InfoRow label="Horizon" value="TRADE"
 *                                description="Bounded short-term trade. Exit on stop, target, or maxHoldDays." />
 *
 * Label: `font-light text-foreground` (lighter weight, same color as value).
 * Value: `font-medium text-foreground` — slightly heavier so the value
 * reads as the primary content.
 * Description (when supplied): renders on its own line BELOW the label/value
 * pair but INSIDE the bordered row — so the bottom border sits under the
 * description, not between the row and the description. Unified with the
 * ScoringRow pattern on the ThesisSheet (2026-05-19) so Composite Score +
 * Schedule look identical.
 */
export function InfoRow({
  label,
  value,
  description,
  children,
  mono = false,
  border = true,
  className,
  valueClassName,
  tooltip,
}: {
  label: string;
  value?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  mono?: boolean;
  border?: boolean;
  className?: string;
  valueClassName?: string;
  tooltip?: React.ReactNode;
}) {
  const rowContent = (
    <div className="flex items-center justify-between text-sm min-h-8">
      <span className="font-light text-foreground shrink-0 flex items-center gap-1">
        {label}
        {tooltip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<span className="cursor-help inline-flex items-center" />}>
                <Info className="h-3 w-3 text-muted-foreground/70" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
      {children ?? (
        <span
          className={cn(
            "font-medium text-foreground text-right truncate",
            mono && "tabular-nums",
            valueClassName,
          )}
        >
          {value}
        </span>
      )}
    </div>
  );

  return (
    <div
      className={cn(
        border && "border-b border-border pb-1",
        className,
      )}
    >
      {rowContent}
      {description ? (
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">
          {description}
        </p>
      ) : null}
    </div>
  );
}
