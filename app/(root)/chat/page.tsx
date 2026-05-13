import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { convertPersistedToUIMessages } from "@/lib/agent/convert-messages";
import { ChatPageClient } from "./ChatPageClient";
import type { UIMessage } from "ai";

/**
 * Principal chat — operator co-pilot.
 *
 *   /chat                 → portfolio scope (read-only across analysts)
 *   /chat?analyst=<id>    → pinned to that analyst (full write authority,
 *                            backed by a PRINCIPAL_CHAT ResearchRun)
 *
 * When scoped: we resume the most recent open PRINCIPAL_CHAT
 * ResearchRun for this (user, analyst) pair, otherwise the route mints
 * one on the first POST. Either way the runId rides on every message
 * so write tools' FK into it works.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ analyst?: string; session?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { analyst: analystParam, session: sessionParam } = await searchParams;

  // Validate the analyst id if provided. Invalid → drop the scope param,
  // chat starts unscoped (route will still 404 a write but the user can
  // pick from the header).
  let scopedAnalyst:
    | { id: string; name: string }
    | null = null;
  if (analystParam) {
    const ac = await prisma.agentConfig.findFirst({
      where: { id: analystParam, userId: user.id },
      select: { id: true, name: true },
    });
    if (ac) scopedAnalyst = ac;
  }

  // Resume the most recent open principal-chat session for this scope
  // (so reloads don't lose the conversation). The route creates the row
  // on first POST if there isn't one yet.
  let runId: string | undefined;
  let initialMessages: UIMessage[] = [];
  try {
    let run = sessionParam
      ? await prisma.researchRun.findFirst({
          where: {
            id: sessionParam,
            userId: user.id,
            mode: "PRINCIPAL_CHAT",
          },
          include: {
            messages: {
              where: { role: "thread" },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        })
      : scopedAnalyst
        ? await prisma.researchRun.findFirst({
            where: {
              userId: user.id,
              mode: "PRINCIPAL_CHAT",
              agentConfigId: scopedAnalyst.id,
            },
            orderBy: { startedAt: "desc" },
            include: {
              messages: {
                where: { role: "thread" },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          })
        : null;

    if (run) {
      runId = run.id;
      const persisted = run.messages[0]?.content;
      if (persisted) {
        try {
          const raw = JSON.parse(persisted);
          if (Array.isArray(raw) && raw.length > 0) {
            initialMessages = convertPersistedToUIMessages(raw);
          }
        } catch {
          // malformed JSON — start fresh, no replay
        }
      }
    }
  } catch (err) {
    console.error("[chat/page] failed to resume session:", err);
  }

  // Pull the analyst list once so the scope picker doesn't have to
  // round-trip for it. Tiny query — id + name.
  const analysts = await prisma.agentConfig.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, enabled: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <ChatPageClient
      runId={runId}
      scopedAnalyst={scopedAnalyst}
      analysts={analysts}
      initialMessages={initialMessages}
    />
  );
}
