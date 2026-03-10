import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { PlayCircle } from "lucide-react";

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default async function RunsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? "";

  const runs = await prisma.researchRun.findMany({
    where: { userId },
    include: {
      agentConfig: { select: { id: true, name: true } },
      theses: { select: { direction: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 100,
  });

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Runs</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Research sessions from all your analysts
        </p>
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
          <PlayCircle className="h-10 w-10 mb-4 opacity-30" />
          <p className="text-sm font-medium">No runs yet</p>
          <p className="text-xs mt-1">
            Enable an analyst to start automated research runs
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden divide-y">
          {runs.map((run) => {
            const analystName =
              run.agentConfig?.name ??
              (run.source === "MANUAL" ? "Manual Research" : "Agent");

            const recommended = run.theses.filter(
              (t) => t.direction !== "PASS"
            ).length;

            const duration = run.completedAt
              ? Math.round(
                  (new Date(run.completedAt).getTime() -
                    new Date(run.startedAt).getTime()) /
                    1000
                )
              : null;

            const statusDot =
              run.status === "COMPLETE"
                ? "bg-emerald-500"
                : run.status === "RUNNING"
                ? "bg-amber-500 animate-pulse"
                : "bg-red-400";

            return (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
              >
                <div
                  className={`h-2 w-2 rounded-full shrink-0 mt-0.5 ${statusDot}`}
                />

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{analystName}</p>
                  {run.theses.length > 0 && (
                    <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                      {run.theses.length} analyzed &middot; {recommended}{" "}
                      recommended
                    </p>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatRelativeTime(run.startedAt)}
                  </p>
                  {duration != null && (
                    <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
                      {duration}s
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
