"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useState, useCallback, useMemo, type FormEvent } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { UserMessage } from "@/components/chat/UserMessage";
import { cn } from "@/lib/utils";

export type RunFollowupContext = {
  analystName?: string;
  config?: Record<string, unknown>;
  theses?: Array<{
    ticker: string;
    direction: string;
    confidence_score: number;
    reasoning_summary?: string;
    thesis_bullets?: string[];
    risk_flags?: string[];
    entry_price?: number | null;
    target_price?: number | null;
    stop_loss?: number | null;
    signal_types?: string[];
  }>;
  tradesPlaced?: Array<{
    ticker: string;
    direction: string;
    entry: number;
  }>;
};

// Extract text from UIMessage parts
function getMessageText(msg: { parts: Array<{ type: string; text?: string }> }): string {
  return msg.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("");
}

export function RunFollowupChat({
  runContext,
  className,
}: {
  runContext: RunFollowupContext;
  className?: string;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/run-followup",
        body: { runContext },
      }),
    [runContext]
  );

  const { messages, sendMessage, status } = useChat({ transport });

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || isLoading) return;
      setInput("");
      sendMessage({ text });
    },
    [input, isLoading, sendMessage]
  );

  return (
    <div className={cn("border-t shrink-0", className)}>
      {/* Follow-up message thread */}
      {messages.length > 0 && (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-4 pb-2 space-y-4">
          {messages.map((msg) => {
            const text = getMessageText(msg);
            return msg.role === "user" ? (
              <UserMessage key={msg.id}>{text}</UserMessage>
            ) : (
              <AssistantMessage
                key={msg.id}
                content={text}
                isStreaming={
                  status === "streaming" &&
                  msg.id === messages[messages.length - 1].id
                }
              />
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Composer */}
      <div className="px-4 sm:px-6 py-3">
        <form
          onSubmit={handleSubmit}
          className="max-w-2xl mx-auto flex items-center gap-2"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about this run..."
            disabled={isLoading}
            className={cn(
              "flex-1 rounded-lg border bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground/60",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              "disabled:opacity-50"
            )}
          />
          <Button
            type="submit"
            size="icon"
            variant="ghost"
            disabled={isLoading || !input.trim()}
            className="h-9 w-9 shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
