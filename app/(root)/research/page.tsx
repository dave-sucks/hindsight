import ResearchChatFull from "@/components/ResearchChatFull";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export default async function ResearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userId = user?.id ?? "";

  const [recentTheses, runningCount] = await Promise.all([
    userId
      ? prisma.thesis.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            ticker: true,
            direction: true,
            confidenceScore: true,
            reasoningSummary: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    userId
      ? prisma.researchRun.count({ where: { userId, status: "RUNNING" } })
      : Promise.resolve(0),
  ]);

  return (
    <ResearchChatFull
      userId={userId}
      recentTheses={recentTheses}
      hasRunning={runningCount > 0}
    />
  );
}
