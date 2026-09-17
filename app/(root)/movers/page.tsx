/**
 * /movers — today's gainers, losers and most-active stocks.
 *
 * The same Alpaca screener the agents' get_market_movers reads, shown to a
 * person with names, price, the day's move and volume, and "send to
 * analyst" on every row. Live; nothing stored.
 */

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { MoversTable } from "@/components/movers/MoversTable";
import type { MoverKind } from "@/lib/market-data/movers";

export default async function MoversPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const accountId = user ? await getAccountId(user.id) : null;

  const analysts = accountId
    ? await prisma.agentConfig.findMany({
        where: { accountId, enabled: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
    : [];

  const initialKind: MoverKind = tab === "losers" || tab === "active" ? tab : "gainers";

  // Same container as Earnings, Runs and Intelligence.
  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-3">
      <div className="mb-4 space-y-1">
        <h1 className="text-2xl font-semibold">Movers</h1>
        <p className="text-sm text-muted-foreground">Today&apos;s biggest gainers, losers and most-traded stocks.</p>
      </div>
      <MoversTable analysts={analysts} initialKind={initialKind} />
    </div>
  );
}
