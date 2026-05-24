"use client";

/**
 * Principal Chat — operator co-pilot.
 *
 * Page defaults to UNSCOPED. To pin a scope, the user opens the
 * composer's Settings2 dropdown and picks an analyst from the Scope
 * submenu. A muted badge with an X then appears at the top of the
 * input; clicking the X unscopes.
 *
 * Recent Chats sidebar (added 2026-05-23): a left-side Sheet listing
 * past PRINCIPAL_CHAT runs grouped by analyst. Clicking a chat navigates
 * to /chat?resume=<runId>, which the server component hydrates with
 * the persisted thread + runId + analystId — all passed in via the
 * `resumed*` props. When those props are set, AgentChat opens with
 * the full history and subsequent turns POST with the resumed runId
 * so the route continues writing to the same chat.
 */

import { useCallback, useMemo, useState } from "react";
import type { UIMessage } from "ai";
import { AgentChat } from "@/components/agent/AgentChat";
import {
  RecentChatsSidebar,
  RecentChatsTrigger,
} from "@/components/chat/recent-chats-sidebar";
import type { ChatHistoryGroup } from "@/lib/actions/chat.actions";

interface Props {
  analysts: Array<{ id: string; name: string; enabled: boolean }>;
  recentChats: ChatHistoryGroup[];
  /** Server-loaded message history when ?resume=<runId> is present. */
  resumedMessages?: UIMessage[];
  /** The resumed ResearchRun id — threaded into AgentChat's body so the
   *  route continues writing the same chat instead of minting a new one. */
  resumedRunId?: string | null;
  /** Analyst the resumed chat was scoped to — sets the initial scope. */
  resumedAnalystId?: string | null;
}

export function ChatPageClient({
  analysts,
  recentChats,
  resumedMessages,
  resumedRunId,
  resumedAnalystId,
}: Props) {
  // When resuming, the scope is pre-set to the chat's analyst. Otherwise
  // we default to UNSCOPED every page load — same as before.
  const [scopedAnalystId, setScopedAnalystId] = useState<string | null>(
    resumedAnalystId ?? null,
  );
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const handleChange = useCallback((analystId: string | null) => {
    setScopedAnalystId(analystId);
  }, []);

  const principalScope = useMemo(
    () => ({
      current: scopedAnalystId
        ? (() => {
            const a = analysts.find((x) => x.id === scopedAnalystId);
            return a ? { id: a.id, name: a.name } : null;
          })()
        : null,
      options: analysts,
      onChange: handleChange,
    }),
    [scopedAnalystId, analysts, handleChange],
  );

  return (
    <div className="relative flex h-[calc(100dvh-3rem)] flex-col">
      {/* Trigger button — floats top-left so it's reachable without
          stealing chat real-estate. Opens the Recent Chats Sheet. */}
      <div className="absolute left-4 top-4 z-10">
        <RecentChatsTrigger
          onClick={() => setIsHistoryOpen(true)}
          count={recentChats.reduce((n, g) => n + g.chats.length, 0)}
        />
      </div>

      <AgentChat
        mode="principal"
        analystId={scopedAnalystId ?? undefined}
        principalScope={principalScope}
        // Resume support: when these are set, AgentChat hydrates the
        // thread and threads the runId through to every POST so the
        // route continues writing to the same chat.
        messages={resumedMessages}
        runId={resumedRunId ?? undefined}
      />

      <RecentChatsSidebar
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        groups={recentChats}
        // Highlight the chat we're currently resuming so the user has
        // a visual anchor when they reopen the sidebar.
        currentRunId={resumedRunId ?? null}
      />
    </div>
  );
}
