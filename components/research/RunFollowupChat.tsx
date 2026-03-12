"use client";

import { useMemo } from "react";
import { DefaultChatTransport } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import {
  useRegisterFollowupToolUIs,
  ToolUICallbacksProvider,
} from "@/components/assistant-ui/tool-uis";
import { cn } from "@/lib/utils";

// ─── Re-export the context type so parent components keep working ────────────

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

// ─── Inner component (needs to be inside AssistantRuntimeProvider) ───────────

function FollowupThread() {
  useRegisterFollowupToolUIs();

  return (
    <ToolUICallbacksProvider value={{}}>
      <Thread />
    </ToolUICallbacksProvider>
  );
}

// ─── RunFollowupChat ────────────────────────────────────────────────────────

export function RunFollowupChat({
  runContext,
  className,
}: {
  runContext: RunFollowupContext;
  /** @deprecated No longer used — assistant-ui Thread has its own composer */
  recentTheses?: unknown[];
  className?: string;
}) {
  const runtime = useChatRuntime({
    transport: useMemo(
      () =>
        new DefaultChatTransport({
          api: "/api/chat/run-followup",
          body: { runContext },
        }),
      [runContext]
    ),
  });

  return (
    <div className={cn("border-t shrink-0 flex flex-col h-full", className)}>
      <AssistantRuntimeProvider runtime={runtime}>
        <FollowupThread />
      </AssistantRuntimeProvider>
    </div>
  );
}
