"use client";

import { useMemo, useCallback, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { DefaultChatTransport } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Thread, type WelcomeConfig } from "@/components/assistant-ui/thread";
import { Settings2 } from "lucide-react";
import {
  useRegisterEditorToolUIs,
  ToolUICallbacksProvider,
} from "@/components/assistant-ui/tool-uis";
import type { AgentConfigData } from "@/components/domain/agent-config-card";
import { updateAnalystFromBuilder } from "@/lib/actions/analyst.actions";

const EDITOR_WELCOME: WelcomeConfig = {
  title: "Edit your analyst",
  subtitle:
    "Ask questions about the current strategy or suggest changes — I'll show you a config diff.",
  icon: (
    <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Settings2 className="size-5" />
    </div>
  ),
};

// ─── Inner component (needs to be inside AssistantRuntimeProvider) ──────────

function EditorThread({
  currentConfig,
  onApplyConfig,
  isApplying,
  applied,
}: {
  currentConfig: Record<string, unknown>;
  onApplyConfig: (config: AgentConfigData) => void;
  isApplying: boolean;
  applied: boolean;
}) {
  useRegisterEditorToolUIs();

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
        welcomeConfig={EDITOR_WELCOME}
        composerFeatures={{
          tickerSearch: true,
          placeholder: "Ask a question or suggest strategy changes…",
        }}
      />
    </ToolUICallbacksProvider>
  );
}

// ─── AnalystEditorChat ──────────────────────────────────────────────────────

export function AnalystEditorChat({
  analystId,
  currentConfig,
}: {
  analystId: string;
  currentConfig: Record<string, unknown>;
  /** @deprecated No longer used — assistant-ui Thread has its own composer */
  recentTheses?: unknown[];
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
            directionBias: config.directionBias as
              | "LONG"
              | "SHORT"
              | "BOTH",
            holdDurations: config.holdDurations as (
              | "DAY"
              | "SWING"
              | "POSITION"
            )[],
            sectors: config.sectors,
            signalTypes: config.signalTypes,
            minConfidence: config.minConfidence,
            maxPositionSize: config.maxPositionSize,
            maxOpenPositions: config.maxOpenPositions,
            minMarketCapTier: config.minMarketCapTier as
              | "LARGE"
              | "MID"
              | "SMALL",
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
      />
    </AssistantRuntimeProvider>
  );
}
