"use client";

/**
 * AgentThread — the REAL agent UI.
 *
 * Two tabs at the top: Chat (the thread) and Sources (Perplexity-style
 * aggregated list of all news, social, and filing links from the run).
 *
 * After a run completes, the composer switches to the followup transport
 * so users can ask questions, place trades, and manage positions.
 */

import { useCallback, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { useAui } from "@assistant-ui/react";
import { ChatRuntime } from "@/components/chat/chat-runtime";
import { useAutoSend } from "@/hooks/useAutoSend";
import { Thread } from "@/components/assistant-ui/thread";
import { HindsightComposer } from "@/components/assistant-ui/hindsight-composer";
import {
  useRegisterResearchToolUIs,
  useRegisterFollowupToolUIs,
} from "@/components/assistant-ui/tool-uis";
import {
  QuickReply,
  type QuickReply as QuickReplyType,
} from "@/components/manifest-ui/quick-reply";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { RunSourcesPanel } from "@/components/research/run-sources-panel";

// ─── Props ──────────────────────────────────────────────────────────────────

interface AgentThreadProps {
  runId: string;
  analystName: string;
  analystId?: string;
  config: Record<string, unknown>;
  autoStart?: boolean;
  initialMessages?: UIMessage[];
  /** Optional action element rendered in the tabs bar (right side) */
  headerAction?: ReactNode;
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AgentThread({
  runId,
  analystName,
  analystId,
  config,
  autoStart = true,
  initialMessages,
  headerAction,
}: AgentThreadProps) {
  // Live runs use the agent route; completed runs use followup route
  const isFollowupMode = !autoStart && !!initialMessages;

  return (
    <ChatRuntime
      api={isFollowupMode ? "/api/chat/run-followup" : "/api/research/agent"}
      body={isFollowupMode ? { runId, analystId } : { runId, analystId, config }}
      messages={initialMessages}
    >
      <AgentThreadInner
        runId={runId}
        analystName={analystName}
        autoStart={autoStart}
        isFollowupMode={isFollowupMode}
        headerAction={headerAction}
      />
    </ChatRuntime>
  );
}

// ─── Quick reply pills for completed runs ───────────────────────────────────

function FollowupQuickReplies() {
  const aui = useAui();

  const handleSelect = useCallback(
    (reply: QuickReplyType) => {
      if (reply.label) {
        aui.composer().setText(reply.label);
        aui.composer().send();
      }
    },
    [aui],
  );

  return (
    <QuickReply
      data={{
        replies: [
          { label: "Show portfolio status" },
          { label: "Explain the top pick" },
          { label: "What are the biggest risks?" },
          { label: "Research another ticker" },
        ],
      }}
      actions={{ onSelectReply: handleSelect }}
    />
  );
}

// ─── Inner thread component ─────────────────────────────────────────────────

function AgentThreadInner({
  runId,
  analystName,
  autoStart,
  isFollowupMode,
  headerAction,
}: {
  runId: string;
  analystName: string;
  autoStart: boolean;
  isFollowupMode: boolean;
  headerAction?: ReactNode;
}) {
  useRegisterResearchToolUIs(runId);
  useRegisterFollowupToolUIs();
  useAutoSend({ message: autoStart ? "Run" : undefined, delay: 500 });

  return (
    <Tabs defaultValue={0} className="flex h-full flex-col">
      <div className="shrink-0 px-4 pt-2 flex items-center">
        <TabsList>
          <TabsTrigger value={0}>Chat</TabsTrigger>
          <TabsTrigger value={1}>Sources</TabsTrigger>
        </TabsList>
        {headerAction && (
          <div className="ml-auto">{headerAction}</div>
        )}
      </div>

      <TabsContent value={0} className="flex-1 min-h-0 flex flex-col">
        <Thread
          welcomeConfig={{
            title: analystName,
            subtitle: isFollowupMode
              ? "Run complete — ask follow-up questions or place trades"
              : "Autonomous research agent",
          }}
          composerSlot={
            <div className="space-y-2">
              <HindsightComposer
                features={{
                  placeholder: isFollowupMode
                    ? "Ask about the run, research a ticker, or place a trade…"
                    : "Ask a follow-up question…",
                  tickerSearch: true,
                  slashCommands: true,
                }}
              />
            </div>
          }
        />
      </TabsContent>

      <TabsContent value={1} className="flex-1 min-h-0 overflow-y-auto">
        <RunSourcesPanel />
      </TabsContent>
    </Tabs>
  );
}
