"use client";

/**
 * Reasoning — ghost variant collapsible for extended thinking blocks.
 *
 * Label is text-only (no leading icon) and shimmers while the reasoning
 * tokens are still streaming, so "the model is thinking" reads without a
 * spinner. Once the part completes the shimmer stops and the label settles
 * back to muted-foreground.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReasoningProps {
  children: ReactNode;
  defaultOpen?: boolean;
  /** True while the reasoning part is still streaming — drives the shimmer. */
  isStreaming?: boolean;
}

export function Reasoning({ children, defaultOpen = false, isStreaming = false }: ReasoningProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="my-1">
      <button
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors py-1"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={cn(isStreaming && "shimmer-text")}>Reasoning</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="mt-0.5 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap border-l border-border/40 pl-3 py-1">
          {children}
        </div>
      )}
    </div>
  );
}
