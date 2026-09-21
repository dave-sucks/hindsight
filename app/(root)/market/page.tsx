/**
 * /market — earnings, filings, movers and signals, as four tabs.
 *
 * Replaces four separate routes (/earnings, /movers, /intelligence, and the
 * filings toggle inside the calendar). Everything here is live from the
 * vendor or read-only history; nothing on this page is stored by us.
 *
 * ?tab= picks the tab, so a link can land on any of them. The old routes
 * redirect here.
 */

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { MarketTabs, MARKET_TABS, type MarketTab } from "@/components/market/MarketTabs";
import type { MoverKind } from "@/lib/market-data/movers";

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; kind?: string }>;
}) {
  const { tab, kind } = await searchParams;
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

  const initialTab: MarketTab =
    MARKET_TABS.find((t) => t.value === tab)?.value ?? "earnings";
  const initialKind: MoverKind = kind === "losers" || kind === "active" ? kind : "gainers";

  return (
    <MarketTabs
      analysts={analysts}
      initialTab={initialTab}
      initialDate={new Date().toISOString().slice(0, 10)}
      initialKind={initialKind}
    />
  );
}
