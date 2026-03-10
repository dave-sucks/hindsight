import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getStockProfile } from "@/lib/actions/finnhub.actions";
import RunDetailClient from "@/components/research/RunDetailClient";
import type { CompanyProfile } from "@/components/research/ResearchPage";
import { getOrSynthesizeRunEvents, getRunMessages } from "@/lib/actions/run-events.actions";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userId = user?.id ?? "";

  const [run, recentTheses, runningCount] = await Promise.all([
    prisma.researchRun.findFirst({
      where: { id, userId },
      include: {
        agentConfig: { select: { id: true, name: true } },
        theses: {
          select: {
            id: true,
            ticker: true,
            direction: true,
            confidenceScore: true,
            holdDuration: true,
            signalTypes: true,
            sector: true,
            reasoningSummary: true,
            thesisBullets: true,
            riskFlags: true,
            sourcesUsed: true,
            entryPrice: true,
            targetPrice: true,
            stopLoss: true,
            modelUsed: true,
            createdAt: true,
            trade: {
              select: {
                id: true,
                realizedPnl: true,
                status: true,
                entryPrice: true,
                closePrice: true,
              },
            },
          },
          orderBy: { confidenceScore: "desc" },
        },
      },
    }),
    prisma.thesis.findMany({
      where: { userId },
      select: {
        id: true,
        ticker: true,
        direction: true,
        confidenceScore: true,
        reasoningSummary: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.researchRun.count({ where: { userId, status: "RUNNING" } }),
  ]);

  if (!run) notFound();

  // Fetch events, messages, and profiles in parallel (run ownership already verified above)
  const [events, messages] = await Promise.all([
    getOrSynthesizeRunEvents(run.id, userId),
    getRunMessages(run.id, userId),
  ]);

  // Synthesized timelines have synthetic:true in any event payload
  const isSynthetic = events.some(
    (ev) =>
      ev.payload !== null &&
      typeof ev.payload === "object" &&
      "synthetic" in (ev.payload as Record<string, unknown>) &&
      (ev.payload as Record<string, unknown>).synthetic === true
  );

  // Fetch company profiles for all tickers in this run
  const uniqueTickers = [...new Set(run.theses.map((t) => t.ticker))];
  const profileResults = await Promise.allSettled(
    uniqueTickers.map(async (sym) => {
      const profile = await getStockProfile(sym);
      return [sym, profile] as const;
    })
  );

  const profiles: Record<string, CompanyProfile> = {};
  for (const result of profileResults) {
    if (result.status === "fulfilled" && result.value[1]) {
      const [sym, profile] = result.value;
      if (profile) {
        profiles[sym] = {
          name: profile.name,
          logo: profile.logo,
          exchange: profile.exchange,
        };
      }
    }
  }

  const analystName =
    run.agentConfig?.name ??
    (run.source === "MANUAL" ? "Manual Research" : "Agent");

  return (
    <RunDetailClient
      run={{
        id: run.id,
        analystId: run.agentConfig?.id ?? null,
        analystName,
        status: run.status,
        source: run.source,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        parameters: run.parameters,
        theses: run.theses,
      }}
      profiles={profiles}
      userId={userId}
      recentTheses={recentTheses}
      hasRunning={runningCount > 0}
      initialEvents={events}
      initialMessages={messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
      }))}
      isSynthetic={isSynthetic}
    />
  );
}
