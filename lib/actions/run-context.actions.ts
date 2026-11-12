"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { loadRunRequests, type CallView } from "@/lib/agent/run-requests";

/**
 * What one of your runs sent the model, read when its Context panel opens:
 * the run's own call and its newest follow-up or chat message. A chat on
 * /chat names its run by the session id it was started with.
 */
export async function getRunContext(key: { runId?: string | null; chatSessionId?: string | null }): Promise<CallView[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const run = key.runId
    ? await prisma.researchRun.findFirst({ where: { id: key.runId, userId: user.id }, select: { id: true } })
    : key.chatSessionId
      ? await prisma.researchRun.findFirst({
          where: { userId: user.id, mode: "PRINCIPAL_CHAT", parameters: { path: ["chatSessionId"], equals: key.chatSessionId } },
          orderBy: { startedAt: "desc" },
          select: { id: true },
        })
      : null;
  return run ? loadRunRequests(run.id) : [];
}
