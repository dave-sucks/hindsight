"use client";

import { useMemo, useCallback, useTransition } from "react";
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
    title: "Aggressive day trader",
    label: "Momentum + tech breakouts",
    prompt:
      "Build me an aggressive day trader focused on momentum and technical breakouts in tech stocks",
  },
  {
    title: "Conservative swing trader",
    label: "Large-cap fundamentals",
    prompt:
      "Create a conservative swing trader that holds positions for 2-10 days, focused on large-cap fundamentals",
  },
  {
    title: "Earnings momentum player",
    label: "Pre/post-earnings moves",
    prompt:
      "I want an analyst that trades around earnings — catches the run-up and post-earnings momentum",
  },
  {
    title: "Biotech catalyst hunter",
    label: "FDA + options flow",
    prompt:
      "Build a biotech-focused analyst that watches for FDA catalysts, clinical trial data, and unusual options flow",
  },
];

// ─── Inner component (needs to be inside AssistantRuntimeProvider) ──────────

function BuilderThread({
  onConfirmConfig,
  isCreating,
}: {
  onConfirmConfig: (config: AgentConfigData) => void;
  isCreating: boolean;
}) {
  useRegisterBuilderToolUIs();

  const callbacks = useMemo(
    () => ({
      onConfirmConfig,
      isCreating,
      confirmLabel: "Create Analyst",
      confirmingLabel: "Creating...",
    }),
    [onConfirmConfig, isCreating]
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
}: {
  currentConfig?: Record<string, unknown>;
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

  const handleConfirmConfig = useCallback(
    (config: AgentConfigData) => {
      startCreating(async () => {
        try {
          const result = await createAnalystFromBuilder({
            name: config.name,
            analystPrompt: config.analystPrompt,
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
            watchlist: config.watchlist,
            exclusionList: config.exclusionList,
          });
          router.push(`/analysts/${result.id}`);
        } catch (err) {
          console.error("Failed to create analyst:", err);
        }
      });
    },
    [router]
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <BuilderThread
        onConfirmConfig={handleConfirmConfig}
        isCreating={isCreating}
      />
    </AssistantRuntimeProvider>
  );
}
