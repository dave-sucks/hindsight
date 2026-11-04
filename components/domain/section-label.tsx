import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one section label — "Recent activity", "Core thesis", "Triggers",
 * "Price targets". Its look lives here and nowhere else, so changing it
 * changes every surface at once. `action` is the small control at the
 * right edge of the same row (Add, View all).
 */
export function SectionLabel({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  const label = <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
  if (!action) return className ? <div className={className}>{label}</div> : label;
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      {label}
      {action}
    </div>
  );
}
