"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useCallback, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Check } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
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
    const isConfigTool =
      part.type === "tool-suggest_config" ||
      (part.type === "dynamic-tool" && part.toolName === "suggest_config");
    if (
      isConfigTool &&
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

  const handleComposerSubmit = useCallback(
    (message: string, _ctx: ComposerContext) => {
      const text = message.trim();
      if (!text || isLoading) return;
      setApplied(false);
      sendMessage({ text });
    },
    [isLoading, sendMessage]
  );

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
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="gap-3 px-4 py-3">
          {messages.length === 0 && (
            <ConversationEmptyState
              description="Tell me how you want to change this analyst..."
              className="py-4"
            />
          )}
          {messages.map((msg) => {
            if (msg.role === "user") {
              return (
                <Message key={msg.id} from="user">
                  <MessageContent>{getMessageText(msg)}</MessageContent>
                </Message>
              );
            }

            const text = getMessageText(msg);
            const config = extractToolConfig(msg);
            const isStreaming =
              status === "streaming" &&
              msg.id === messages[messages.length - 1].id;

            return (
              <Message key={msg.id} from="assistant">
                <div className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <MessageContent>
                    {text && (
                      <>
                        <MessageResponse>{text}</MessageResponse>
                        {isStreaming && (
                          <span className="inline-block w-0.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
                        )}
                      </>
                    )}
                  </MessageContent>
                </div>
                {config && (
                  <div className="pl-10 space-y-1.5">
                    <ConfigPreviewCard
                      config={config}
                      onConfirm={handleApply}
                      isCreating={isApplying}
                      showConfirmButton={!applied}
                      confirmLabel="Apply Changes"
                      confirmingLabel="Applying..."
                    />
                    {applied && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                        <Check className="h-3 w-3" />
                        Changes applied
                      </div>
                    )}
                  </div>
                )}
              </Message>
            );
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Composer */}
      <div className="shrink-0 px-4 pb-3 pt-2">
        <ChatComposer
          onSubmit={handleComposerSubmit}
          recentTheses={recentTheses}
          placeholder="Describe how to change this analyst\u2026"
          status={status}
        />
      </div>
    </div>
  );
}
