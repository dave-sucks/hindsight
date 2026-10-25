"use client";

import { useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuiState } from "@assistant-ui/react";
import { HindsightComposer, type HindsightComposerFeatures } from "./hindsight-composer";
import { ChatRuntime } from "@/components/chat/chat-runtime";

// ── Props ────────────────────────────────────────────────────────────────────

interface ChatEntryComposerProps {
  /** Target URL to navigate to. Prompt appended as ?<queryParam>=<encoded> */
  targetUrl: string;
  /** Query param name used when navigating. Defaults to "prompt". */
  queryParam?: string;
  /** Features to pass to HindsightComposer */
  features?: HindsightComposerFeatures;
  className?: string;
}

// ── Inner: watches for user messages and navigates ───────────────────────────

function EntryComposerInner({
  targetUrl,
  queryParam = "prompt",
  features,
}: {
  targetUrl: string;
  queryParam?: string;
  features?: HindsightComposerFeatures;
}) {
  const router = useRouter();
  const navigated = useRef(false);
  const messages = useAuiState((s) => s.thread.messages);

  useEffect(() => {
    if (navigated.current) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;

    const text = (lastUser.content as Array<{ type: string; text?: string }>)
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join(" ")
      .trim();

    if (text) {
      navigated.current = true;
      router.push(`${targetUrl}?${queryParam}=${encodeURIComponent(text)}`);
    }
  }, [messages, targetUrl, queryParam, router]);

  return <HindsightComposer features={features} />;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ChatEntryComposer({
  targetUrl,
  queryParam = "prompt",
  features,
  className,
}: ChatEntryComposerProps) {
  // Lightweight runtime with a no-op transport — we navigate before it fires
  return (
    <div className={className}>
      <ChatRuntime api="/api/noop">
        <EntryComposerInner targetUrl={targetUrl} queryParam={queryParam} features={features} />
      </ChatRuntime>
    </div>
  );
}
