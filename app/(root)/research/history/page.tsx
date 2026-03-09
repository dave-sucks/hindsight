import ResearchFeed from "@/components/ResearchFeed";
import { RunResearchButton } from "@/components/RunResearchButton";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import Link from "next/link";

type SearchParams = { [key: string]: string | string[] | undefined };

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ResearchHistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userId = user?.id ?? "";

  const where: Prisma.ThesisWhereInput = { userId };
  const direction = str(sp.direction);
  const confidence = str(sp.confidence);
  const status = str(sp.status);
  const ticker = str(sp.ticker);

  if (direction) where.direction = direction;
  if (confidence === "high") where.confidenceScore = { gte: 70 };
  if (status === "traded") where.trade = { isNot: null };
  if (ticker) where.ticker = { contains: ticker.toUpperCase() };

  const [theses, runningCount] = await Promise.all([
    prisma.thesis.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        trade: {
          select: {
            id: true,
            realizedPnl: true,
            status: true,
            entryPrice: true,
            closePrice: true,
          },
        },
        researchRun: { select: { source: true } },
      },
    }),
    userId
      ? prisma.researchRun.count({ where: { userId, status: "RUNNING" } })
      : Promise.resolve(0),
  ]);

  const hasRunning = runningCount > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/research"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Research
            </Link>
          </div>
          <h1 className="text-2xl font-semibold mt-1">Research History</h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-generated trade theses
          </p>
        </div>
        <RunResearchButton hasRunning={hasRunning} />
      </div>

      <ResearchFeed theses={theses} />
    </div>
  );
}
