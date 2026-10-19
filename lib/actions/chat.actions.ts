/**
 * Chat actions — server-only data fetchers for Principal Chat history.
 *
 * Powers the Recent Chats sidebar on /chat. Returns the user's past
 * PRINCIPAL_CHAT ResearchRuns, most recent activity first, with enough
 * metadata to render rows + reopen on click.
 *
 * PRINCIPAL_CHAT rows are intentionally excluded from /runs (see
 * app/(root)/runs/page.tsx) because they're chat-session containers,
 * not analytical runs. This action is their dedicated read path.
 */

import "server-only";
import { prisma } from "@/lib/prisma";

export interface ChatHistoryItem {
  runId: string;
  /** The analyst the chat was scoped to; null for a portfolio-level chat. */
  analystName: string | null;
  startedAt: Date;
  /** When the chat last had message activity. Null falls back to startedAt. */
  lastActivityAt: Date;
  /** Whether a persisted thread row exists (one `role: "thread"` row per run). */
  hasThread: boolean;
  /**
   * First user message in the thread, truncated for sidebar display.
   * Null when the thread is empty / unparseable / has no user message yet.
   */
  preview: string | null;
}

interface ListRecentChatsArgs {
  userId: string;
  /** Max chats to return total. Default 30. */
  limit?: number;
  /** Account scope. Required for multi-tenant safety. */
  accountId: string;
}

/**
 * Fetch the user's recent Principal Chat sessions, most recent activity
 * first, scoped and unscoped alike.
 */
export async function listRecentChats(
  args: ListRecentChatsArgs,
): Promise<ChatHistoryItem[]> {
  const rows = await prisma.researchRun.findMany({
    where: {
      userId: args.userId,
      accountId: args.accountId,
      mode: "PRINCIPAL_CHAT",
    },
    select: {
      id: true,
      startedAt: true,
      updatedAt: true,
      agentConfig: { select: { name: true } },
      messages: {
        // At most one thread row per run; pull its content for the preview.
        where: { role: "thread" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: args.limit ?? 30,
  });

  return rows.map((row) => {
    const threadContent = row.messages[0]?.content ?? null;
    return {
      runId: row.id,
      analystName: row.agentConfig?.name ?? null,
      startedAt: row.startedAt,
      lastActivityAt: row.updatedAt ?? row.startedAt,
      hasThread: threadContent != null,
      preview: threadContent ? extractFirstUserMessage(threadContent) : null,
    };
  });
}

/**
 * Fetch the full persisted thread for a single Principal Chat session,
 * for resume. Returns the raw JSON string from RunMessage (same shape
 * /runs/[id] reads); caller passes it through convertPersistedToUIMessages.
 *
 * Returns null when:
 *   - The run doesn't exist
 *   - It's not owned by this user (multi-tenant guard)
 *   - It isn't PRINCIPAL_CHAT mode (this is the chat resume path only)
 *   - No persisted thread exists yet
 *
 * The chat surface persists threads via the same `role: "thread"` row
 * pattern as research-run completion. For a still-RUNNING chat that
 * hasn't been ended cleanly, there may be no thread row yet — caller
 * should fall back to "start fresh on this analyst".
 */
export async function loadChatThread(
  runId: string,
  userId: string,
): Promise<{
  runId: string;
  analystId: string | null;
  analystName: string | null;
  threadJson: string;
  /** When the thread was last written — the end of the chat's latest turn. */
  savedAt: Date;
} | null> {
  const run = await prisma.researchRun.findFirst({
    where: {
      id: runId,
      userId,
      mode: "PRINCIPAL_CHAT",
    },
    select: {
      id: true,
      agentConfigId: true,
      agentConfig: { select: { id: true, name: true } },
      messages: {
        where: { role: "thread" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, createdAt: true },
      },
    },
  });

  if (!run) return null;
  const threadRow = run.messages[0];
  if (!threadRow) return null;

  return {
    runId: run.id,
    analystId: run.agentConfig?.id ?? null,
    analystName: run.agentConfig?.name ?? null,
    threadJson: threadRow.content,
    savedAt: threadRow.createdAt,
  };
}

/**
 * The chat a browser session is writing to. A fresh chat never learns its
 * runId — the route finds the run by the client-minted chatSessionId it was
 * created with (see app/api/agent/[mode]/route.ts) — so this is how the page
 * finds its own saved thread after a dropped connection.
 */
export async function findChatRunIdBySession(
  chatSessionId: string,
  userId: string,
): Promise<string | null> {
  const run = await prisma.researchRun.findFirst({
    where: {
      userId,
      mode: "PRINCIPAL_CHAT",
      parameters: { path: ["chatSessionId"], equals: chatSessionId },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return run?.id ?? null;
}

/**
 * Pull the first user message text out of a persisted thread JSON blob.
 *
 * The thread is stored as one big stringified array of either UIMessage or
 * ModelMessage shapes (see app/api/agent/[mode]/route.ts where it's written).
 * Both shapes have `role: "user"` on the message; the text content lives in
 * different places:
 *
 *   - UIMessage: `parts: [{ type: "text", text: "..." }, ...]`
 *   - ModelMessage with string content: `content: "..."`
 *   - ModelMessage with array content: `content: [{ type: "text", text: "..." }, ...]`
 *
 * Returns the first 100 characters with an ellipsis when truncated.
 * Returns null on parse failure or when no user message is present —
 * the sidebar falls back to the timestamp in that case.
 */
function extractFirstUserMessage(threadJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(threadJson);
    if (!Array.isArray(parsed)) return null;

    for (const msg of parsed) {
      if (!isObj(msg) || msg.role !== "user") continue;

      // UIMessage: parts array with text entries
      if (Array.isArray(msg.parts)) {
        for (const part of msg.parts) {
          if (isObj(part) && part.type === "text" && typeof part.text === "string") {
            return clean(part.text);
          }
        }
      }

      // ModelMessage: content is string or array of text chunks
      if (typeof msg.content === "string") {
        return clean(msg.content);
      }
      if (Array.isArray(msg.content)) {
        for (const chunk of msg.content) {
          if (isObj(chunk) && chunk.type === "text" && typeof chunk.text === "string") {
            return clean(chunk.text);
          }
        }
      }
    }
  } catch {
    // Malformed JSON — sidebar will render the timestamp fallback.
  }
  return null;
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function clean(s: string): string | null {
  const stripped = s.replace(/\s+/g, " ").trim();
  if (!stripped) return null;
  const MAX = 100;
  return stripped.length > MAX ? stripped.slice(0, MAX - 1).trimEnd() + "…" : stripped;
}
