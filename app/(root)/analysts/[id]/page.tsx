import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAnalystDetail } from "@/lib/actions/analyst.actions";
import AnalystDetailClient from "@/components/analysts/AnalystDetailClient";

type Params = { id: string };

export default async function AnalystDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userId = user?.id ?? "";

  const [detail, recentTheses, runningCount] = await Promise.all([
    getAnalystDetail(id),
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
      ? prisma.researchRun.count({
          where: { userId, agentConfigId: id, status: "RUNNING" },
        })
      : Promise.resolve(0),
  ]);

  if (!detail) notFound();

  return (
    <AnalystDetailClient
      detail={detail}
      userId={userId}
      recentTheses={recentTheses}
      hasRunning={runningCount > 0}
    />
  );
}
