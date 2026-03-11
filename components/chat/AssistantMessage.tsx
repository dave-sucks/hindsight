"use client";

import { Sparkles } from "lucide-react";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { cn } from "@/lib/utils";

export function AssistantMessage({
  content,
  isStreaming,
  timestamp,
  children,
  className,
}: {
  /** Markdown text content */
  content?: string;
  /** Show blinking cursor at end */
  isStreaming?: boolean;
  /** Optional timestamp label */
  timestamp?: string;
  /** Extra content below text (cards, tool calls, etc.) */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-3", className)}>
      {/* Avatar */}
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0 space-y-2 pt-0.5">
        {content && (
          <div className="text-foreground">
            <MarkdownRenderer content={content} />
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        )}

        {/* Inline children: cards, tool calls, source chips, etc. */}
        {children}

        {timestamp && (
          <p className="text-[10px] text-muted-foreground/50">{timestamp}</p>
        )}
      </div>
    </div>
  );
}
