import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAnalystDetail } from "@/lib/actions/analyst.actions";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";
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

  const [detail, runningCount] = await Promise.all([
    getAnalystDetail(id),
    userId
      ? prisma.researchRun.count({
          where: { userId, agentConfigId: id, status: "RUNNING" },
        })
      : Promise.resolve(0),
  ]);

  if (!detail) notFound();

  // Build the full system prompt so the user can inspect exactly what the agent receives
  const fullSystemPrompt = buildSystemPrompt({
    name: detail.config.name,
    analystPrompt: detail.config.analystPrompt ?? undefined,
    directionBias: detail.config.directionBias,
    holdDurations: detail.config.holdDurations,
    sectors: detail.config.sectors,
    signalTypes: detail.config.signalTypes,
    minConfidence: detail.config.minConfidence,
    maxPositionSize: detail.config.maxPositionSize,
    maxOpenPositions: detail.config.maxOpenPositions,
    watchlist: detail.config.watchlist,
    exclusionList: detail.config.exclusionList,
  });

  return (
    <AnalystDetailClient
      detail={detail}
      hasRunning={runningCount > 0}
      fullSystemPrompt={fullSystemPrompt}
    />
  );
}
