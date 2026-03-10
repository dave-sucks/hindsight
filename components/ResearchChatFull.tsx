"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { triggerResearchRun } from "@/lib/actions/research.actions";
import { toast } from "sonner";
import { RunResearchButton } from "@/components/RunResearchButton";
import {
  ChatComposer,
  type ComposerContext,
  type ComposerRecentThesis,
} from "@/components/chat/ChatComposer";

// ── Types ──────────────────────────────────────────────────────────────────────

type StreamEvent =
  | { type: "thinking"; text: string }
  | { type: "token"; text: string }
  | { type: "complete"; thesis: ThesisOutput | null }
  | { type: "error"; text: string };

type ChatHistoryItem = { role: "user" | "assistant"; content: string };

type ThesisOutput = {
  ticker: string;
  direction: "LONG" | "SHORT" | "PASS";
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  hold_duration: string;
  confidence_score: number;
  reasoning_summary: string;
  thesis_bullets: string[];
  risk_flags: string[];
  signal_types: string[];
  sector: string | null;
  model_used: string;
  recommendation_label: string;
  risk_reward_ratio: number | null;
};

type Message =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      status: "thinking" | "streaming" | "done" | "error";
      thinkingText?: string;
      streamedText?: string;
      thesis?: ThesisOutput;
      errorText?: string;
    };

// Re-export the shared thesis type so parent pages that already import from here
// continue to work without changes.
export type { ComposerRecentThesis as RecentThesis };

const SUGGESTIONS = [
  "Research NVDA for a swing trade",
  "What sectors look strong this week?",
  "Is AAPL a buy at current levels?",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildContextMessage(raw: string, ctx: ComposerContext): string {
  const parts: string[] = [];
  const contextParts: string[] = [];

  if (ctx.tradeType !== "SWING" || ctx.direction !== "EITHER") {
    contextParts.push(
      `${ctx.tradeType}${ctx.direction !== "EITHER" ? ` ${ctx.direction}` : ""}`
    );
  }
  if (ctx.ticker) {
    contextParts.push(ctx.ticker.symbol);
  }
  if (contextParts.length > 0) {
    parts.push(`[Research context: ${contextParts.join(", ")}]`);
  }
  if (ctx.referencedThesis) {
    parts.push(
      `Re this research on ${ctx.referencedThesis.ticker} (${new Date(ctx.referencedThesis.createdAt).toLocaleDateString()}): ${ctx.referencedThesis.reasoningSummary}`
    );
    parts.push("");
  }

  parts.push(raw);
  return parts.join("\n");
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ResearchChatFull({
  userId,
  recentTheses,
  hasRunning,
  analystId,
  className,
  hideHeader = false,
}: {
  userId: string;
  recentTheses: ComposerRecentThesis[];
  hasRunning: boolean;
  analystId?: string;
  className?: string;
  /** Hide the internal header when embedded in a page that already provides one */
  hideHeader?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(rawMsg: string, ctx: ComposerContext) {
    if (!rawMsg || busy) return;

    setBusy(true);
    const fullMessage = buildContextMessage(rawMsg, ctx);

    setMessages((prev) => [...prev, { role: "user", text: rawMsg }]);
    const assistantIdx = messages.length + 1;
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        status: "thinking",
        thinkingText: "Starting research...",
      },
    ]);

    try {
      const res = await fetch("/api/research/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: fullMessage,
          history: chatHistory,
          model: ctx.model ?? "gpt-4o",
        }),
      });

      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalThesis: ThesisOutput | null = null;
      let streamedTextRef = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const event: StreamEvent = JSON.parse(line.slice(5).trim());

            if (event.type === "thinking") {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIdx
                    ? ({
                        ...m,
                        status: "thinking",
                        thinkingText: event.text,
                      } as Message)
                    : m
                )
              );
            } else if (event.type === "token") {
              streamedTextRef += event.text;
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIdx
                    ? ({
                        ...m,
                        status: "streaming",
                        streamedText:
                          ((m as { streamedText?: string }).streamedText ?? "") +
                          event.text,
                      } as Message)
                    : m
                )
              );
            } else if (event.type === "complete") {
              finalThesis = event.thesis ?? null;
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIdx
                    ? ({
                        ...m,
                        status: "done",
                        thesis: event.thesis ?? undefined,
                      } as Message)
                    : m
                )
              );
              const assistantContent = event.thesis
                ? `${event.thesis.ticker} — ${event.thesis.recommendation_label} (${event.thesis.direction}). ` +
                  `Confidence: ${event.thesis.confidence_score}%. ` +
                  (event.thesis.entry_price
                    ? `Entry $${event.thesis.entry_price.toFixed(2)}, ` +
                      `Target $${event.thesis.target_price?.toFixed(2) ?? "—"}, ` +
                      `Stop $${event.thesis.stop_loss?.toFixed(2) ?? "—"}. `
                    : "") +
                  event.thesis.reasoning_summary
                : streamedTextRef;
              setChatHistory((prev) => [
                ...prev,
                { role: "user", content: fullMessage },
                { role: "assistant", content: assistantContent },
              ]);
            } else if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIdx
                    ? ({
                        ...m,
                        status: "error",
                        errorText: event.text,
                      } as Message)
                    : m
                )
              );
            }
          } catch {
            // malformed SSE line
          }
        }
      }

      if (finalThesis && finalThesis.direction !== "PASS" && userId) {
        try {
          await triggerResearchRun(
            userId,
            [finalThesis.ticker],
            "MANUAL",
            analystId
          );
        } catch {
          // non-fatal
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === assistantIdx
            ? ({
                ...m,
                status: "error",
                errorText:
                  err instanceof Error ? err.message : "Unknown error",
              } as Message)
            : m
        )
      );
      toast.error("Research failed");
    } finally {
      setBusy(false);
    }
  }

  const defaultCtx: ComposerContext = {
    ticker: null,
    referencedThesis: null,
    tradeType: "SWING",
    direction: "EITHER",
    model: "gpt-4o",
  };

  const isEmpty = messages.length === 0;

  return (
    <div className={className ?? "flex flex-col h-[calc(100dvh-5.25rem)]"}>
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between px-4 h-12 border-b shrink-0">
          <h1 className="text-lg font-medium">Research</h1>
          <RunResearchButton hasRunning={hasRunning} />
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 pb-32 px-4">
            {!hideHeader && (
              <div className="text-center">
                <h2 className="text-xl font-semibold">Hindsight Research</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Ask the AI to research any stock
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSubmit(s, defaultCtx)}
                  className="text-xs border border-border rounded-full px-4 py-2 text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto w-full space-y-6 px-4 py-6 pb-44">
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm max-w-sm">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <AssistantMessage key={i} msg={msg} />
              )
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 pb-6 px-4">
        <ChatComposer
          onSubmit={handleSubmit}
          recentTheses={recentTheses}
          loading={busy}
          placeholder="Research NVDA for a swing trade…"
          className="max-w-2xl mx-auto w-full"
        />
      </div>
    </div>
  );
}

