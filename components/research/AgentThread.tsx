"use client";

/**
 * AgentThread — the REAL agent UI.
 *
 * This is just useChatRuntime connected to the agent API route, rendered by
 * assistant-ui's Thread. The LLM does all the thinking and narrating.
 * Tool calls (show_thesis, place_trade) render as domain cards.
 * Data-fetching tools render nothing — the LLM narrates the results.
 *
 * No fake messages. No event mapping. Just a real AI conversation.
 */

import { useMemo, useEffect, useRef } from "react";
import { DefaultChatTransport } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import {
  AssistantRuntimeProvider,
  useAssistantToolUI,
  useThreadRuntime,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import {
  ThesisCard,
  type ThesisCardData,
} from "@/components/domain/thesis-card";
import { TradeCard } from "@/components/domain/trade-card";
import { TradeConfirmation } from "@/components/domain/trade-confirmation";
import { Bot } from "lucide-react";

// ─── Props ──────────────────────────────────────────────────────────────────

interface AgentThreadProps {
  runId: string;
  analystName: string;
  analystId?: string;
  config: Record<string, unknown>;
  /** Auto-start: send an initial message to kick off the agent */
  autoStart?: boolean;
}

// ─── Tool UI registrations ──────────────────────────────────────────────────

function useRegisterAgentToolUIs() {
  // Thesis card — rendered when the agent calls show_thesis
  useAssistantToolUI({
    toolName: "show_thesis",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/20 border-t-amber-500 animate-spin" />
            Building thesis...
          </div>
        );
      }

      const thesis: ThesisCardData = {
        ticker: result.ticker,
        direction: result.direction,
        confidence_score: result.confidence_score,
        reasoning_summary: result.reasoning_summary,
        thesis_bullets: result.thesis_bullets ?? [],
        risk_flags: result.risk_flags ?? [],
        entry_price: result.entry_price ?? null,
        target_price: result.target_price ?? null,
        stop_loss: result.stop_loss ?? null,
        hold_duration: result.hold_duration ?? "SWING",
        signal_types: result.signal_types ?? [],
      };

      return (
        <div className="my-3">
          <ThesisCard {...thesis} />
        </div>
      );
    },
  });

  // Trade card — rendered when the agent calls place_trade
  useAssistantToolUI({
    toolName: "place_trade",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-2 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-4 w-4 rounded-full border-2 border-muted-foreground/20 border-t-emerald-500 animate-spin" />
            Preparing trade...
          </div>
        );
      }

      // If pending confirmation, show the confirmation card
      if (result.status === "pending_confirmation") {
        return (
          <div className="my-3">
            <TradeConfirmation
              ticker={result.ticker}
              direction={result.direction}
              estimatedPrice={result.entry_price}
              estimatedCost={result.entry_price * (result.shares || 1)}
              shares={result.shares}
              onConfirm={() => {
                // TODO: wire to actual createTrade server action
              }}
              onCancel={() => {}}
            />
          </div>
        );
      }

      // Filled trade
      return (
        <div className="my-3">
          <TradeCard
            ticker={result.ticker}
            direction={result.direction}
            entryPrice={result.entry_price}
            status="OPEN"
          />
        </div>
      );
    },
  });

  // Data tools show a brief loading state, then nothing — the LLM narrates
  const dataTools = [
    { name: "get_market_overview", label: "Checking market conditions..." },
    { name: "scan_candidates", label: "Scanning for candidates..." },
    { name: "get_stock_data", label: "Fetching stock data..." },
    { name: "get_technical_analysis", label: "Running technical analysis..." },
    { name: "get_reddit_sentiment", label: "Checking Reddit sentiment..." },
    { name: "get_options_flow", label: "Analyzing options flow..." },
    { name: "get_earnings_data", label: "Looking up earnings data..." },
  ];

  for (const { name, label } of dataTools) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAssistantToolUI({
      toolName: name,
      render: ({ result }) => {
        if (!result) {
          return (
            <div className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/20 border-t-blue-500 animate-spin" />
              {label}
            </div>
          );
        }
        // Data tools render nothing when complete — the LLM narrates
        return null;
      },
    });
  }
}

// ─── Main component ─────────────────────────────────────────────────────────

export function AgentThread({
  runId,
  analystName,
  analystId,
  config,
  autoStart = true,
}: AgentThreadProps) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/research/agent",
        body: { runId, analystId, config },
      }),
    [runId, analystId, config],
  );

  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AgentThreadInner
        analystName={analystName}
        autoStart={autoStart}
      />
    </AssistantRuntimeProvider>
  );
}

function AgentThreadInner({
  analystName,
  autoStart,
}: {
  analystName: string;
  autoStart: boolean;
}) {
  useRegisterAgentToolUIs();

  const threadRuntime = useThreadRuntime();

  // Auto-start: send an initial "kick-off" message so the agent begins
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
        icon: (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/20 to-blue-500/20 ring-1 ring-violet-500/30">
            <Bot className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" />
          </div>
        ),
      }}
    />
  );
}
