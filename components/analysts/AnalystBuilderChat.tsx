"use client";

import { useMemo, useCallback, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { DefaultChatTransport } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Thread, type WelcomeConfig } from "@/components/assistant-ui/thread";
import {
  useRegisterBuilderToolUIs,
  ToolUICallbacksProvider,
} from "@/components/assistant-ui/tool-uis";
import type { AgentConfigData } from "@/components/domain/agent-config-card";
import { createAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

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

const SUGGESTIONS = [
  {
    title: "Momentum day trader",
    label: "Intraday breakouts on high-volume tech stocks",
    prompt:
      "Build me an aggressive day trader focused on momentum and technical breakouts in tech stocks. Show me some real examples of stocks that fit this strategy right now.",
  },
  {
    title: "Earnings player",
    label: "Trades the run-up and post-earnings drift",
    prompt:
      "I want an analyst that trades around earnings — catches the run-up and post-earnings momentum. Research a stock with upcoming earnings to show me how it would work.",
  },
  {
    title: "Biotech catalyst hunter",
    label: "FDA approvals, trial data, unusual options flow",
    prompt:
      "Build a biotech-focused analyst that watches for FDA catalysts, clinical trial data, and unusual options flow.",
  },
  {
    title: "Mean reversion swing",
    label: "Buys oversold dips on quality large-caps",
    prompt:
      "Create a swing trader that uses mean reversion — buys oversold dips on quality large-cap stocks when RSI drops below 30, targets a bounce back to the moving average.",
  },
];

// ─── Inner component (needs to be inside AssistantRuntimeProvider) ──────────

function BuilderThread({
  onConfirmConfig,
  onConfigSuggested,
  isCreating,
}: {
  onConfirmConfig: (config: AgentConfigData) => void;
  onConfigSuggested?: (config: AgentConfigData) => void;
  isCreating: boolean;
}) {
  useRegisterBuilderToolUIs();

  const callbacks = useMemo(
    () => ({
      onConfirmConfig,
      onConfigSuggested,
      isCreating,
      confirmLabel: "Create Analyst",
      confirmingLabel: "Creating...",
    }),
    [onConfirmConfig, onConfigSuggested, isCreating]
  );

  return (
    <ToolUICallbacksProvider value={callbacks}>
      <Thread
        welcomeConfig={BUILDER_WELCOME}
        composerFeatures={{
          tickerSearch: true,
          placeholder: "Describe your ideal trading analyst…",
        }}
      />
    </ToolUICallbacksProvider>
  );
}

// ─── AnalystBuilderChat ─────────────────────────────────────────────────────

export function AnalystBuilderChat({
  currentConfig,
  onConfigSuggested,
  onCreatingChange,
}: {
  currentConfig?: Record<string, unknown>;
  onConfigSuggested?: (config: AgentConfigData, onConfirm: () => void) => void;
  onCreatingChange?: (creating: boolean) => void;
} = {}) {
  const router = useRouter();
  const [isCreating, startCreating] = useTransition();

  const runtime = useChatRuntime({
    transport: useMemo(
      () =>
        new DefaultChatTransport({
          api: "/api/chat/analyst-builder",
          body: currentConfig ? { currentConfig } : undefined,
        }),
      [currentConfig]
    ),
  });

  const [createError, setCreateError] = useState<string | null>(null);

  const handleConfirmConfig = useCallback(
    (config: AgentConfigData) => {
      setCreateError(null);
      onCreatingChange?.(true);
      startCreating(async () => {
        try {
          const result = await createAnalystFromBuilder({
            name: config.name ?? "Untitled Analyst",
            analystPrompt: config.analystPrompt ?? "General market research analyst",
            description: config.description,
            directionBias: config.directionBias ?? "BOTH",
            holdDurations: (config.holdDurations ?? ["SWING"]) as (
              | "DAY"
              | "SWING"
              | "POSITION"
            )[],
            sectors: config.sectors ?? [],
            signalTypes: config.signalTypes ?? [],
            minConfidence: config.minConfidence ?? 65,
            maxPositionSize: config.maxPositionSize ?? 5000,
            maxOpenPositions: config.maxOpenPositions ?? 5,
            minMarketCapTier: (config.minMarketCapTier ?? "LARGE") as
              | "LARGE"
              | "MID"
              | "SMALL",
            watchlist: config.watchlist ?? [],
            exclusionList: config.exclusionList ?? [],
            // V3: Intelligence layer proposals
            sourcePackProposal: config.sourcePackProposal,
            intelligenceQueries: config.intelligenceQueries,
            intelligencePolicy: config.intelligencePolicy,
          });
          toast.success(`Analyst "${config.name}" created`);
          router.push(`/analysts/${result.id}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("Failed to create analyst:", err);
          setCreateError(msg);
          toast.error(`Failed to create analyst: ${msg}`);
        } finally {
          onCreatingChange?.(false);
        }
      });
    },
    [router, onCreatingChange]
  );

  // Callback that the SuggestConfigRender calls to notify the page
  const handleConfigSuggestedInternal = useCallback(
    (config: AgentConfigData) => {
      if (onConfigSuggested) {
        onConfigSuggested(config, () => handleConfirmConfig(config));
      }
    },
    [onConfigSuggested, handleConfirmConfig]
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <BuilderThread
        onConfirmConfig={handleConfirmConfig}
        onConfigSuggested={
          onConfigSuggested ? handleConfigSuggestedInternal : undefined
        }
        isCreating={isCreating}
      />
    </AssistantRuntimeProvider>
  );
}
