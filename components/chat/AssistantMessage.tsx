"use client";

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
    <div className={cn("space-y-3", className)}>
      {content && (
        <div className="text-sm text-foreground leading-relaxed">
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
  );
}
