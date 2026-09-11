/**
 * /earnings — who reports this week, and how it went.
 *
 * The same calendar the trigger evaluator reads every five minutes, shown
 * to a person: a week strip, one day's reporters with EPS and revenue
 * against the estimate, the day's price move, and "send to agent" on
 * every row. Live from the vendor; nothing stored. The page is its own
 * route so it never adds a call to the dashboard.
 */

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { EarningsCalendar } from "@/components/earnings/EarningsCalendar";

export default async function EarningsPage() {
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Earnings</h1>
        <p className="text-sm text-muted-foreground">
          Who reports this week, and how it went. Your names first.
        </p>
      </div>
      <EarningsCalendar analysts={analysts} initialDate={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