// ── Assistant message sub-components ──────────────────────────────────────────

function AssistantMessage({
  msg,
}: {
  msg: Extract<Message, { role: "assistant" }>;
}) {
  if (msg.status === "thinking") {
    return (
      <div className="flex gap-2 items-center text-sm text-muted-foreground">
        <span className="animate-pulse">●</span>
        <span>{msg.thinkingText}</span>
      </div>
    );
  }

  if (msg.status === "streaming") {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm whitespace-pre-wrap">
        {msg.streamedText}
        <span className="animate-pulse">▌</span>
      </div>
    );
  }

  if (msg.status === "error") {
    return (
      <div className="rounded-xl border border-destructive bg-card px-4 py-3">
        <p className="text-sm text-destructive">
          Research failed — {msg.errorText ?? "unknown error"}. Please try
          again.
        </p>
      </div>
    );
  }

  if (msg.status === "done" && msg.thesis) {
    return <ThesisCard thesis={msg.thesis} />;
  }

  return null;
}

function ThesisCard({ thesis }: { thesis: ThesisOutput }) {
  const directionColor =
    thesis.direction === "LONG"
      ? "text-emerald-500"
      : thesis.direction === "SHORT"
      ? "text-red-500"
      : "text-muted-foreground";

  const recLabelColor =
    thesis.recommendation_label === "STRONG BUY" ||
    thesis.recommendation_label === "BUY"
      ? "text-emerald-500"
      : thesis.recommendation_label === "STRONG SELL" ||
        thesis.recommendation_label === "SELL"
      ? "text-red-500"
      : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            <span className="font-mono">{thesis.ticker}</span>
            <span
              className={`ml-2 text-base font-semibold tabular-nums ${directionColor}`}
            >
              {thesis.direction}
            </span>
          </CardTitle>
          <div className="flex gap-3 items-center">
            <span
              className={`text-xs font-semibold uppercase tracking-wide ${recLabelColor}`}
            >
              {thesis.recommendation_label}
            </span>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Confidence
            </span>
            <span
              className={`tabular-nums font-semibold ${
                thesis.confidence_score >= 70
                  ? "text-emerald-500"
                  : "text-red-500"
              }`}
            >
              {thesis.confidence_score}%
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mt-1">
          {thesis.signal_types.map((s) => (
            <Badge key={s} variant="secondary" className="text-xs">
              {s}
            </Badge>
          ))}
          {thesis.sector && (
            <Badge variant="outline" className="text-xs">
              {thesis.sector}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            {thesis.hold_duration}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {thesis.entry_price && (
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Entry
              </p>
              <p className="tabular-nums font-semibold">
                ${thesis.entry_price.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Target
              </p>
              <p className="tabular-nums font-semibold text-emerald-500">
                {thesis.target_price
                  ? `$${thesis.target_price.toFixed(2)}`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Stop
              </p>
              <p className="tabular-nums font-semibold text-red-500">
                {thesis.stop_loss ? `$${thesis.stop_loss.toFixed(2)}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                R:R
              </p>
              <p
                className={`tabular-nums font-semibold ${
                  thesis.risk_reward_ratio && thesis.risk_reward_ratio >= 2
                    ? "text-emerald-500"
                    : thesis.risk_reward_ratio && thesis.risk_reward_ratio >= 1
                    ? "text-muted-foreground"
                    : "text-red-500"
                }`}
              >
                {thesis.risk_reward_ratio
                  ? `${thesis.risk_reward_ratio.toFixed(1)}x`
                  : "—"}
              </p>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
            Analysis
          </p>
          <p className="text-muted-foreground leading-relaxed">
            {thesis.reasoning_summary}
          </p>
        </div>

        {thesis.thesis_bullets.length > 0 && (
          <ul className="space-y-1 list-disc list-inside text-muted-foreground">
            {thesis.thesis_bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        )}

        {thesis.risk_flags.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Risks
            </p>
            <ul className="space-y-1 list-disc list-inside text-red-500/80">
              {thesis.risk_flags.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {thesis.direction === "PASS" && (
          <p className="text-muted-foreground italic">
            No high-conviction trade identified. The AI suggests passing on this
            setup.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
