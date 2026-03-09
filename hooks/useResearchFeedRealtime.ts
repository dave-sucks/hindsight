"use client";

import { useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

export type RealtimeThesis = {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
  reasoningSummary: string;
  holdDuration: string;
  signalTypes: string[];
  sector: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  createdAt: string;
};

interface UseResearchFeedRealtimeOptions {
  userId: string;
  /** Called when a new Thesis is inserted (agent generates a thesis) */
  onNewThesis?: (thesis: RealtimeThesis) => void;
}

/**
 * DAV-37: Supabase Realtime subscription for Thesis table.
 * New agent-generated theses push into the research feed in real time.
 *
 * ⚠️ PREREQUISITE:
 *   ALTER TABLE "Thesis" REPLICA IDENTITY FULL;
 *   ALTER TABLE "ResearchRun" REPLICA IDENTITY FULL;
 *   Add both to the realtime publication in Supabase Dashboard.
 */
export function useResearchFeedRealtime({
  userId,
  onNewThesis,
}: UseResearchFeedRealtimeOptions) {
  const supabase = createClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const handleNewThesis = useCallback(
    (payload: { new: Record<string, unknown> }) => {
      const row = payload.new;
      if (row.userId !== userId) return; // Guard: only our user's theses
      onNewThesis?.({
        id: row.id as string,
        ticker: row.ticker as string,
        direction: row.direction as string,
        confidenceScore: row.confidenceScore as number,
        reasoningSummary: row.reasoningSummary as string,
        holdDuration: row.holdDuration as string,
        signalTypes: (row.signalTypes as string[]) ?? [],
        sector: row.sector as string | null,
        entryPrice: row.entryPrice as number | null,
        targetPrice: row.targetPrice as number | null,
        stopLoss: row.stopLoss as number | null,
        createdAt: row.createdAt as string,
      });
    },
    [userId, onNewThesis]
  );

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`research-feed-realtime:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "Thesis",
        },
        handleNewThesis
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId, supabase, handleNewThesis]);
}
