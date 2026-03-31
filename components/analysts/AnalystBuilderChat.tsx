"use client";

import { type ReactNode } from "react";
import { AnalystChatProvider } from "@/components/analysts/AnalystChatProvider";
import { Thread, type WelcomeConfig } from "@/components/assistant-ui/thread";
import type { AgentConfigData } from "@/components/domain/agent-config-card";
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

/**
 * Composable provider — wrap your own layout to get the builder runtime.
 * Renders <AnalystChatProvider mode="builder"> underneath.
 */
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
  return (
    <AnalystChatProvider
      mode="builder"
      currentConfig={currentConfig}
      onConfigSuggested={onConfigSuggested}
      onMutatingChange={onCreatingChange}
      initialPrompt={initialPrompt}
    >
      {children}
    </AnalystChatProvider>
  );
}

/**
 * Full-page builder chat — provider + Thread in one shot.
 * Used on /analysts/new.
 */
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
