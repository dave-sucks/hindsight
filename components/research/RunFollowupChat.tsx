"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRef, useEffect, useCallback, useMemo } from "react";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import { UserMessage } from "@/components/chat/UserMessage";
import {
  ChatComposer,
  type ComposerContext,
  type ComposerRecentThesis,
} from "@/components/chat/ChatComposer";
import { ThesisCard, type ThesisCardData } from "@/components/domain";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  ShoppingCart,
  Briefcase,
  BarChart3,
  GitCompare,
  HelpCircle,
  Loader2,
} from "lucide-react";

export type RunFollowupContext = {
  analystName?: string;
  config?: Record<string, unknown>;
  theses?: Array<{
    ticker: string;
    direction: string;
    confidence_score: number;
    reasoning_summary?: string;
    thesis_bullets?: string[];
    risk_flags?: string[];
    entry_price?: number | null;
    target_price?: number | null;
    stop_loss?: number | null;
    signal_types?: string[];
  }>;
  tradesPlaced?: Array<{
    ticker: string;
    direction: string;
    entry: number;
  }>;
};

// ── Suggested prompts ─────────────────────────────────────────────────────────

function buildSuggestions(ctx: RunFollowupContext): string[] {
  const suggestions: string[] = [];
  const theses = ctx.theses ?? [];
  const actionable = theses.filter((t) => t.direction !== "PASS");

  if (actionable.length > 0) {
    suggestions.push(`Why is ${actionable[0].ticker} your top pick?`);
  }
  if (actionable.length >= 2) {
    suggestions.push(
      `Compare ${actionable.slice(0, 3).map((t) => t.ticker).join(" vs ")}`
    );
  }
  const passed = theses.filter((t) => t.direction === "PASS");
  if (passed.length > 0) {
    suggestions.push(`Why did you pass on ${passed[0].ticker}?`);
  }
  suggestions.push("How's my portfolio doing?");

  return suggestions.slice(0, 4);
}

// ── Extract text from UIMessage parts ─────────────────────────────────────────

function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && "text" in p)
    .map((p) => p.text)
    .join("");
}

// ── Tool result renderers ─────────────────────────────────────────────────────

