"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { UserMessage } from "@/components/chat/UserMessage";
import { ChatThread } from "@/components/chat/ChatThread";
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
function extractToolConfig(
  msg: { parts: Array<{ type: string; toolInvocation?: { toolName: string; state: string; args?: Record<string, unknown> } }> }
): SuggestedConfig | null {
  for (let i = msg.parts.length - 1; i >= 0; i--) {
    const part = msg.parts[i];
    if (
      part.type === "tool-invocation" &&
      part.toolInvocation?.toolName === "suggest_config" &&
      part.toolInvocation?.state === "result" &&
      part.toolInvocation?.args
    ) {
      return part.toolInvocation.args as unknown as SuggestedConfig;
    }
  }
  return null;
}

// Get all text parts from a message
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
  const bottomRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/analyst-builder",
        body: currentConfig ? { currentConfig } : undefined,
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

  // Find the last suggested config across all messages
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
      {/* Chat thread area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!hasMessages ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full px-6">
            <div className="max-w-md text-center space-y-4">
              <div className="mx-auto h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-medium">Build an Analyst</h2>
                <p className="text-sm text-muted-foreground mt-1">
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
            </div>
          </div>
        ) : (
          /* Messages */
          <ChatThread>
            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <UserMessage key={msg.id}>
                    {getMessageText(msg)}
                  </UserMessage>
                );
              }

              // Assistant message — render text + any tool results
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
                    <div className="max-w-2xl mx-auto px-4 sm:px-6">
                      <ConfigPreviewCard
                        config={config}
                        onConfirm={handleCreate}
                        isCreating={isCreating}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </ChatThread>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="shrink-0 px-4 sm:px-6 pb-3 pt-2">
        <div className="max-w-2xl mx-auto">
          <ChatComposer
            onSubmit={handleComposerSubmit}
            recentTheses={recentTheses}
            placeholder={
              hasMessages
                ? "Refine your analyst…"
                : "Describe the analyst you want to build…"
            }
            loading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
