"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export type AgentEventType =
  | "RESEARCH_START"
  | "THESIS_GENERATED"
  | "TRADE_PLACED"
  | "PRICE_CHECK"
  | "NEAR_TARGET"
  | "TRADE_CLOSED"
  | "EVALUATED"
  | "EOD_CHECK";

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  ticker?: string;
  detail: string;
  timestamp: Date;
  pnlPct?: number;
  direction?: "LONG" | "SHORT";
}

// Map Prisma eventType → AgentEventType
function mapEventType(et: string): AgentEventType {
  switch (et) {
    case "PLACED": return "TRADE_PLACED";
    case "PRICE_CHECK": return "PRICE_CHECK";
    case "NEAR_TARGET": return "NEAR_TARGET";
    case "CLOSED": return "TRADE_CLOSED";
    case "EVALUATED": return "EVALUATED";
    default: return "PRICE_CHECK";
  }
}

// Build human-readable detail from a TradeEvent row
function tradeEventToAgentEvent(row: Record<string, unknown>): AgentEvent {
  return {
    id: row.id as string,
    type: mapEventType(row.eventType as string),
    ticker: row.ticker as string | undefined,
    detail: row.description as string,
    timestamp: new Date(row.createdAt as string),
    pnlPct: row.pnlAt != null ? (row.pnlAt as number) : undefined,
  };
}

function thesisToAgentEvent(row: Record<string, unknown>): AgentEvent {
  return {
    id: `thesis-${row.id}`,
    type: "THESIS_GENERATED",
    ticker: row.ticker as string,
    detail: `${row.direction} thesis generated — ${row.confidenceScore}% confidence`,
    timestamp: new Date(row.createdAt as string),
    direction: row.direction as "LONG" | "SHORT" | undefined,
  };
}

function researchRunToAgentEvent(row: Record<string, unknown>): AgentEvent {
  return {
    id: `run-${row.id}`,
    type: "RESEARCH_START",
    ticker: row.ticker as string | undefined,
    detail: `Agent started research run${row.ticker ? ` for ${row.ticker}` : ""}`,
    timestamp: new Date(row.createdAt as string),
  };
}

function mergeAndSort(events: AgentEvent[]): AgentEvent[] {
  return [...events].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

/**
 * DAV-41: Loads recent agent activity from DB on mount, then subscribes to
 * Supabase Realtime for live updates. Returns events sorted newest-first.
 */
export function useAgentActivityLog(userId: string) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const supabase = createClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Load initial events via API route (avoids importing Prisma on client)
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/agent-activity?userId=${userId}`)
      .then((r) => r.json())
      .then((data: { events: AgentEvent[] }) => {
        setEvents(mergeAndSort(data.events ?? []));
      })
      .catch(() => {/* silently fail — realtime will populate */});
  }, [userId]);

  const addEvent = useCallback((event: AgentEvent) => {
    setEvents((prev) => mergeAndSort([event, ...prev]).slice(0, 100));
  }, []);

  // Subscribe to real-time inserts
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`agent-activity:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "TradeEvent" },
        (payload) => addEvent(tradeEventToAgentEvent(payload.new as Record<string, unknown>))
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "Thesis" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.userId === userId) addEvent(thesisToAgentEvent(row));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ResearchRun" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.userId === userId) addEvent(researchRunToAgentEvent(row));
        }
      )
      .subscribe((status) => {
        setIsConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [userId, supabase, addEvent]);

  return { events, isConnected };
}
