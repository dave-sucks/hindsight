"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible reasoning/thinking block — like Claude's thinking UI.
 * Shows an animated gradient border while "thinking" (isLive), then
 * settles into a muted block that can be expanded to read the reasoning.
 */
export function ReasoningBlock({
  children,
  label = "Reasoning",
  defaultOpen = false,
  isLive = false,
  className,
}: {
  children: React.ReactNode;
  label?: string;
  defaultOpen?: boolean;
  isLive?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={cn(
        "relative rounded-xl overflow-hidden",
        isLive && "reasoning-glow",
        className,
      )}
    >
      {/* Animated gradient border when live */}
      {isLive && (
        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-500/20 via-purple-500/20 to-blue-500/20 animate-pulse pointer-events-none" />
      )}

      <div
        className={cn(
          "relative rounded-xl border bg-muted/30",
          isLive && "border-amber-500/30",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {isLive ? (
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
              Thinking...
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              {label}
            </span>
          )}
          <ChevronDown
            className={cn(
              "ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div className="px-3.5 pb-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Animated pulsing indicator for live/streaming states
 */
export function LivePulse({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      {label && <span className="animate-pulse">{label}</span>}
    </span>
  );
}

/**
 * A single research step with a check/spinner indicator
 */
export function ResearchStep({
  label,
  done = false,
  details,
}: {
  label: string;
  done?: boolean;
  details?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 text-xs">
      {done ? (
        <span className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15">
          <svg className="h-2.5 w-2.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      ) : (
        <span className="mt-0.5 h-4 w-4 rounded-full border-2 border-muted-foreground/20 border-t-amber-500 animate-spin" />
      )}
      <div className="min-w-0">
        <span className={cn("text-foreground/80", done && "text-muted-foreground")}>
          {label}
        </span>
        {details && (
          <p className="mt-0.5 text-muted-foreground/70 line-clamp-1">{details}</p>
        )}
      </div>
    </div>
  );
}
