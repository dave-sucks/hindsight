"use client";

import { useMemo } from "react";
import { DefaultChatTransport } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Thread, type WelcomeConfig } from "@/components/assistant-ui/thread";
import { MessageCircle } from "lucide-react";
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

const FOLLOWUP_WELCOME: WelcomeConfig = {
  title: "Follow-up chat",
  subtitle: "Ask questions about this run's theses, trades, or strategy.",
  icon: (
    <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
      <MessageCircle className="size-5" />
    </div>
  ),
};

// ─── Inner component (needs to be inside AssistantRuntimeProvider) ───────────

function FollowupThread() {
  useRegisterFollowupToolUIs();

  return (
    <ToolUICallbacksProvider value={{}}>
      <Thread welcomeConfig={FOLLOWUP_WELCOME} />
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
