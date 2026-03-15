"use client";

/**
 * AgentThread — the REAL agent UI.
 *
 * Compact tool UIs render tight data cards for every tool call:
 * - Market overview → MarketContextCard (compact)
 * - Scan candidates → ScanResultsCard (chip grid)
 * - Stock data → StockCard (inline → sheet) + NewsCard (post-list)
 * - Technical analysis → TechnicalCard (reasoning block)
 * - Earnings data → EarningsCard (compact rows)
 * - Options flow → OptionsFlowCard (compact)
 * - Reddit sentiment → collapsible reasoning block
 * - show_thesis → slim pill → ThesisArtifactSheet
 * - place_trade → TradeCard (server-side execution)
 * - summarize_run → RunSummaryCard
 */

import { useMemo, useEffect, useRef } from "react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import {
  AssistantRuntimeProvider,
  useThreadRuntime,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { HindsightComposer } from "@/components/assistant-ui/hindsight-composer";
import { useRegisterResearchToolUIs } from "@/components/assistant-ui/tool-uis";

// ─── Props ──────────────────────────────────────────────────────────────────

interface AgentThreadProps {
  runId: string;
  analystName: string;
  analystId?: string;
  config: Record<string, unknown>;
  autoStart?: boolean;
  initialMessages?: UIMessage[];
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AgentThread({
  runId,
  analystName,
  analystId,
  config,
  autoStart = true,
  initialMessages,
}: AgentThreadProps) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/research/agent",
        body: { runId, analystId, config },
      }),
    [runId, analystId, config],
  );

  const runtime = useChatRuntime({
    transport,
    ...(initialMessages ? { messages: initialMessages } : {}),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentThreadInner
        runId={runId}
        analystName={analystName}
        autoStart={autoStart}
      />
    </AssistantRuntimeProvider>
  );
}

// Old DefaultComposer removed — replaced by HindsightComposer

// ─── Inner thread component ─────────────────────────────────────────────────

function AgentThreadInner({
  runId,
  analystName,
  autoStart,
}: {
  runId: string;
  analystName: string;
  autoStart: boolean;
}) {
  useRegisterResearchToolUIs(runId);

  const threadRuntime = useThreadRuntime();

  const hasSent = useRef(false);
  useEffect(() => {
    if (!autoStart || hasSent.current) return;
    hasSent.current = true;
    const timer = setTimeout(() => {
      threadRuntime.append({
        role: "user",
        content: [{ type: "text", text: "Run" }],
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [autoStart, threadRuntime]);

  return (
    <Thread
      welcomeConfig={{
        title: analystName,
        subtitle: "Autonomous research agent",
      }}
      composerSlot={
        <div>
          <HindsightComposer
            features={{
              placeholder: "Ask a follow-up question…",
              tickerSearch: true,
              slashCommands: true,
            }}
          />
        </div>
      }
    />
  );
}
