"use client";

import { useEffect, useRef } from "react";
import type { UIMessage } from "ai";
import { useAuiState } from "@assistant-ui/react";
import { toast } from "sonner";
import { isDroppedConnection, isSavedAfterSend } from "@/lib/chat/saved-answer";

const POLL_MS = 3_000;
/** The agent route's maxDuration — no turn can still be writing after this. */
const MAX_TURN_MS = 800_000;

/**
 * When the browser loses the connection mid-answer, the server keeps going
 * and saves the finished thread. This waits for that save and hands the saved
 * messages to `onRecovered`, which reloads the chat with them — instead of
 * leaving a red "network error" where the answer should be.
 *
 * Only runs while the last message shows a lost-connection error; sending a
 * new message or retrying clears the error and stops the wait.
 */
export function useSavedAnswerRecovery({
  enabled,
  runId,
  chatSessionId,
  onRecovered,
}: {
  enabled: boolean;
  runId?: string;
  chatSessionId: string | null;
  onRecovered: (messages: UIMessage[]) => void;
}) {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const lastStatus = useAuiState((s) => s.thread.messages.at(-1)?.status);
  const dropped =
    enabled &&
    lastStatus?.type === "incomplete" &&
    lastStatus.reason === "error" &&
    isDroppedConnection(lastStatus.error);

  // When the cut-off question went out, on the browser's clock.
  const sentAtRef = useRef(0);
  useEffect(() => {
    if (isRunning) sentAtRef.current = Date.now();
  }, [isRunning]);

  const onRecoveredRef = useRef(onRecovered);
  onRecoveredRef.current = onRecovered;

  useEffect(() => {
    const sentAt = sentAtRef.current;
    if (!dropped || sentAt === 0 || (!runId && !chatSessionId)) return;

    let stopped = false;
    const toastId = toast.loading(
      "Connection dropped. The answer is still being written — it will load here when it's saved.",
    );
    const query = runId
      ? `runId=${encodeURIComponent(runId)}`
      : `session=${encodeURIComponent(chatSessionId ?? "")}`;

    (async () => {
      while (!stopped && Date.now() < sentAt + MAX_TURN_MS) {
        try {
          const res = await fetch(`/api/chat/thread?${query}`, { cache: "no-store" });
          if (res.ok) {
            const data: { savedAt: number | null; now: number; messages: UIMessage[] } =
              await res.json();
            const saved = isSavedAfterSend({
              savedAt: data.savedAt,
              sentAt,
              serverNow: data.now,
              clientNow: Date.now(),
            });
            if (saved && data.messages.at(-1)?.role === "assistant") {
              if (stopped) return;
              stopped = true;
              toast.success("Loaded the saved answer.", { id: toastId });
              onRecoveredRef.current(data.messages);
              return;
            }
          }
        } catch {
          // Still offline — try again.
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      if (!stopped) {
        stopped = true;
        toast.error("The answer didn't finish. Ask again.", { id: toastId });
      }
    })();

    return () => {
      if (stopped) return;
      stopped = true;
      toast.dismiss(toastId);
    };
  }, [dropped, runId, chatSessionId]);
}
