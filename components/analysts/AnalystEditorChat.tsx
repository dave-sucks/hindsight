"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { UserMessage } from "@/components/chat/UserMessage";
import {
  ChatComposer,
  type ComposerContext,
  type ComposerRecentThesis,
} from "@/components/chat/ChatComposer";
import {
  ConfigPreviewCard,
  type SuggestedConfig,
} from "@/components/analysts/ConfigPreviewCard";
import { updateAnalystFromBuilder } from "@/lib/actions/analyst.actions";

// AI SDK v6: static tools have type "tool-{toolName}", input at part.input, state "output-available"
function extractToolConfig(
  msg: { parts: Array<Record<string, unknown>> }
): SuggestedConfig | null {
  for (let i = msg.parts.length - 1; i >= 0; i--) {
    const part = msg.parts[i];
    // v6 static tool: type === "tool-suggest_config"
    if (
      part.type === "tool-suggest_config" &&
      (part.state === "output-available" || part.state === "input-available") &&
      part.input
    ) {
      return part.input as unknown as SuggestedConfig;
    }
  }
  return null;
}

function getMessageText(
  msg: { parts: Array<{ type: string; text?: string }> }
): string {
  return msg.parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("");
}

export function AnalystEditorChat({
  analystId,
  currentConfig,
  recentTheses = [],
}: {
  analystId: string;
  currentConfig: Record<string, unknown>;
  recentTheses?: ComposerRecentThesis[];
}) {
  const router = useRouter();
  const [isApplying, startApplying] = useTransition();
  const [applied, setApplied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/analyst-builder",
        body: { currentConfig },
      }),
    [currentConfig]
  );

  const { messages, sendMessage, status } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleComposerSubmit = useCallback(
    (message: string, _ctx: ComposerContext) => {
      const text = message.trim();
      if (!text || isLoading) return;
      setApplied(false);
      sendMessage({ text });
    },
    [isLoading, sendMessage]
  );

  // Find the last suggested config
  const lastConfig = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const cfg = extractToolConfig(messages[i]);
      if (cfg) return cfg;
    }
    return null;
  }, [messages]);

  const handleApply = useCallback(() => {
    if (!lastConfig) return;
    startApplying(async () => {
      try {
        await updateAnalystFromBuilder(analystId, {
          name: lastConfig.name,
          analystPrompt: lastConfig.analystPrompt,
          directionBias: lastConfig.directionBias as "LONG" | "SHORT" | "BOTH",
          holdDurations: lastConfig.holdDurations as ("DAY" | "SWING" | "POSITION")[],
          sectors: lastConfig.sectors,
          signalTypes: lastConfig.signalTypes,
          minConfidence: lastConfig.minConfidence,
          maxPositionSize: lastConfig.maxPositionSize,
          maxOpenPositions: lastConfig.maxOpenPositions,
          minMarketCapTier: lastConfig.minMarketCapTier as "LARGE" | "MID" | "SMALL",
          watchlist: lastConfig.watchlist,
          exclusionList: lastConfig.exclusionList,
        });
        setApplied(true);
        router.refresh();
      } catch (err) {
        console.error("Failed to apply config:", err);
      }
    });
  }, [lastConfig, analystId, router]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Tell me how you want to change this analyst...
          </p>
        )}
        {messages.map((msg) => {
          if (msg.role === "user") {
            return (
              <UserMessage key={msg.id}>
                {getMessageText(msg)}
              </UserMessage>
            );
          }

          const text = getMessageText(msg);
          const config = extractToolConfig(msg);

          return (
            <div key={msg.id} className="space-y-2">
              {text && (
                <AssistantMessage
                  content={text}
                  isStreaming={
                    status === "streaming" &&
                    msg.id === messages[messages.length - 1].id
                  }
                />
              )}
              {config && (
                <ConfigPreviewCard
                  config={config}
                  onConfirm={handleApply}
                  isCreating={isApplying}
                  showConfirmButton={!applied}
                  confirmLabel="Apply Changes"
                  confirmingLabel="Applying..."
                />
              )}
              {config && applied && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-500 pl-1">
                  <Check className="h-3 w-3" />
                  Changes applied
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-3 pt-2">
        <ChatComposer
          onSubmit={handleComposerSubmit}
          recentTheses={recentTheses}
          placeholder="Describe how to change this analyst…"
          loading={isLoading}
        />
      </div>
    </div>
  );
}
