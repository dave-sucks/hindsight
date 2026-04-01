"use client";

/**
 * ChatRuntime — the single source of truth for chat transport setup.
 *
 * Every chat surface in this app (analyst builder, editor, agent runs,
 * entry composers) renders this instead of constructing their own
 * DefaultChatTransport + useChatRuntime + AssistantRuntimeProvider.
 *
 * api and body are treated as mount-time values (captured via ref).
 * The transport is created once and never recreated — this matches the
 * intended lifecycle: a chat session is tied to the page it was opened on.
 */

import { useRef, useMemo, type ReactNode } from "react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";

export interface ChatRuntimeProps {
  /** API route this chat posts to */
  api: string;
  /** Extra context sent with every message (runId, analystId, config, etc.) */
  body?: Record<string, unknown>;
  /** Pre-loaded messages for replay — pass for completed runs */
  messages?: UIMessage[];
  children: ReactNode;
}

export function ChatRuntime({ api, body, messages, children }: ChatRuntimeProps) {
  // Capture at mount — transport is never recreated mid-session
  const apiRef = useRef(api);
  const bodyRef = useRef(body);
  const messagesRef = useRef(messages);

  const runtime = useChatRuntime({
    transport: useMemo(
      () => new DefaultChatTransport({ api: apiRef.current, body: bodyRef.current }),
      [],
    ),
    ...(messagesRef.current?.length ? { messages: messagesRef.current } : {}),
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
