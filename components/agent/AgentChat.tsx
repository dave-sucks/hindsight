"use client";

/**
 * AgentChat — unified chat component for all three surfaces:
 *   - research-run: live agent run + follow-up conversation
 *   - builder: analyst creation chat
 *   - editor: analyst editing chat
 *
 * Replaces AgentThread (runs), AnalystBuilderChat, AnalystChatProvider,
 * and AnalystEditorChatWithInitial.
 * Uses the unified /api/agent/[mode] route.
 */

import { useMemo, useCallback, useTransition } from "react";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import type { AgentMode } from "@/lib/agent/modes";
import { ChatRuntime } from "@/components/chat/chat-runtime";
import { Thread, type WelcomeConfig } from "@/components/assistant-ui/thread";
import type { HindsightComposerFeatures } from "@/components/assistant-ui/hindsight-composer";
import { ToolUICallbacksProvider } from "@/components/assistant-ui/tool-uis";
import { useAutoSend } from "@/hooks/useAutoSend";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createAnalystFromBuilder,
  updateAnalystFromBuilder,
} from "@/lib/actions/analyst.actions";
import type { AgentConfigData } from "@/components/domain/agent-config-card";
import { Sparkles } from "lucide-react";

// ── Default welcome configs + composer features per mode ──────────────────────

const BUILDER_WELCOME: WelcomeConfig = {
  title: "Create a new analyst",
  subtitle:
    "Describe the trading strategy you want — I'll build a custom analyst for you.",
  icon: (
    <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Sparkles className="size-5" />
    </div>
  ),
};

const EDITOR_WELCOME: WelcomeConfig = {
  title: "Edit your analyst",
  subtitle: "Ask questions about the current strategy or suggest changes.",
};

const BUILDER_COMPOSER: HindsightComposerFeatures = {
  tickerSearch: true,
  placeholder: "Describe your ideal trading analyst…",
};

const EDITOR_COMPOSER: HindsightComposerFeatures = {
  tickerSearch: true,
  placeholder: "Ask a question or suggest strategy changes…",
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface AgentChatProps {
  mode: AgentMode;

  // research-run
  runId?: string;

  // builder / editor
  analystId?: string;
  currentConfig?: Record<string, unknown>;

  /** Pre-loaded messages for replay (historical runs) */
  messages?: UIMessage[];

  /** Thread composer slot (e.g. QuickReplies) */
  composerSlot?: ReactNode;

  /** Auto-send initial message (e.g. "Start analysis") */
  initialPrompt?: string;

  /** Called when the AI suggests a config — opens the preview panel */
  onConfigSuggested?: (config: AgentConfigData, onConfirm: () => void) => void;

  /** Called when a DB mutation (create/update) starts or finishes */
  onMutatingChange?: (mutating: boolean) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentChat({
  mode,
  runId,
  analystId,
  currentConfig,
  messages,
  composerSlot,
  initialPrompt,
  onConfigSuggested,
  onMutatingChange,
}: AgentChatProps) {
  const api = `/api/agent/${mode}`;

  const body: Record<string, unknown> = {};
  if (runId) body.runId = runId;
  if (analystId) body.analystId = analystId;
  if (currentConfig) body.currentConfig = currentConfig;

  return (
    <ChatRuntime api={api} body={body} messages={messages}>
      <AgentChatInner
        mode={mode}
        analystId={analystId}
        currentConfig={currentConfig}
        composerSlot={composerSlot}
        initialPrompt={initialPrompt}
        onConfigSuggested={onConfigSuggested}
        onMutatingChange={onMutatingChange}
      />
    </ChatRuntime>
  );
}

// ── Inner component (inside ChatRuntime — can use thread hooks) ───────────────

interface InnerProps {
  mode: AgentMode;
  analystId?: string;
  currentConfig?: Record<string, unknown>;
  composerSlot?: ReactNode;
  initialPrompt?: string;
  onConfigSuggested?: (config: AgentConfigData, onConfirm: () => void) => void;
  onMutatingChange?: (mutating: boolean) => void;
}

function AgentChatInner({
  mode,
  analystId,
  currentConfig,
  composerSlot,
  initialPrompt,
  onConfigSuggested,
  onMutatingChange,
}: InnerProps) {
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

  const isConfigMode = mode === "builder" || mode === "editor";

  const thread = isConfigMode ? (
    <Thread
      welcomeConfig={mode === "builder" ? BUILDER_WELCOME : EDITOR_WELCOME}
      composerFeatures={mode === "builder" ? BUILDER_COMPOSER : EDITOR_COMPOSER}
      composerSlot={composerSlot}
    />
  ) : (
    <Thread composerSlot={composerSlot} richComposer />
  );

  if (!isConfigMode) return thread;

  return (
    <ToolUICallbacksProvider value={callbacks}>
      {thread}
    </ToolUICallbacksProvider>
  );
}
