"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { loadRunRequests, type CallView } from "@/lib/agent/run-requests";

/** The newest record of what one of your runs sent the model, read when its Context panel opens (a chat keeps one per message). */
export async function getRunContext(runId: string): Promise<CallView[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const run = await prisma.researchRun.findFirst({ where: { id: runId, userId: user.id }, select: { id: true } });
  return run ? loadRunRequests(run.id, { latest: true }) : [];
}
