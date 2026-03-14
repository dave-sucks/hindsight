"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Bot } from "lucide-react";
import { useAgentActivityLog, type AgentEvent, type AgentEventType } from "@/hooks/useAgentActivityLog";

// ── Icon / color map ──────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<
  AgentEventType,
  { icon: string; className: string }
> = {
  RESEARCH_START: { icon: "🔍", className: "text-blue-400" },
  THESIS_GENERATED: { icon: "💡", className: "text-amber-400" },
  TRADE_PLACED: { icon: "📈", className: "text-blue-500" },
  PRICE_CHECK: { icon: "👁", className: "text-zinc-400" },
  NEAR_TARGET: { icon: "⚡", className: "text-amber-500" },
  TRADE_CLOSED: { icon: "✅", className: "text-positive" },
  EVALUATED: { icon: "🧠", className: "text-purple-400" },
  EOD_CHECK: { icon: "📊", className: "text-zinc-400" },
};

// ── Relative time helper (no external dep) ────────────────────────────────────

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

// ── ActivityLogItem ───────────────────────────────────────────────────────────

function ActivityLogItem({ event }: { event: AgentEvent }) {
  const config = EVENT_CONFIG[event.type] ?? EVENT_CONFIG.PRICE_CHECK;
  const isClosedLoss =
    event.type === "TRADE_CLOSED" && (event.pnlPct ?? 0) < 0;

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/50 last:border-0 animate-in slide-in-from-top-1 duration-200">
      <span className="text-base mt-0.5 shrink-0" aria-hidden="true">
        {isClosedLoss ? "❌" : config.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {event.ticker && (
            <span className="text-xs font-semibold text-foreground">
              {event.ticker}
            </span>
          )}
          {event.pnlPct != null && (
            <span
              className={cn(
                "text-xs font-medium tabular-nums",
                event.pnlPct >= 0 ? "text-positive" : "text-negative"
              )}
            >
              {event.pnlPct >= 0 ? "+" : ""}
              {event.pnlPct.toFixed(1)}%
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{event.detail}</p>
      </div>
      <time className="text-[10px] text-muted-foreground/60 shrink-0 mt-0.5 tabular-nums">
        {formatRelativeTime(event.timestamp)}
      </time>
    </div>
  );
}

// ── AgentActivityLog ──────────────────────────────────────────────────────────

interface AgentActivityLogProps {
  userId: string;
}

export function AgentActivityLog({ userId }: AgentActivityLogProps) {
  const { events, isConnected } = useAgentActivityLog(userId);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Agent Activity
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                isConnected
                  ? "bg-positive animate-pulse"
                  : "bg-muted-foreground/40"
              )}
            />
            <span className="text-[10px] text-muted-foreground">
              {isConnected ? "Live" : "Connecting…"}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-0 px-4 pb-4">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 py-8">
            <Bot className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground text-center">
              Agent is idle
            </p>
            <p className="text-[10px] text-muted-foreground/60 text-center">
              Activity will appear here when the agent runs research
            </p>
          </div>
        ) : (
          <div>
            {events.map((event) => (
              <ActivityLogItem key={event.id} event={event} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
