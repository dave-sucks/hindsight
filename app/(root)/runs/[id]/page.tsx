import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ScanSearch } from "lucide-react";
import { AgentChat } from "@/components/agent/AgentChat";
import { HowItWorksSheet } from "@/components/domain/how-it-works-sheet";
import { convertPersistedToUIMessages } from "@/lib/agent/convert-messages";
import { getRunSourcesData } from "@/lib/actions/run-sources.actions";
import { getTeamForRunMode } from "@/lib/agent/workflow-registry";
import type { UIMessage } from "ai";
import type { TranscriptRowData } from "@/components/ui/transcript-row";

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function RunPage({
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

  const run = await prisma.researchRun.findFirst({
    where: { id, userId },
    include: {
      agentConfig: { select: { id: true, name: true } },
      // Podcast feature — segment runs share the ResearchRun table and
      // route through the same /runs/[id] page. We branch the AgentChat
      // mode below based on which FK is set.
      segment: {
        select: { id: true, name: true, podcast: { select: { name: true } } },
      },
      // The single transcript a segment run produces (mirror of theses
      // for analyst runs) — fed into AgentChat as the Transcript tab.
      segmentTranscript: true,
      messages: {
        where: { role: "thread" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!run) notFound();

  const isPodcastSegmentRun = run.podcastSegmentId != null;

  const analystName = isPodcastSegmentRun
    ? `${run.segment?.podcast?.name ?? "Podcast"} · ${run.segment?.name ?? "Segment"}`
    : (run.agentConfig?.name ??
        (run.source === "MANUAL" ? "Manual Research" : "Agent"));

  // Extract config snapshot from the run parameters
  const config =
    run.parameters && typeof run.parameters === "object"
      ? (run.parameters as Record<string, unknown>)
      : {};

  // Detect stale RUNNING runs (likely crashed cron or timed-out agent).
  // If RUNNING for over 10 minutes, treat as stale — don't auto-start a new agent.
  const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
  const isStale =
    run.status === "RUNNING" &&
    Date.now() - new Date(run.startedAt).getTime() > STALE_THRESHOLD_MS;

  // Mark stale runs as FAILED — atomic, only if still RUNNING
  if (isStale) {
    const staleResult = await prisma.researchRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: { status: "FAILED", completedAt: new Date() },
    });
    if (staleResult.count > 0) {
      run.status = "FAILED";
    }
  }

  // Parse persisted messages for completed/failed runs
  let persistedMessages: UIMessage[] | null = null;
  if ((run.status === "COMPLETE" || run.status === "FAILED") && run.messages.length > 0) {
    try {
      const raw = JSON.parse(run.messages[0].content);
      if (Array.isArray(raw) && raw.length > 0) {
        persistedMessages = convertPersistedToUIMessages(raw);
      }
    } catch {
      // Malformed JSON — will show empty state
    }
  }

  const isLive = run.status === "RUNNING";
  const hasReplay = persistedMessages !== null;

  // Tactical runs (mode=INTRADAY_TACTICAL) execute server-side via the
  // Inngest tactical-run consumer — NOT via /api/agent/research-run. We
  // must NOT autostart the AgentChat for them, otherwise the page kicks
  // off a parallel full research-run on what is supposed to be a focused
  // tactical run, producing the runaway-morning-research bug seen on
  // 2026-04-29 test-fires. This `isTacticalMode` guard suppresses the
  // autostart for those runs; the events written by the Inngest consumer
  // still render via the existing event/replay path.
  const isTacticalMode = run.mode === "INTRADAY_TACTICAL";
  // Discovery runs (mode=DISCOVERY) execute server-side via Inngest's
  // discovery-run consumer — same shape as tactical. Opening the run
  // page while it's RUNNING was previously auto-starting a SECOND agent
  // through /api/agent/research-run (which uses the morning-plan
  // prompt + allowlist — get_portfolio_context, update_thesis, etc.),
  // racing against the real discovery agent and frequently winning the
  // write to RunMessage. Observed in run cmp6dk0w1000004jhoi32cv63
  // (2026-05-15): mode=DISCOVERY but the transcript was a daily-run
  // shape with "Portfolio Overview", update_thesis on existing NVDA.
  // Same guard as tactical fixes it.
  const isDiscoveryMode = run.mode === "DISCOVERY";
  // Inngest-backed segment runs (source=AGENT) execute server-side — don't
  // auto-start AgentThread or it would launch a second competing agent.
  const isInngestSegmentRun = isPodcastSegmentRun && run.source === "AGENT";

  // Load Sources + Theses tab data from the DB.
  // Wrapped in try/catch so a DB error (e.g. pending migration) never
  // crashes the whole page — tabs just render empty.
  const { brief, sources, theses } = await getRunSourcesData({
    runId: run.id,
    analystId: run.agentConfig?.id ?? null,
    startedAt: run.startedAt,
  }).catch(() => ({ brief: null, sources: [], theses: [] }));

  // Build the Transcript tab payload for podcast segment runs.
  const transcriptForChat: TranscriptRowData | null =
    isPodcastSegmentRun && run.segmentTranscript
      ? {
          id: run.segmentTranscript.id,
          transcriptId: run.segmentTranscript.id,
          title: run.segmentTranscript.title,
          plainText: run.segmentTranscript.plainText,
          durationSec: run.segmentTranscript.durationSec,
          wordCount: run.segmentTranscript.plainText
            .split(/\s+/)
            .filter(Boolean).length,
          citations: Array.isArray(run.segmentTranscript.citations)
            ? (run.segmentTranscript.citations as TranscriptRowData["citations"])
            : [],
          segmentName: run.segment?.name ?? null,
          podcastName: run.segment?.podcast?.name ?? null,
          audioUrl: run.segmentTranscript.audioUrl,
          status: run.segmentTranscript.status as TranscriptRowData["status"],
        }
      : null;

  return (
    <div className="flex flex-col h-[calc(100dvh-3rem)] overflow-hidden">
      <div className="flex-1 min-h-0">
        {isLive || hasReplay ? (
          <AgentChat
            mode={isPodcastSegmentRun ? "podcast-segment-run" : "research-run"}
            runId={id}
            analystId={isPodcastSegmentRun ? undefined : run.agentConfig?.id}
            analystName={analystName}
            autoStart={isLive && !isTacticalMode && !isDiscoveryMode && !isInngestSegmentRun}
            messages={persistedMessages ?? undefined}
            brief={isPodcastSegmentRun ? null : brief}
            sources={isPodcastSegmentRun ? [] : sources}
            theses={isPodcastSegmentRun ? [] : theses}
            transcript={transcriptForChat}
            headerAction={
              <HowItWorksSheet flow={getTeamForRunMode(run.mode)}>
                <ScanSearch className="h-4 w-4" />
              </HowItWorksSheet>
            }
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2 px-6">
            <div className="h-2.5 w-2.5 rounded-full bg-negative" />
            <p className="text-sm font-medium text-foreground">
              {run.status === "FAILED" ? "Run failed" : "No replay data available"}
            </p>
            <p className="text-xs max-w-xs">
              {run.status === "FAILED"
                ? "This run stopped before completing. It may have timed out or encountered an error."
                : "This run completed before message persistence was enabled."}
            </p>
            {run.status === "FAILED" && typeof config.error === "string" && (
              <p className="text-xs max-w-md font-mono text-negative mt-2 bg-negative/5 rounded-md px-3 py-2 border border-negative/10">
                {config.error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
