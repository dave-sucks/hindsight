/**
 * Chat actions — server-only data fetchers for Principal Chat history.
 *
 * Powers the Recent Chats sidebar on /chat. Returns the user's past
 * PRINCIPAL_CHAT ResearchRuns grouped by analyst, most recent activity
 * first, with enough metadata to render rows + reopen on click.
 *
 * PRINCIPAL_CHAT rows are intentionally excluded from /runs (see
 * app/(root)/runs/page.tsx) because they're chat-session containers,
 * not analytical runs. This action is their dedicated read path.
 */

import "server-only";
import { prisma } from "@/lib/prisma";

/** Group of past chats with one analyst — sorted most-recent-first. */
export interface ChatHistoryGroup {
  analyst: {
    id: string;
    name: string;
  };
  chats: ChatHistoryItem[];
  /** Most-recent activity across this group's chats (epoch ms). Drives group ordering. */
  lastActivityMs: number;
}

/**
 * Group key for portfolio-level chats that were never scoped to an analyst.
 * Deliberately not a cuid so it can never collide with a real AgentConfig id.
 */
export const UNSCOPED_GROUP_ID = "__unscoped__";

export interface ChatHistoryItem {
  runId: string;
  analystId: string;
  analystName: string;
  startedAt: Date;
  /** When the chat last had message activity. Null falls back to startedAt. */
  lastActivityAt: Date;
  /** ResearchRun.status — RUNNING for active sessions, FAILED for swept stale, COMPLETE rare. */
  status: string;
  /**
   * Rough turn count — number of RunMessage rows on this run. We persist
   * full threads as a single `role: "thread"` row per run (same shape as
   * /runs/[id] replay), so this is usually 0 or 1. A future enhancement
   * could parse the thread JSON to count actual turns, but 1 row = "has
   * a thread" is enough signal for the sidebar.
   */
  hasThread: boolean;
  /**
   * First user message in the thread, truncated for sidebar display.
   * Lets the sidebar show "What's your read on TSM?" instead of bare
   * timestamps. Null when the thread is empty / unparseable / has no user
   * message yet (RUNNING chat that crashed before any user input).
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
 * Fetch the user's recent Principal Chat sessions, grouped by analyst.
 * Within each group, chats are most-recent-first. Groups themselves
 * are ordered by most-recent activity across all their chats.
 *
 * Excludes unscoped chats (agentConfigId IS NULL) for now — they don't
 * group meaningfully and the chat UI doesn't currently support resuming
 * an unscoped session via URL params. Add a synthetic "Unscoped" group
 * later if needed.
 */
export async function listRecentChats(
  args: ListRecentChatsArgs,
): Promise<ChatHistoryGroup[]> {
  const limit = args.limit ?? 30;

  const rows = await prisma.researchRun.findMany({
    where: {
      userId: args.userId,
      accountId: args.accountId,
      mode: "PRINCIPAL_CHAT",
      // Unscoped chats are INCLUDED. They used to be filtered out here as
      // "can't be resumed" — but loadChatThread has always handled a null
      // analystId, and they're now persisted (see the unscoped branch in
      // app/api/agent/[mode]/route.ts). They group under Portfolio below.
    },
    select: {
      id: true,
      agentConfigId: true,
      startedAt: true,
      updatedAt: true,
      status: true,
      agentConfig: {
        select: { id: true, name: true },
      },
      messages: {
        // Pull just the thread row's content for first-message extraction.
        // There's at most one per run; skip the role filter from breaking the
        // limit by selecting + taking explicitly.
        where: { role: "thread" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  // Group by analystId. Map preserves insertion order, so the first time
  // we see each analyst (which is from the most-recent chat) sets the
  // group ordering — already in the right order from the orderBy above.
  const groups = new Map<string, ChatHistoryGroup>();

  for (const row of rows) {
    // No agentConfig = a portfolio-level chat that was never scoped to an
    // analyst. Real and resumable; it just has no analyst to group under, so
    // it gets its own synthetic group. The sentinel id is not a real
    // AgentConfig id — resume goes by runId, so nothing dereferences it.
    const analystId = row.agentConfig?.id ?? UNSCOPED_GROUP_ID;
    const analystName = row.agentConfig?.name ?? "Portfolio";
    const lastActivityAt = row.updatedAt ?? row.startedAt;

    const threadContent = row.messages[0]?.content ?? null;
    const item: ChatHistoryItem = {
      runId: row.id,
      analystId,
      analystName,
      startedAt: row.startedAt,
      lastActivityAt,
      status: row.status,
      hasThread: threadContent != null,
      preview: threadContent ? extractFirstUserMessage(threadContent) : null,
    };

    const existing = groups.get(analystId);
    if (existing) {
      existing.chats.push(item);
      // Already-newer activity wins (this iteration is older).
    } else {
      groups.set(analystId, {
        analyst: { id: analystId, name: analystName },
        chats: [item],
        lastActivityMs: lastActivityAt.getTime(),
      });
    }
  }

  return Array.from(groups.values());
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
        select: { content: true },
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
  };
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
