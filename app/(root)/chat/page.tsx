import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { convertPersistedToUIMessages } from "@/lib/agent/convert-messages";
import { ChatPageClient } from "./ChatPageClient";
import type { UIMessage } from "ai";

/**
 * Principal chat — the operator-perspective chat surface.
 *
 * Resumes the most recent PRINCIPAL_CHAT ResearchRun if there is one
 * (so the conversation persists across reloads); otherwise mints a fresh
 * one. The route handler (/api/agent/principal) will keep this row
 * RUNNING between messages and create a new ResearchRun when this one
 * is COMPLETE — first POST after page load re-opens it via updateMany.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session: sessionParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  // Reuse the explicit session if passed; else most recent open principal
  // chat for this user; else mint a fresh one.
  let run = sessionParam
    ? await prisma.researchRun.findFirst({
        where: { id: sessionParam, userId: user.id, mode: "PRINCIPAL_CHAT" },
        include: {
          messages: {
            where: { role: "thread" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      })
    : await prisma.researchRun.findFirst({
        where: { userId: user.id, mode: "PRINCIPAL_CHAT" },
        orderBy: { startedAt: "desc" },
        include: {
          messages: {
            where: { role: "thread" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

  if (!run) {
    run = await prisma.researchRun.create({
      data: {
        userId: user.id,
        agentConfigId: null,
        source: "MANUAL",
        status: "RUNNING",
        mode: "PRINCIPAL_CHAT",
        parameters: {} as object,
      },
      include: {
        messages: {
          where: { role: "thread" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
  }

  let initialMessages: UIMessage[] = [];
  const persisted = run.messages[0]?.content;
  if (persisted) {
    try {
      const raw = JSON.parse(persisted);
      if (Array.isArray(raw) && raw.length > 0) {
        initialMessages = convertPersistedToUIMessages(raw);
      }
    } catch {
      // malformed JSON — start fresh
    }
  }

  return (
    <ChatPageClient
      runId={run.id}
      initialMessages={initialMessages}
    />
  );
}
