"use client";

import { type ReactNode } from "react";
import { AnalystChatProvider } from "@/components/analysts/AnalystChatProvider";
import { Thread, type WelcomeConfig } from "@/components/assistant-ui/thread";
import type { HindsightComposerFeatures } from "@/components/assistant-ui/hindsight-composer";
import type { AgentConfigData } from "@/components/domain/agent-config-card";
import { Sparkles, Globe, BarChart3, FileText, Activity } from "lucide-react";
import { PerplexityLogo } from "@/components/intelligence/icons";

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

const BUILDER_COMPOSER: HindsightComposerFeatures = {
  tickerSearch: true,
  placeholder: "Describe your ideal trading analyst…",
  integrations: [
    { label: "Live market data", icon: Activity, enabled: true, description: "Finnhub quotes, earnings, company metrics" },
    { label: "Web research", icon: PerplexityLogo, enabled: true, description: "Perplexity Sonar for live web search" },
    { label: "Domain monitoring", icon: Globe, enabled: true, description: "Firecrawl for tracked website extraction" },
    { label: "SEC filings", icon: FileText, enabled: true, description: "10-K, 10-Q, 8-K, Form 4 from EDGAR" },
    { label: "Paper trading", icon: BarChart3, enabled: true, description: "Alpaca for simulated trades" },
  ],
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
        composerFeatures={BUILDER_COMPOSER}
      />
    </AnalystBuilderProvider>
  );
}
