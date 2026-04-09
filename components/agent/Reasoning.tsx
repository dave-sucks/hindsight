"use client";

/**
 * Reasoning — collapsible reasoning block for extended thinking responses.
 * Used in research-run mode when Claude Sonnet 4.5 with extended thinking
 * is enabled (Step 7).
 *
 * Wraps the existing ChainOfThought pattern from components/ai-elements/.
 */

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReasoningProps {
  children: ReactNode;
  /** Default open state */
  defaultOpen?: boolean;
}

export function Reasoning({ children, defaultOpen = false }: ReasoningProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="my-2 rounded-lg border border-border/50 bg-muted/30">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronDownIcon
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
        Reasoning
      </button>
      {open && (
        <div className="px-3 pb-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap border-t border-border/50 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}
