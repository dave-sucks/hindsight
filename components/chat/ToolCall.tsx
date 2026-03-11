"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Loader2, CheckCircle2, AlertCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Single tool call ──────────────────────────────────────────────────────────

export type ToolCallStatus = "loading" | "done" | "error";

export type ToolCallItem = {
  id: string;
  label: string;
  status: ToolCallStatus;
  /** Key data points to show when expanded */
  details?: string;
};

export function ToolCall({
  label,
  status = "done",
  details,
}: {
  label: string;
  status?: ToolCallStatus;
  details?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasDetails = details && details.length > 0;

  const icon =
    status === "loading" ? (
      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
    ) : status === "error" ? (
      <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />
    ) : (
      <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
    );

  if (!hasDetails) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        {icon}
        <span
          className={cn(
            "text-xs",
            status === "error"
              ? "text-red-500"
              : "text-muted-foreground"
          )}
        >
          {label}
        </span>
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 py-0.5 group cursor-pointer select-none">
        {icon}
        <span
          className={cn(
            "text-xs group-hover:text-foreground transition-colors",
            status === "error"
              ? "text-red-500"
              : "text-muted-foreground"
          )}
        >
          {label}
        </span>
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground/50 transition-transform duration-150",
            open && "rotate-90"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 mt-1 mb-1 rounded-md bg-muted/50 px-3 py-2">
          <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {details}
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Grouped tool calls (all data fetches for one ticker) ───────────────────

export function ToolCallGroup({
  items,
  className,
}: {
  items: ToolCallItem[];
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card/50 px-3 py-2 space-y-0.5", className)}>
      {items.map((item) => (
        <ToolCall
          key={item.id}
          label={item.label}
          status={item.status}
          details={item.details}
        />
      ))}
    </div>
  );
}
