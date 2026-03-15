"use client";

import { useMemo, useCallback, useTransition, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { DefaultChatTransport } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider, useThreadRuntime } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import {
  useRegisterEditorToolUIs,
  ToolUICallbacksProvider,
} from "@/components/assistant-ui/tool-uis";
import type { AgentConfigData } from "@/components/domain/agent-config-card";
import { updateAnalystFromBuilder } from "@/lib/actions/analyst.actions";

// ─── Inner component ────────────────────────────────────────────────────────

function EditorThread({
  currentConfig,
  onApplyConfig,
  isApplying,
  applied,
  initialMessage,
}: {
  currentConfig: Record<string, unknown>;
  onApplyConfig: (config: AgentConfigData) => void;
  isApplying: boolean;
  applied: boolean;
  initialMessage?: string;
}) {
  useRegisterEditorToolUIs();

  const threadRuntime = useThreadRuntime();
  const hasSent = useRef(false);

  // Auto-send initial message from URL param
  useEffect(() => {
    if (!initialMessage || hasSent.current) return;
    hasSent.current = true;
    const timer = setTimeout(() => {
      threadRuntime.append({
        role: "user",
        content: [{ type: "text", text: initialMessage }],
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [initialMessage, threadRuntime]);

  const callbacks = useMemo(
    () => ({
      currentConfig,
      onApplyConfig,
      isApplying,
      applied,
    }),
    [currentConfig, onApplyConfig, isApplying, applied]
  );

  return (
    <ToolUICallbacksProvider value={callbacks}>
      <Thread
        welcomeConfig={{
          title: "Edit your analyst",
          subtitle: "Ask questions about the current strategy or suggest changes.",
        }}
        composerFeatures={{
          tickerSearch: true,
          placeholder: "Ask a question or suggest strategy changes…",
        }}
      />
    </ToolUICallbacksProvider>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AnalystEditorChatWithInitial({
  analystId,
  currentConfig,
  initialMessage,
}: {
  analystId: string;
  currentConfig: Record<string, unknown>;
  initialMessage?: string;
}) {
  const router = useRouter();
  const [isApplying, startApplying] = useTransition();
  const [applied, setApplied] = useState(false);

  const runtime = useChatRuntime({
    transport: useMemo(
      () =>
        new DefaultChatTransport({
          api: "/api/chat/analyst-editor",
          body: { currentConfig },
        }),
      [currentConfig]
    ),
  });

  const handleApplyConfig = useCallback(
    (config: AgentConfigData) => {
      setApplied(false);
      startApplying(async () => {
        try {
          await updateAnalystFromBuilder(analystId, {
            name: config.name,
            analystPrompt: config.analystPrompt,
            directionBias: config.directionBias as "LONG" | "SHORT" | "BOTH",
            holdDurations: config.holdDurations as ("DAY" | "SWING" | "POSITION")[],
            sectors: config.sectors,
            signalTypes: config.signalTypes,
            minConfidence: config.minConfidence,
            maxPositionSize: config.maxPositionSize,
            maxOpenPositions: config.maxOpenPositions,
            minMarketCapTier: config.minMarketCapTier as "LARGE" | "MID" | "SMALL",
            watchlist: config.watchlist,
            exclusionList: config.exclusionList,
          });
          setApplied(true);
          router.refresh();
        } catch (err) {
          console.error("Failed to apply config:", err);
        }
      });
    },
    [analystId, router]
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <EditorThread
        currentConfig={currentConfig}
        onApplyConfig={handleApplyConfig}
        isApplying={isApplying}
        applied={applied}
        initialMessage={initialMessage}
      />
    </AssistantRuntimeProvider>
  );
}
