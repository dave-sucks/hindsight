"use client";

import { AnalystChatProvider } from "@/components/analysts/AnalystChatProvider";
import { Thread } from "@/components/assistant-ui/thread";
import type { AgentConfigData } from "@/components/domain/agent-config-card";

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
  return (
    <AnalystChatProvider
      mode="editor"
      analystId={analystId}
      currentConfig={currentConfig}
      onConfigSuggested={onConfigSuggested}
      onMutatingChange={onApplyingChange}
      initialPrompt={initialMessage}
    >
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
    </AnalystChatProvider>
  );
}
