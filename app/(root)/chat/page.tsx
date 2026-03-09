import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import ResearchChatFull from "@/components/ResearchChatFull";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userId = user?.id ?? "";

  const [recentTheses, runningCount] = await Promise.all([
    prisma.thesis.findMany({
      where: { userId },
      select: {
        id: true,
        ticker: true,
        direction: true,
        confidenceScore: true,
        reasoningSummary: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.researchRun.count({ where: { userId, status: "RUNNING" } }),
  ]);

  return (
    <ResearchChatFull
      userId={userId}
      recentTheses={recentTheses}
      hasRunning={runningCount > 0}
    />
  );
}
