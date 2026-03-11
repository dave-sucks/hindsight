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

  const [detail, runningCount] = await Promise.all([
    getAnalystDetail(id),
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
      hasRunning={runningCount > 0}
    />
  );
}
