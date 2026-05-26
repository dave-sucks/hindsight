import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId } from "@/lib/auth/account";
import { ChatPageClient } from "./ChatPageClient";
import { loadChatThread, listRecentChats } from "@/lib/actions/chat.actions";
import { convertPersistedToUIMessages } from "@/lib/agent/convert-messages";
import type { UIMessage } from "ai";

/**
 * Principal chat — operator co-pilot.
 *
 * Server side loads:
 *   - The analyst list for the scope picker
 *   - The Recent Chats sidebar groups (past PRINCIPAL_CHAT runs grouped
 *     by analyst, most-recent-first)
 *   - The resumed-chat thread when ?resume=<runId> is present in the
 *     URL — server-fetches the RunMessage thread, parses it via the same
 *     convertPersistedToUIMessages helper /runs/[id] uses, and passes
 *     UIMessage[] + runId + analystId into ChatPageClient so AgentChat
 *     opens with full history. Subsequent turns POST with the resumed
 *     runId so the route continues writing to the same chat.
 *
 * Scope itself stays client-state inside ChatPageClient. When resume
 * is active, the page hydrates with the resumed chat's analystId.
 */
interface ChatPageProps {
  searchParams: Promise<{ resume?: string }>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const accountId = await getAccountId(user.id);
  if (!accountId) redirect("/sign-in");

  const params = await searchParams;
  const resumeRunId = params.resume?.trim() || null;

  // Run these in parallel — they're independent reads.
  const [analysts, recentChats, resumed] = await Promise.all([
    prisma.agentConfig.findMany({
      where: { accountId },
      select: { id: true, name: true, enabled: true },
      orderBy: { createdAt: "asc" },
    }),
    listRecentChats({ userId: user.id, accountId, limit: 30 }),
    resumeRunId ? loadChatThread(resumeRunId, user.id) : Promise.resolve(null),
  ]);

  // If resume was requested but the row was missing / not owned / no
  // thread, silently fall through to a fresh chat. The sidebar should
  // never link to a row the user can't load, but defensive against
  // stale bookmarks.
  let resumedMessages: UIMessage[] | undefined;
  let resumedAnalystId: string | null = null;
  let resumedRunId: string | null = null;

  if (resumed) {
    try {
      const raw = JSON.parse(resumed.threadJson);
      if (Array.isArray(raw) && raw.length > 0) {
        resumedMessages = convertPersistedToUIMessages(raw);
        resumedAnalystId = resumed.analystId;
        resumedRunId = resumed.runId;
      }
    } catch {
      // Malformed thread JSON — fall through to fresh chat.
    }
  }

  return (
    <ChatPageClient
      analysts={analysts}
      recentChats={recentChats}
      resumedMessages={resumedMessages}
      resumedRunId={resumedRunId}
      resumedAnalystId={resumedAnalystId}
    />
  );
}
