import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one section label — "Recent activity", "Core thesis", "Triggers",
 * "Price targets". Its look lives here and nowhere else, so changing it
 * changes every surface at once. Regular case since 2026-11-05 (the owner:
 * no uppercase anywhere on these pages). `action` is the small control at the
 * right edge of the same row (Add, View all).
 */
export function SectionLabel({
  children,
  action,
  className,
  size = "xs",
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  /** "sm": one size up and regular weight — the position card's title (the owner, 2026-11-05). */
  size?: "xs" | "sm";
}) {
  const label = <p className={cn("text-muted-foreground", size === "sm" ? "text-sm font-normal" : "text-xs font-medium")}>{children}</p>;
  if (!action) return className ? <div className={className}>{label}</div> : label;
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      {label}
      {action}
    </div>
  );
}