function ToolResultCard({ toolName, result }: { toolName: string; result: Record<string, unknown> }) {
  if (result.error) {
    return (
      <div className="text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
        {String(result.error)}
      </div>
    );
  }

  switch (toolName) {
    case "research_ticker":
    case "get_thesis": {
      const thesis: ThesisCardData = {
        ticker: String(result.ticker ?? ""),
        direction: String(result.direction ?? "PASS") as "LONG" | "SHORT" | "PASS",
        confidence_score: Number(result.confidence_score ?? 0),
        reasoning_summary: String(result.reasoning_summary ?? ""),
        thesis_bullets: Array.isArray(result.thesis_bullets) ? result.thesis_bullets as string[] : [],
        risk_flags: Array.isArray(result.risk_flags) ? result.risk_flags as string[] : [],
        entry_price: typeof result.entry_price === "number" ? result.entry_price : null,
        target_price: typeof result.target_price === "number" ? result.target_price : null,
        stop_loss: typeof result.stop_loss === "number" ? result.stop_loss : null,
        hold_duration: String(result.hold_duration ?? "SWING"),
        signal_types: Array.isArray(result.signal_types) ? result.signal_types as string[] : [],
      };
      return <ThesisCard {...thesis} />;
    }

    case "compare_tickers": {
      const tickers = Array.isArray(result.tickers) ? result.tickers as string[] : [];
      const recommended = String(result.recommended ?? "");
      return (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitCompare className="h-4 w-4 text-muted-foreground" />
            Comparing {tickers.join(" vs ")}
          </div>
          {recommended && (
            <p className="text-sm">
              Recommendation:{" "}
              <span className="font-mono font-semibold text-emerald-500">{recommended}</span>
            </p>
          )}
        </div>
      );
    }

    case "place_trade": {
      const isLong = String(result.direction ?? "").toUpperCase() === "LONG";
      return (
        <div className="flex items-center gap-2 text-sm rounded-lg border bg-emerald-500/5 border-emerald-500/20 px-4 py-3">
          <ShoppingCart className="h-4 w-4 text-emerald-500" />
          <span>
            Trade placed:{" "}
            <span className="font-mono font-semibold">{String(result.ticker)}</span>{" "}
            <span className={isLong ? "text-emerald-500" : "text-red-500"}>
              {isLong ? <TrendingUp className="inline h-3 w-3 mr-0.5" /> : <TrendingDown className="inline h-3 w-3 mr-0.5" />}
              {String(result.direction).toUpperCase()}
            </span>
            {typeof result.fillPrice === "number" && (
              <span className="tabular-nums text-muted-foreground"> @ ${Number(result.fillPrice).toFixed(2)}</span>
            )}
          </span>
        </div>
      );
    }

    case "close_position": {
      const pnl = typeof result.realizedPnl === "number" ? result.realizedPnl : null;
      return (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            Position closed: <span className="font-mono">{String(result.ticker)}</span>
          </div>
          {pnl != null && (
            <p className={cn("text-sm tabular-nums font-semibold", pnl >= 0 ? "text-emerald-500" : "text-red-500")}>
              P&L: {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({String(result.outcome)})
            </p>
          )}
        </div>
      );
    }

    case "portfolio_status": {
      const positions = Array.isArray(result.positions) ? result.positions.length : 0;
      const unrealized = typeof result.unrealizedPnl === "number" ? result.unrealizedPnl : null;
      const winRate = typeof result.winRate === "number" ? result.winRate : null;
      return (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
            Portfolio Status
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Positions</p>
              <p className="text-sm tabular-nums font-semibold">{positions}</p>
            </div>
            {unrealized != null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Unrealized</p>
                <p className={cn("text-sm tabular-nums font-semibold", unrealized >= 0 ? "text-emerald-500" : "text-red-500")}>
                  {unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)}
                </p>
              </div>
            )}
            {winRate != null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Win Rate</p>
                <p className="text-sm tabular-nums font-semibold">{winRate.toFixed(0)}%</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    case "performance_report": {
      const wins = typeof result.wins === "number" ? result.wins : 0;
      const losses = typeof result.losses === "number" ? result.losses : 0;
      const winRate = typeof result.winRate === "number" ? result.winRate : null;
      return (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            Performance Report
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Wins</p>
              <p className="text-sm tabular-nums font-semibold text-emerald-500">{wins}</p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Losses</p>
              <p className="text-sm tabular-nums font-semibold text-red-500">{losses}</p>
            </div>
            {winRate != null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Win Rate</p>
                <p className="text-sm tabular-nums font-semibold">{winRate.toFixed(0)}%</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    case "explain_decision": {
      return (
        <div className="rounded-lg border p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
            Decision: <span className="font-mono">{String(result.ticker)}</span>
          </div>
          {typeof result.explanation === "string" && (
            <p className="text-sm text-muted-foreground">{result.explanation}</p>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

// ── Render tool parts from a message ──────────────────────────────────────────

function renderToolParts(msg: UIMessage) {
  const toolParts: React.ReactNode[] = [];

  for (const part of msg.parts) {
    // AI SDK v6: tool parts have type "tool-{toolName}" or "dynamic-tool"
    if (part.type === "text" || part.type === "reasoning" || part.type === "source-url" || part.type === "source-document") continue;

    const toolPart = part as unknown as {
      type: string;
      toolName?: string;
      state?: string;
      output?: unknown;
    };

    const toolName = toolPart.toolName ?? part.type.replace("tool-", "");

    if (toolPart.state !== "output-available") {
      toolParts.push(
        <div key={`${msg.id}-${toolName}-loading`} className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running {toolName.replace(/_/g, " ")}...
        </div>
      );
    } else if (toolPart.output && typeof toolPart.output === "object") {
      toolParts.push(
        <ToolResultCard
          key={`${msg.id}-${toolName}-result`}
          toolName={toolName}
          result={toolPart.output as Record<string, unknown>}
        />
      );
    }
  }

  return toolParts;
}

// ── Main component ────────────────────────────────────────────────────────────

export function RunFollowupChat({
  runContext,
  recentTheses = [],
  className,
}: {
  runContext: RunFollowupContext;
  recentTheses?: ComposerRecentThesis[];
  className?: string;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => buildSuggestions(runContext), [runContext]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat/run-followup",
        body: { runContext },
      }),
    [runContext]
  );

  const { messages, sendMessage, status } = useChat({ transport });

  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleComposerSubmit = useCallback(
    async (message: string, _context: ComposerContext) => {
      if (!message.trim() || isLoading) return;
      sendMessage({ text: message });
    },
    [isLoading, sendMessage]
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      if (isLoading) return;
      sendMessage({ text: suggestion });
    },
    [isLoading, sendMessage]
  );

  return (
    <div className={cn("border-t shrink-0", className)}>
      {/* Follow-up message thread */}
      {messages.length > 0 && (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-4 pb-2 space-y-4">
          {messages.map((msg) => {
            const text = getMessageText(msg);
            const isLastAssistant =
              msg.role === "assistant" && msg.id === messages[messages.length - 1].id;
            const streaming = status === "streaming" && isLastAssistant;
            const toolNodes = msg.role === "assistant" ? renderToolParts(msg) : [];

            return msg.role === "user" ? (
              <UserMessage key={msg.id}>{text}</UserMessage>
            ) : (
              <div key={msg.id} className="space-y-3">
                {text && (
                  <AssistantMessage content={text} isStreaming={streaming} />
                )}
                {toolNodes}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Suggested prompts — show only when no messages yet */}
      {messages.length === 0 && suggestions.length > 0 && (
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-3 pb-1">
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => handleSuggestionClick(s)}
                className="text-xs text-muted-foreground hover:text-foreground border rounded-full px-3 py-1.5 transition-colors hover:bg-muted/50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="px-4 sm:px-6 py-3">
        <div className="max-w-2xl mx-auto">
          <ChatComposer
            onSubmit={handleComposerSubmit}
            recentTheses={recentTheses}
            placeholder="Ask about this run..."
            loading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
