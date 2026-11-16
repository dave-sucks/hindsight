"use client";

import { useEffect, useRef } from "react";
import { useAuiState } from "@assistant-ui/react";
import type { CallView } from "@/lib/agent/run-requests";
import { contextDue, type TurnState } from "@/lib/chat/live-requests";

/**
 * Keeps a chat's Context current: reads what the chat sent the model each time a reply begins and each time
 * a turn ends (lib/chat/live-requests.ts), by the run id when the chat has one and else by its session id.
 */
export function useLiveRequests({
  enabled,
  runId,
  chatSessionId,
  onLoaded,
}: {
  enabled: boolean;
  runId?: string;
  chatSessionId: string | null;
  onLoaded: (calls: CallView[]) => void;
}) {
  const running = useAuiState((s) => s.thread.isRunning);
  const replying = useAuiState((s) => s.thread.messages.at(-1)?.role === "assistant");
  const prev = useRef<TurnState>({ running: false, replying: false });
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  useEffect(() => {
    const before = prev.current;
    prev.current = { running, replying };
    if (!enabled || !contextDue(before, { running, replying })) return;
    const query = runId ? `runId=${encodeURIComponent(runId)}` : chatSessionId ? `session=${encodeURIComponent(chatSessionId)}` : null;
    if (!query) return;
    fetch(`/api/chat/requests?${query}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { requests?: CallView[] } | null) => {
        if (data?.requests) onLoadedRef.current(data.requests);
      })
      .catch(() => {
        // The panel keeps what it had; the next turn reads again.
      });
  }, [enabled, running, replying, runId, chatSessionId]);
}
