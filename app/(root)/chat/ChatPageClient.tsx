"use client";

/**
 * Principal Chat — operator-perspective chat surface.
 *
 * Free-floating scope: the agent reads which analyst / ticker / thesis
 * the user means from the message, not from a fixed page context.
 * Reuses AgentChat with mode="principal"; the route at
 * /api/agent/principal handles principal-mode plumbing (synthetic
 * ResearchRun, no per-analyst config loading, wide tool allowlist).
 */

import { Thread } from "@/components/assistant-ui/thread";
import { HindsightComposer } from "@/components/assistant-ui/hindsight-composer";
import { ChatRuntime } from "@/components/chat/chat-runtime";
import { MessageCircle } from "lucide-react";

interface Props {
  runId?: string;
}

export function ChatPageClient({ runId }: Props) {
  const body: Record<string, unknown> = {};
  if (runId) body.runId = runId;

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <ChatRuntime api="/api/agent/principal" body={body}>
        <Thread
          welcomeConfig={{
            title: "Hindsight",
            subtitle:
              "Ask anything — review analysts, runs, monitors, theses; research stocks; place or adjust trades.",
            icon: (
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageCircle className="size-5" />
              </div>
            ),
          }}
          composerSlot={
            <HindsightComposer
              features={{
                tickerSearch: true,
                slashCommands: true,
                placeholder:
                  "Ask about your portfolio, an analyst, a ticker, or a thesis…",
              }}
            />
          }
        />
      </ChatRuntime>
    </div>
  );
}
