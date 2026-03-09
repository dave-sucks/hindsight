"use client";

import { useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export type RealtimeTrade = {
  id: string;
  status: string;
  ticker: string;
  direction: string;
  realizedPnl: number | null;
  closeReason: string | null;
  outcome: string | null;
};

export type RealtimeTradeEvent = {
  id: string;
  tradeId: string;
  eventType: string;
  description: string;
  priceAt: number | null;
  pnlAt: number | null;
  createdAt: string;
};

interface UseTradeRealtimeOptions {
  userId: string;
  /** Called when a trade row is updated (status change, P&L update, close) */
  onTradeUpdate?: (trade: RealtimeTrade) => void;
  /** Called when a new TradeEvent is inserted (price check, near target, closed) */
  onTradeEvent?: (event: RealtimeTradeEvent) => void;
}

/**
 * DAV-37: Supabase Realtime subscription for Trade and TradeEvent tables.
 *
 * ⚠️ PREREQUISITE: Run this in Supabase Dashboard → SQL Editor before this works:
 *   ALTER TABLE "Trade" REPLICA IDENTITY FULL;
 *   ALTER TABLE "TradeEvent" REPLICA IDENTITY FULL;
 *   Then add both tables to the realtime publication in
 *   Dashboard → Database → Replication → supabase_realtime → Tables.
 */
export function useTradeRealtime({
  userId,
  onTradeUpdate,
  onTradeEvent,
}: UseTradeRealtimeOptions) {
  const supabase = createClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const handleTradeUpdate = useCallback(
    (payload: { new: Record<string, unknown> }) => {
      const row = payload.new;
      onTradeUpdate?.({
        id: row.id as string,
        status: row.status as string,
        ticker: row.ticker as string,
        direction: row.direction as string,
        realizedPnl: row.realizedPnl as number | null,
        closeReason: row.closeReason as string | null,
        outcome: row.outcome as string | null,
      });
    },
    [onTradeUpdate]
  );

  const handleTradeEvent = useCallback(
    (payload: { new: Record<string, unknown> }) => {
      const row = payload.new;
      onTradeEvent?.({
        id: row.id as string,
        tradeId: row.tradeId as string,
        eventType: row.eventType as string,
        description: row.description as string,
        priceAt: row.priceAt as number | null,
        pnlAt: row.pnlAt as number | null,
        createdAt: row.createdAt as string,
      });
    },
    [onTradeEvent]
  );

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`trades-realtime:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "Trade",
          filter: `userId=eq.${userId}`,
        },
        handleTradeUpdate
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "TradeEvent",
        },
        handleTradeEvent
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId, supabase, handleTradeUpdate, handleTradeEvent]);
}
