"use client";

/**
 * AgentChat — unified chat component for all three surfaces:
 *   - research-run: live agent run + follow-up conversation
 *   - builder: analyst creation chat
 *   - editor: analyst editing chat
 *
 * Replaces AgentThread (runs), AnalystBuilderChat, and AnalystEditorChat.
 * Uses the unified /api/agent/[mode] route.
 *
 * API and body are captured at mount time via refs (see ChatRuntime).
 * The conversation is a single continuous thread — no mode switching.
 */

import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import type { AgentMode } from "@/lib/agent/modes";
import { ChatRuntime } from "@/components/chat/chat-runtime";
import { Thread } from "@/components/assistant-ui/thread";

// ── Props ─────────────────────────────────────────────────────────────────────

interface AgentChatProps {
  mode: AgentMode;

  // research-run
  runId?: string;
  analystId?: string;

  // builder / editor
  currentConfig?: Record<string, unknown>;

  /** Pre-loaded messages for replay (historical runs) */
  messages?: UIMessage[];

  /** Thread composer slot (e.g. QuickReplies) */
  composerSlot?: ReactNode;

  /** Auto-send initial message (e.g. "Start analysis") */
  initialPrompt?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentChat({
  mode,
  runId,
  analystId,
  currentConfig,
  messages,
  composerSlot,
}: AgentChatProps) {
  const api = `/api/agent/${mode}`;

  // Body is sent with every message to give the route its context
  const body: Record<string, unknown> = {};
  if (runId) body.runId = runId;
  if (analystId) body.analystId = analystId;
  if (currentConfig) body.currentConfig = currentConfig;

  return (
    <ChatRuntime api={api} body={body} messages={messages}>
      <AgentChatInner composerSlot={composerSlot} />
    </ChatRuntime>
  );
}

// ── Inner component ───────────────────────────────────────────────────────────

interface InnerProps {
  composerSlot?: ReactNode;
}

function AgentChatInner({ composerSlot }: InnerProps) {
  return (
    <Thread
      composerSlot={composerSlot}
      richComposer
    />
  );
}
