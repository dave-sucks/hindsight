"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RunUnifiedChat } from "@/components/research/RunUnifiedChat";
import type { RunEventRow } from "@/components/research/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _uid = 0;
function nextId() {
  return `live-${_uid++}`;
}

function payloadToRow(payload: Record<string, unknown>): RunEventRow {
  return {
    id: nextId(),
    type: (payload.type as string) ?? "unknown",
    title: "",
    message: (payload.message as string | null | undefined) ?? null,
    payload,
    createdAt: new Date().toISOString(),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RunLiveStream({
  runId,
  userId,
  analystName = "Agent",
  config = {},
}: {
  runId: string;
  userId: string;
  analystName?: string;
  config?: Record<string, unknown>;
}) {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);
  const [events, setEvents] = useState<RunEventRow[]>([]);
  const [streamDone, setStreamDone] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const res = await fetch(`/api/research/events?runId=${runId}`, {
          signal: controller.signal,
        });
        if (!res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
            } catch {
              continue;
            }
            setEvents((prev) => [...prev, payloadToRow(payload)]);
            if (payload.type === "run_complete" || payload.type === "error") {
              setStreamDone(true);
              router.refresh();
            }
          }
        }

        setStreamDone(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStreamDone(true);
        }
      }
    })();

    return () => controller.abort();
  }, [runId, router]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <div className="animate-pulse rounded-full h-3 w-3 bg-amber-500" />
        <p className="text-sm">Connecting to live research stream...</p>
      </div>
    );
  }

  // Build minimal runContext from available data
  const runContext = {
    analystName,
    config,
    theses: [] as Array<{
      ticker: string;
      direction: string;
      confidence_score: number;
    }>,
  };

  return (
    <RunUnifiedChat
      events={events}
      analystName={analystName}
      config={config}
      runContext={runContext}
      isLive={!streamDone}
    />
  );
}
