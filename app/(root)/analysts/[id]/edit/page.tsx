import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { AnalystEditClient } from "@/components/analysts/AnalystEditClient";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
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

  const watchlistSymbols = await getWatchlistSymbols(id);

  // Build config object matching AgentConfigData shape (including intelligence)
  const currentConfig: Record<string, unknown> = {
    name: config.name,
    description: config.description,
    analystPrompt: config.analystPrompt,
    directionBias: config.directionBias,
    holdDurations: config.holdDurations,
    sectors: config.sectors,
    // ── Universe (B1) — narrower discovery fence ─────────────────
    industries: config.industries,
    themes: config.themes,
    marketCapMin: config.marketCapMin != null ? Number(config.marketCapMin) : null,
    marketCapMax: config.marketCapMax != null ? Number(config.marketCapMax) : null,
    signalTypes: config.signalTypes,
    minConfidence: config.minConfidence,
    maxPositionSize: config.maxPositionSize ? Number(config.maxPositionSize) : undefined,
    maxOpenPositions: config.maxOpenPositions,
    minMarketCapTier: config.minMarketCapTier,
    watchlist: watchlistSymbols,
    exclusionList: config.exclusionList,
    intelligencePolicy: config.intelligencePolicy
      ? (config.intelligencePolicy as Record<string, unknown>)
      : undefined,
  };

  return (
    <AnalystEditClient
      analystId={id}
      currentConfig={currentConfig}
      initialMessage={message}
    />
  );
}
