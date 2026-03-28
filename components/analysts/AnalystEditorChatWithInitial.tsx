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
  onConfirmConfig,
  onConfigSuggested,
  isApplying,
  applied,
  initialMessage,
}: {
  currentConfig: Record<string, unknown>;
  onConfirmConfig: (config: AgentConfigData) => void;
  onConfigSuggested?: (config: AgentConfigData) => void;
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
      onApplyConfig: onConfirmConfig,
      onConfigSuggested,
      isApplying,
      applied,
      confirmLabel: "Apply Changes",
      confirmingLabel: "Applying...",
    }),
    [currentConfig, onConfirmConfig, onConfigSuggested, isApplying, applied]
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
  onConfigSuggested,
  onApplyingChange,
}: {
  analystId: string;
  currentConfig: Record<string, unknown>;
  initialMessage?: string;
  onConfigSuggested?: (config: AgentConfigData, onConfirm: () => void) => void;
  onApplyingChange?: (applying: boolean) => void;
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

  const handleConfirmConfig = useCallback(
    (config: AgentConfigData) => {
      setApplied(false);
      onApplyingChange?.(true);
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
            // V3 intelligence fields
            sourcePackProposal: config.sourcePackProposal,
            intelligenceQueries: config.intelligenceQueries,
            intelligencePolicy: config.intelligencePolicy,
          });
          setApplied(true);
          onApplyingChange?.(false);
          router.refresh();
        } catch (err) {
          console.error("Failed to apply config:", err);
          onApplyingChange?.(false);
        }
      });
    },
    [analystId, router, onApplyingChange]
  );

  // When the AI suggests config, notify the parent (for panel) AND store the confirm handler
  const handleConfigSuggested = useCallback(
    (config: AgentConfigData) => {
      if (onConfigSuggested) {
        onConfigSuggested(config, () => handleConfirmConfig(config));
      }
    },
    [onConfigSuggested, handleConfirmConfig]
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <EditorThread
        currentConfig={currentConfig}
        onConfirmConfig={handleConfirmConfig}
        onConfigSuggested={onConfigSuggested ? handleConfigSuggested : undefined}
        isApplying={isApplying}
        applied={applied}
        initialMessage={initialMessage}
      />
    </AssistantRuntimeProvider>
  );
}
