import TradesPage from "@/components/trades/TradesPage";
import { getDashboardData } from "@/lib/actions/portfolio.actions";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { EnvironmentTabs, parseEnvParam } from "@/components/settings/EnvironmentTabs";

export default async function Trades({
  searchParams,
}: {
  searchParams: Promise<{ env?: string }>;
}) {
  const params = await searchParams;
  const environment = parseEnvParam(params.env);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ openTrades, closedTrades }, paperCount, liveCount] = await Promise.all([
    getDashboardData(environment),
    user
      ? prisma.position.count({ where: { userId: user.id, environment: "PAPER" } })
      : Promise.resolve(0),
    user
      ? prisma.position.count({ where: { userId: user.id, environment: "LIVE" } })
      : Promise.resolve(0),
  ]);

  return (
    <div className="space-y-4">
      <div className="px-4 sm:px-6 pt-6 flex justify-end">
        <EnvironmentTabs
          current={environment}
          basePath="/trades"
          paperCount={paperCount}
          liveCount={liveCount}
        />
      </div>
      <TradesPage initialOpenTrades={openTrades} initialClosedTrades={closedTrades} />
    </div>
  );
}
