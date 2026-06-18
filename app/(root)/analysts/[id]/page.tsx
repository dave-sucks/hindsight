import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAnalystDetail, getAnalystTheses } from "@/lib/actions/analyst.actions";
import { getWatchlistItems } from "@/lib/actions/watchlist.actions";
import { getLatestPrices } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getAccountId } from "@/lib/auth/account";
import { fetchRunCardRuns } from "@/lib/actions/run-cards";
import { RunCard } from "@/components/runs/RunCard";
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
  const accountId = userId ? await getAccountId(userId) : null;

  // Auto-clean zombie RUNNING runs older than 15 minutes
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
  if (accountId) {
    await prisma.researchRun.updateMany({
      where: {
        accountId,
        agentConfigId: id,
        status: "RUNNING",
        createdAt: { lt: fifteenMinAgo },
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
      },
    });
  }

  const [detail, runningCount, watchlistItems, alpacaCreds, theses, runRows] = await Promise.all([
    getAnalystDetail(id).catch((err) => {
      console.error("[analyst-page] getAnalystDetail failed:", err);
      return null;
    }),
    accountId
      ? prisma.researchRun.count({
          where: { accountId, agentConfigId: id, status: "RUNNING" },
        }).catch(() => 0)
      : Promise.resolve(0),
    getWatchlistItems(id).catch(() => []),
    userId ? resolveAlpacaCredentials(userId).catch(() => null) : Promise.resolve(null),
    getAnalystTheses(id).catch(() => []),
    // Runs tab uses the SAME RunCard as /runs (one shared component + query).
    // No environment filter — an analyst's runs are all in its own book.
    accountId
      ? fetchRunCardRuns({ accountId, agentConfigId: id, take: 20 }).catch(() => [])
      : Promise.resolve([]),
  ]);

  if (!detail) notFound();

  // Render the run cards server-side (RunCard is a server component) and pass
  // them into the client component as a slot — avoids serializing the raw
  // Prisma run rows (Decimal/Date) across the client boundary.
  const runCards = runRows.map((r) => <RunCard key={r.id} run={r} />);

  // Fetch live prices for open positions AND watchlist tickers — both render
  // through TradeRow / WatchlistRow and need a current price.
  const openSymbols = detail.recentTrades
    .filter((t) => t.status === "OPEN")
    .map((t) => t.symbol);
  const watchlistSymbols = watchlistItems.map((w) => w.symbol);
  const uniqueSymbols = [...new Set([...openSymbols, ...watchlistSymbols])];
  const livePrices: Record<string, number> =
    uniqueSymbols.length > 0
      ? await getLatestPrices(uniqueSymbols, alpacaCreds ?? undefined).catch(() => ({}))
      : {};

  return (
    <AnalystDetailClient
      detail={detail}
      hasRunning={runningCount > 0}
      initialWatchlist={watchlistItems}
      livePrices={livePrices}
      theses={theses}
      runCards={runCards}
    />
  );
}
