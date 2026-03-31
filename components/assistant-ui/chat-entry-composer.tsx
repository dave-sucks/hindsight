"use client";

import { useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { DefaultChatTransport } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider, useThreadRuntime } from "@assistant-ui/react";
import { HindsightComposer, type HindsightComposerFeatures } from "./hindsight-composer";
import { FirstVisitTooltip } from "@/components/ui/first-visit-tooltip";

// ── Props ────────────────────────────────────────────────────────────────────

interface ChatEntryComposerProps {
  /** Target URL to navigate to. Prompt appended as ?prompt=<encoded> */
  targetUrl: string;
  /** Features to pass to HindsightComposer */
  features?: HindsightComposerFeatures;
  /** First-visit tooltip config */
  tooltip?: {
    content: string;
    storageKey: string;
  };
  className?: string;
}

// ── Inner: watches for user messages and navigates ───────────────────────────

function EntryComposerInner({
  targetUrl,
  features,
}: {
  targetUrl: string;
  features?: HindsightComposerFeatures;
}) {
  const router = useRouter();
  const threadRuntime = useThreadRuntime();
  const navigated = useRef(false);

  useEffect(() => {
    return threadRuntime.subscribe(() => {
      if (navigated.current) return;
      const messages = threadRuntime.getState().messages;
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser) return;

      const text = lastUser.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ")
        .trim();

      if (text) {
        navigated.current = true;
        router.push(`${targetUrl}?prompt=${encodeURIComponent(text)}`);
      }
    });
  }, [threadRuntime, targetUrl, router]);

  return <HindsightComposer features={features} />;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ChatEntryComposer({
  targetUrl,
  features,
  tooltip,
  className,
}: ChatEntryComposerProps) {
  // Lightweight runtime with a no-op transport — we navigate before it fires
  const runtime = useChatRuntime({
    transport: useMemo(
      () => new DefaultChatTransport({ api: "/api/noop" }),
      [],
    ),
  });

  const composer = (
    <div className={className}>
      <AssistantRuntimeProvider runtime={runtime}>
        <EntryComposerInner targetUrl={targetUrl} features={features} />
      </AssistantRuntimeProvider>
    </div>
  );

  if (tooltip) {
    return (
      <FirstVisitTooltip content={tooltip.content} storageKey={tooltip.storageKey}>
        {composer}
      </FirstVisitTooltip>
    );
  }

  return composer;
}
