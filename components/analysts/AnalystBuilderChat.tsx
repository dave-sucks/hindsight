"use client";

import { useMemo, useCallback, useTransition, useState, useRef, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DefaultChatTransport } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider, useThreadRuntime } from "@assistant-ui/react";
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

// ─── Hook: auto-send a prompt into the thread ────────────────────────────────

function useAutoSend(prompt?: string) {
  const threadRuntime = useThreadRuntime();
  const hasSent = useRef(false);
  useEffect(() => {
    if (!prompt || hasSent.current) return;
    hasSent.current = true;
    const timer = setTimeout(() => {
      threadRuntime.append({
        role: "user",
        content: [{ type: "text", text: prompt }],
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [prompt, threadRuntime]);
}

// ─── Inner: registers tool UIs + provides callbacks ──────────────────────────

function BuilderInner({
  onConfirmConfig,
  onConfigSuggested,
  isCreating,
  initialPrompt,
  children,
}: {
  onConfirmConfig: (config: AgentConfigData) => void;
  onConfigSuggested?: (config: AgentConfigData) => void;
  isCreating: boolean;
  initialPrompt?: string;
  children: ReactNode;
}) {
  useRegisterBuilderToolUIs();
  useAutoSend(initialPrompt);

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
      {children}
    </ToolUICallbacksProvider>
  );
}

// ─── Provider: runtime setup, composable with any children ───────────────────
// Wrap your own layout with this to get the builder runtime.
// Then render <Thread /> or just a <Composer /> — whatever you want.

export function AnalystBuilderProvider({
  currentConfig,
  onConfigSuggested,
  onCreatingChange,
  initialPrompt,
  children,
}: {
  currentConfig?: Record<string, unknown>;
  onConfigSuggested?: (config: AgentConfigData, onConfirm: () => void) => void;
  onCreatingChange?: (creating: boolean) => void;
  initialPrompt?: string;
  children: ReactNode;
}) {
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

  const handleConfirmConfig = useCallback(
    (config: AgentConfigData) => {
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
            domainMonitorProposal: config.domainMonitorProposal,
            intelligenceQueries: config.intelligenceQueries,
            intelligencePolicy: config.intelligencePolicy,
          });
          toast.success(`Analyst "${config.name}" created`);
          router.push(`/analysts/${result.id}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error("Failed to create analyst:", err);
          toast.error(`Failed to create analyst: ${msg}`);
        } finally {
          onCreatingChange?.(false);
        }
      });
    },
    [router, onCreatingChange]
  );

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
      <BuilderInner
        onConfirmConfig={handleConfirmConfig}
        onConfigSuggested={
          onConfigSuggested ? handleConfigSuggestedInternal : undefined
        }
        isCreating={isCreating}
        initialPrompt={initialPrompt}
      >
        {children}
      </BuilderInner>
    </AssistantRuntimeProvider>
  );
}

// ─── AnalystBuilderChat: full-page builder (used on /analysts/new) ───────────
// This is the original component — provider + Thread in one shot.

export function AnalystBuilderChat({
  currentConfig,
  onConfigSuggested,
  onCreatingChange,
  initialPrompt,
}: {
  currentConfig?: Record<string, unknown>;
  onConfigSuggested?: (config: AgentConfigData, onConfirm: () => void) => void;
  onCreatingChange?: (creating: boolean) => void;
  initialPrompt?: string;
} = {}) {
  return (
    <AnalystBuilderProvider
      currentConfig={currentConfig}
      onConfigSuggested={onConfigSuggested}
      onCreatingChange={onCreatingChange}
      initialPrompt={initialPrompt}
    >
      <Thread
        welcomeConfig={BUILDER_WELCOME}
        composerFeatures={{
          tickerSearch: true,
          placeholder: "Describe your ideal trading analyst…",
        }}
      />
    </AnalystBuilderProvider>
  );
}
