"use client";

/**
 * JsonBlock — the one sanctioned monospace block for machine data in chat.
 *
 * The no-font-mono design rule carves out "actual code blocks, in a dedicated
 * component". This is that component: pretty-printed JSON, horizontally
 * scrollable so a long string can't push the chat column sideways (the page
 * body must never scroll horizontally).
 *
 * Styling matches the pre block in components/domain/workflow-markdown.tsx so
 * machine data reads the same everywhere it appears.
 */

import { memo } from "react";
import { cn } from "@/lib/utils";

export type JsonBlockProps = {
  /** Any JSON-serializable value. Non-serializable input degrades to String(). */
  value: unknown;
  className?: string;
};

export const JsonBlock = memo(function JsonBlock({ value, className }: JsonBlockProps) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // Circular refs / BigInt — never let a display concern throw in chat.
    text = String(value);
  }

  return (
    <pre
      className={cn(
        // eslint-disable-next-line no-restricted-syntax -- code blocks are exactly the case the design rule's "dedicated component" carve-out is for
        "overflow-x-auto rounded-md border border-border/50 bg-muted/40 p-3 text-xs font-mono leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {text}
    </pre>
  );
});
