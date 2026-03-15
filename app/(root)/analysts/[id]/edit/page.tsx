import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ArrowLeft } from "lucide-react";
import { AnalystEditorChatWithInitial } from "@/components/analysts/AnalystEditorChatWithInitial";

type Params = { id: string };

export default async function AnalystEditPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ message?: string }>;
}) {
  const { id } = await params;
  const { message } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return notFound();

  const config = await prisma.agentConfig.findFirst({
    where: { id, userId: user.id },
  });

  if (!config) return notFound();

  const currentConfig: Record<string, unknown> = {
    name: config.name,
    analystPrompt: config.analystPrompt,
    directionBias: config.directionBias,
    holdDurations: config.holdDurations,
    sectors: config.sectors,
    signalTypes: config.signalTypes,
    minConfidence: config.minConfidence,
    maxPositionSize: config.maxPositionSize ? Number(config.maxPositionSize) : undefined,
    maxOpenPositions: config.maxOpenPositions,
    watchlist: config.watchlist,
    exclusionList: config.exclusionList,
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-3rem)] overflow-hidden">
      {/* Header */}
      <div className="border-b px-6 py-3 flex items-center gap-3 shrink-0">
        <Link
          href={`/analysts/${id}`}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 -ml-1"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-sm font-medium truncate">
          Edit {config.name}
        </span>
      </div>

      {/* Chat */}
      <div className="flex-1 min-h-0">
        <AnalystEditorChatWithInitial
          analystId={id}
          currentConfig={currentConfig}
          initialMessage={message}
        />
      </div>
    </div>
  );
}
