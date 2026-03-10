"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  CheckCircle,
  AlertCircle,
  Search,
  Database,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Play,
  Zap,
} from "lucide-react";
import type { RunEventItem } from "@/components/research/RunTimeline";
import type { RunMessage } from "@/components/research/RunChatBar";

// ─── Types ────────────────────────────────────────────────────────────────────

type ConversationEntry =
  | { kind: "event"; id: string; event: RunEventItem }
  | { kind: "message"; id: string; message: RunMessage };

type CandidateInfo = { ticker: string; score?: number };
type SourceCategory = {
  category: string;
  available: boolean;
  count?: number;
};

// ─── Event icon ───────────────────────────────────────────────────────────────

function eventIcon(type: string, payload?: unknown) {
  switch (type) {
    case "run.started":
      return <Play className="h-3 w-3 text-violet-400" />;
    case "strategy.parsed":
      return <Zap className="h-3 w-3 text-blue-400" />;
    case "discovery.started":
    case "discovery.completed":
      return <Search className="h-3 w-3 text-blue-400" />;
    case "ticker.research.started":
      return <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />;
    case "data_gathering.completed":
      return <Database className="h-3 w-3 text-amber-400" />;
    case "thesis.generated": {
      const p = payload as Record<string, unknown> | undefined;
      const dir = String(p?.direction ?? "");
      if (dir === "LONG") return <TrendingUp className="h-3 w-3 text-emerald-500" />;
      if (dir === "SHORT") return <TrendingDown className="h-3 w-3 text-red-500" />;
      return <Minus className="h-3 w-3 text-muted-foreground" />;
    }
    case "trade_plan.generated":
      return <Zap className="h-3 w-3 text-amber-400" />;
    case "trade.executed":
      return <CheckCircle className="h-3 w-3 text-emerald-500" />;
    case "trade.rejected":
      return <Minus className="h-3 w-3 text-muted-foreground" />;
    case "run.completed":
      return <CheckCircle className="h-3 w-3 text-emerald-500" />;
    case "run.error":
      return <AlertCircle className="h-3 w-3 text-red-500" />;
    default:
      return <Minus className="h-3 w-3 text-muted-foreground" />;
  }
}

// ─── Event message bubble ─────────────────────────────────────────────────────

function EventBubble({ event }: { event: RunEventItem }) {
  const payload = event.payload as Record<string, unknown> | undefined;

  const candidates: CandidateInfo[] =
    event.type === "discovery.completed" && Array.isArray(payload?.candidates)
      ? (payload.candidates as CandidateInfo[])
      : [];

  const sources: SourceCategory[] =
    event.type === "data_gathering.completed" && Array.isArray(payload?.sources)
      ? (payload.sources as SourceCategory[])
      : [];

  const isSynthetic = payload?.synthetic === true;

  return (
    <div className="flex gap-2.5 group">
      {/* Bot avatar — small, understated */}
      <div className="shrink-0 w-5 h-5 rounded-full bg-violet-500/10 flex items-center justify-center mt-0.5">
        {eventIcon(event.type, payload)}
      </div>

      <div className="flex-1 min-w-0 pb-1">
        <p className="text-xs text-foreground leading-snug">{event.title}</p>

        {event.message && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            {event.message}
          </p>
        )}

        {/* Candidates chips */}
        {candidates.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {candidates.map((c) => (
              <span
                key={c.ticker}
                className="text-[11px] font-mono font-medium border rounded px-1.5 py-0.5 text-foreground"
              >
                {c.ticker}
                {c.score != null && (
                  <span className="ml-1 text-muted-foreground font-normal">
                    {c.score}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Source chips */}
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {sources
              .filter((s) => s.available)
              .map((s) => (
                <Badge
                  key={s.category}
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 font-normal"
                >
                  {s.category.replace(/_/g, " ")}
                  {s.count != null && s.count > 0 ? ` (${s.count})` : ""}
                </Badge>
              ))}
          </div>
        )}

        {isSynthetic && (
          <p className="text-[10px] text-muted-foreground/40 mt-0.5 italic">
            reconstructed
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Chat message bubble ──────────────────────────────────────────────────────

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 py-2">
        <p className="text-sm leading-relaxed">{content}</p>
      </div>
    </div>
  );
}

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="flex gap-2.5">
      <div className="shrink-0 w-5 h-5 rounded-full bg-violet-500/10 flex items-center justify-center mt-0.5">
        <Bot className="h-3 w-3 text-violet-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {content}
          {!content && (
            <span className="inline-block w-2 h-3.5 bg-foreground/40 animate-pulse rounded-sm" />
          )}
        </p>
      </div>
    </div>
  );
}

// ─── Separator between run events and chat ────────────────────────────────────

function ChatSeparator() {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider shrink-0">
        Chat
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RunConversation({
  events,
  messages,
  isLive,
  isComplete,
  isSynthetic,
}: {
  events: RunEventItem[];
  messages: RunMessage[];
  isLive: boolean;
  isComplete: boolean;
  isSynthetic?: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll as events or messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length, messages.length]);

  const hasEvents = events.length > 0;
  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      {isSynthetic && (
        <div className="px-4 py-1.5 bg-muted/20 border-b shrink-0">
          <p className="text-[11px] text-muted-foreground/60 italic">
            Timeline reconstructed from results — run predates streaming.
          </p>
        </div>
      )}

      <ScrollArea className="flex-1 px-4">
        <div className="py-4 space-y-3">
          {/* Empty states */}
          {!hasEvents && !isLive && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No events yet.
            </p>
          )}

          {!hasEvents && isLive && !isComplete && (
            <div className="flex items-center gap-2 py-4">
              <div className="w-5 h-5 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
                <Loader2 className="h-3 w-3 text-violet-500 animate-spin" />
              </div>
              <p className="text-xs text-muted-foreground">Starting research…</p>
            </div>
          )}

          {/* Events as conversation messages */}
          {events.map((ev) => (
            <EventBubble key={ev.id} event={ev} />
          ))}

          {/* Live spinner */}
          {isLive && !isComplete && hasEvents && (
            <div className="flex items-center gap-2 py-1">
              <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0">
                <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
              </div>
              <p className="text-xs text-muted-foreground">Processing…</p>
            </div>
          )}

          {/* Chat messages — separated visually */}
          {hasMessages && <ChatSeparator />}

          {messages.map((msg) =>
            msg.role === "user" ? (
              <UserBubble key={msg.id} content={msg.content} />
            ) : (
              <AssistantBubble key={msg.id} content={msg.content} />
            )
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
