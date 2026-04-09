"use client";

import { useMemo, useCallback, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChatRuntime } from "@/components/chat/chat-runtime";
import { ToolUICallbacksProvider } from "@/components/assistant-ui/tool-uis";
import { useAutoSend } from "@/hooks/useAutoSend";
import type { AgentConfigData } from "@/components/domain/agent-config-card";
import { createAnalystFromBuilder, updateAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { toast } from "sonner";

// ── Props ────────────────────────────────────────────────────────────────────

interface AnalystChatProviderProps {
  mode: "builder" | "editor";
  analystId?: string;
  currentConfig?: Record<string, unknown>;
  onConfigSuggested?: (config: AgentConfigData, onConfirm: () => void) => void;
  onMutatingChange?: (mutating: boolean) => void;
  initialPrompt?: string;
  children: ReactNode;
}

// ── Inner: registers tool UIs + provides callbacks ───────────────────────────

function ChatProviderInner({
  mode,
  analystId,
  currentConfig,
  onConfigSuggested,
  onMutatingChange,
  initialPrompt,
  children,
}: AnalystChatProviderProps) {
  const router = useRouter();
  const [isMutating, startMutating] = useTransition();

  useAutoSend({ message: initialPrompt });

  const handleConfirmConfig = useCallback(
    (config: AgentConfigData) => {
      onMutatingChange?.(true);
      startMutating(async () => {
        try {
          if (mode === "builder") {
            const result = await createAnalystFromBuilder({
              name: config.name ?? "Untitled Analyst",
              analystPrompt: config.analystPrompt ?? "General market research analyst",
              description: config.description,
              directionBias: config.directionBias ?? "BOTH",
              holdDurations: (config.holdDurations ?? ["SWING"]) as ("DAY" | "SWING" | "POSITION")[],
              sectors: config.sectors ?? [],
              signalTypes: config.signalTypes ?? [],
              minConfidence: config.minConfidence ?? 65,
              maxPositionSize: config.maxPositionSize ?? 5000,
              maxOpenPositions: config.maxOpenPositions ?? 5,
              minMarketCapTier: (config.minMarketCapTier ?? "LARGE") as "LARGE" | "MID" | "SMALL",
              watchlist: (config.watchlist ?? []) as string[],
              exclusionList: (config.exclusionList ?? []) as string[],
              domainMonitorProposal: config.domainMonitorProposal,
              intelligenceQueries: config.intelligenceQueries,
              intelligencePolicy: config.intelligencePolicy,
            });
            toast.success(`Analyst "${config.name}" created`);
            router.push(`/analysts/${result.id}`);
          } else {
            await updateAnalystFromBuilder(analystId!, {
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
              watchlist: config.watchlist as string[] | undefined,
              exclusionList: config.exclusionList as string[] | undefined,
              domainMonitorProposal: config.domainMonitorProposal,
              intelligenceQueries: config.intelligenceQueries,
              intelligencePolicy: config.intelligencePolicy,
            });
            router.push(`/analysts/${analystId}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error(`Failed to ${mode === "builder" ? "create" : "update"} analyst:`, err);
          toast.error(`Failed: ${msg}`);
        } finally {
          onMutatingChange?.(false);
        }
      });
    },
    [mode, analystId, router, onMutatingChange],
  );

  const handleConfigSuggested = useCallback(
    (config: AgentConfigData) => {
      if (onConfigSuggested) {
        onConfigSuggested(config, () => handleConfirmConfig(config));
      }
    },
    [onConfigSuggested, handleConfirmConfig],
  );

  const callbacks = useMemo(
    () => ({
      onConfirmConfig: handleConfirmConfig,
      onConfigSuggested: onConfigSuggested ? handleConfigSuggested : undefined,
      isCreating: isMutating,
      confirmLabel: mode === "builder" ? "Create Analyst" : "Apply Changes",
      confirmingLabel: mode === "builder" ? "Creating..." : "Applying...",
      currentConfig: mode === "editor" ? currentConfig : undefined,
    }),
    [handleConfirmConfig, handleConfigSuggested, onConfigSuggested, isMutating, mode, currentConfig],
  );

  return (
    <ToolUICallbacksProvider value={callbacks}>
      {children}
    </ToolUICallbacksProvider>
  );
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function AnalystChatProvider({
  mode,
  analystId,
  currentConfig,
  onConfigSuggested,
  onMutatingChange,
  initialPrompt,
  children,
}: AnalystChatProviderProps) {
  return (
    <ChatRuntime
      api={mode === "builder" ? "/api/agent/builder" : "/api/agent/editor"}
      body={currentConfig ? { currentConfig } : undefined}
    >
      <ChatProviderInner
        mode={mode}
        analystId={analystId}
        currentConfig={currentConfig}
        onConfigSuggested={onConfigSuggested}
        onMutatingChange={onMutatingChange}
        initialPrompt={initialPrompt}
      >
        {children}
      </ChatProviderInner>
    </ChatRuntime>
  );
}
