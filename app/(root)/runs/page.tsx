import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId } from "@/lib/auth/account";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConceptTooltip } from "@/components/domain/education-card";
import { RunShowcaseTrigger, RunShowcaseButton } from "@/components/domain/run-showcase-trigger";
import { SkeletonCardStack } from "@/components/domain/skeleton-card";
import { RunsFilterBar } from "@/components/runs/RunsFilterBar";
import { RunCard } from "@/components/runs/RunCard";
import { fetchRunCardRuns } from "@/lib/actions/run-cards";
import { RUNS_MODE_OPTIONS } from "@/lib/runs/modes";

const VALID_MODES = new Set(RUNS_MODE_OPTIONS.map((o) => o.value));

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ analyst?: string; mode?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  const accountId = await getAccountId(user.id);
  if (!accountId) redirect("/sign-in");
  const environment = await getCurrentEnvironment();

  const sp = await searchParams;
  const analystFilter = sp.analyst && sp.analyst !== "all" ? sp.analyst : null;
  const modeFilter = sp.mode && VALID_MODES.has(sp.mode) ? sp.mode : null;

  const [runs, analysts] = await Promise.all([
    fetchRunCardRuns({
      accountId,
      environment,
      agentConfigId: analystFilter ?? undefined,
      mode: modeFilter ?? undefined,
    }),
    prisma.agentConfig.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const hasActiveFilter = analystFilter != null || modeFilter != null;

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-3">
      <div className="mb-4 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Runs</h1>
            <RunShowcaseButton />
          </div>
          <RunsFilterBar
            analysts={analysts}
            selectedAnalystId={analystFilter}
            selectedMode={modeFilter}
          />
          {runs.length === 0 && !hasActiveFilter && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Link
                      href="/analysts"
                      className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
                    >
                      Create an Analyst
                    </Link>
                  }
                />
                <TooltipContent side="bottom">
                  <p className="text-xs">Create an analyst to start running research sessions</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Structured <ConceptTooltip concept="run">research sessions</ConceptTooltip> from all your analysts
        </p>
      </div>

      {runs.length === 0 ? (
        hasActiveFilter ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">No runs match the current filters.</p>
          </div>
        ) : (
          <div className="pt-8">
            <RunShowcaseTrigger />
            <SkeletonCardStack
              count={3}
              title="No runs yet"
              subtitle="You'll see runs from your analysts here once they run."
            />
          </div>
        )
      ) : (
        runs.map((run) => <RunCard key={run.id} run={run} />)
      )}
    </div>
  );
}
