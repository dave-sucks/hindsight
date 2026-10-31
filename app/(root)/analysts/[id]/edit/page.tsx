import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { AnalystEditClient } from "@/components/analysts/AnalystEditClient";
import { getHeldOrWatchedSymbols, getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { getAccountId } from "@/lib/auth/account";

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
  const accountId = await getAccountId(user.id);
  if (!accountId) return notFound();

  const config = await prisma.agentConfig.findFirst({
    where: { id, accountId },
  });

  if (!config) return notFound();

  const [watchlistSymbols, heldOrWatched] = await Promise.all([
    getWatchlistSymbols(id),
    getHeldOrWatchedSymbols(id),
  ]);

  // The analyst as the editor reads it (AgentConfigData shape).
  const currentConfig: Record<string, unknown> = {
    name: config.name,
    description: config.description,
    analystPrompt: config.analystPrompt,
    directionBias: config.directionBias,
    holdDurations: config.holdDurations,
    setupIds: config.setupIds,
    sectors: config.sectors,
    marketCapMin: config.marketCapMin != null ? Number(config.marketCapMin) : null,
    marketCapMax: config.marketCapMax != null ? Number(config.marketCapMax) : null,
    minConfidence: config.minConfidence,
    riskPct: config.riskPct,
    minPositionSize: config.minPositionSize,
    maxPositionSize: config.maxPositionSize ? Number(config.maxPositionSize) : undefined,
    maxPositionTotal: config.maxPositionTotal,
    maxOpenPositions: config.maxOpenPositions,
    watchlist: watchlistSymbols,
    exclusionList: config.exclusionList,
  };

  return (
    <AnalystEditClient
      analystId={id}
      currentConfig={currentConfig}
      heldOrWatched={heldOrWatched}
      initialMessage={message}
    />
  );
}
