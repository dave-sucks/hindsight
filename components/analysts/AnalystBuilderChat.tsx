"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
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
import { createAnalystFromBuilder } from "@/lib/actions/analyst.actions";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  { label: "Aggressive day trader", prompt: "Build me an aggressive day trader focused on momentum and technical breakouts in tech stocks" },
  { label: "Conservative swing trader", prompt: "Create a conservative swing trader that holds positions for 2-10 days, focused on large-cap fundamentals" },
  { label: "Earnings momentum player", prompt: "I want an analyst that trades around earnings — catches the run-up and post-earnings momentum" },
  { label: "Biotech catalyst hunter", prompt: "Build a biotech-focused analyst that watches for FDA catalysts, clinical trial data, and unusual options flow" },
];

// Extract the last suggest_config tool result from a message
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

export function AnalystBuilderChat({
  currentConfig,
  recentTheses = [],
}: {
  currentConfig?: Record<string, unknown>;
  recentTheses?: ComposerRecentThesis[];
} = {}) {
  const router = useRouter();
  const [isCreating, startCreating] = useTransition();

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/analyst-builder",
        body: currentConfig ? { currentConfig } : undefined,
      }),
    [currentConfig]
  );

  const { messages, sendMessage, status, error } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";

  const handleComposerSubmit = useCallback(
    (message: string, _ctx: ComposerContext) => {
      const text = message.trim();
      if (!text || isLoading) return;
      sendMessage({ text });
    },
    [isLoading, sendMessage]
  );

  const handleSuggestion = useCallback(
    (prompt: string) => {
      if (isLoading) return;
      sendMessage({ text: prompt });
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

  const handleCreate = useCallback(() => {
    if (!lastConfig) return;
    startCreating(async () => {
      try {
        const result = await createAnalystFromBuilder({
          name: lastConfig.name,
          analystPrompt: lastConfig.analystPrompt,
          description: lastConfig.description,
          directionBias: lastConfig.directionBias,
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
        router.push(`/analysts/${result.id}`);
      } catch (err) {
        console.error("Failed to create analyst:", err);
      }
    });
  }, [lastConfig, router]);

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      <Conversation className="flex-1 min-h-0">
        <ConversationContent className="mx-auto max-w-2xl gap-5">
          {!hasMessages ? (
            <ConversationEmptyState>
              <div className="mx-auto h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-medium">Build an Analyst</h2>
                <p className="text-sm text-muted-foreground">
                  Describe the kind of trading analyst you want and I&apos;ll help configure it.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => handleSuggestion(s.prompt)}
                    disabled={isLoading}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      "disabled:opacity-50"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((msg) => {
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
                    <div className="pl-10">
                      <ConfigPreviewCard
                        config={config}
                        onConfirm={handleCreate}
                        isCreating={isCreating}
                      />
                    </div>
                  )}
                </Message>
              );
            })
          )}
          {status === "error" && error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
              <p className="text-sm text-destructive">
                Something went wrong. Please try again.
              </p>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Composer */}
      <div className="shrink-0 px-4 sm:px-6 pb-3 pt-2">
        <div className="max-w-2xl mx-auto">
          <ChatComposer
            onSubmit={handleComposerSubmit}
            recentTheses={recentTheses}
            placeholder={
              hasMessages
                ? "Refine your analyst\u2026"
                : "Describe the analyst you want to build\u2026"
            }
            status={status}
          />
        </div>
      </div>
    </div>
  );
}
