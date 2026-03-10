import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, Bot, Clock } from "lucide-react";
import RunChatThread from "@/components/research/RunChatThread";
import RunLiveStream from "@/components/research/RunLiveStream";
import type { RunEventRow } from "@/components/research/RunChatThread";
import type { ComposerRecentThesis } from "@/components/chat/ChatComposer";

// ── Synthesize events from thesis rows for legacy runs ────────────────────────

function synthesizeEventsFromTheses(
  theses: {
    ticker: string;
    direction: string;
    confidenceScore: number;
    reasoningSummary: string;
    thesisBullets: string[];
    riskFlags: string[];
    entryPrice: number | null;
    targetPrice: number | null;
    stopLoss: number | null;
    holdDuration: string;
    signalTypes: string[];
    createdAt: Date;
  }[]
): RunEventRow[] {
  if (theses.length === 0) return [];

  const events: RunEventRow[] = [];
  let uid = 0;
  const nextId = () => `synth-${uid++}`;
  const baseDate = theses[0].createdAt.toISOString();

  // candidates list
  events.push({
    id: nextId(),
    type: "candidates",
    title: "Candidates",
    message: null,
    payload: { tickers: theses.map((t) => t.ticker), count: theses.length },
    createdAt: baseDate,
  });

  // per-ticker: concept then thesis or skip
  for (const thesis of theses) {
    const ts = thesis.createdAt.toISOString();

    events.push({
      id: nextId(),
      type: "concept",
      title: "Concept",
      message: null,
      payload: {
        ticker: thesis.ticker,
        direction: thesis.direction,
        confidence: thesis.confidenceScore,
      },
      createdAt: ts,
    });

    if (thesis.direction === "PASS") {
      events.push({
        id: nextId(),
        type: "skip",
        title: "Skip",
        message: null,
        payload: {
          ticker: thesis.ticker,
          reason:
            thesis.reasoningSummary?.slice(0, 120) ||
            "No clear tradeable signal",
          confidence: thesis.confidenceScore,
        },
        createdAt: ts,
      });
    } else {
      events.push({
        id: nextId(),
        type: "thesis_complete",
        title: "Thesis",
        message: null,
        payload: {
          ticker: thesis.ticker,
          thesis: {
            ticker: thesis.ticker,
            direction: thesis.direction,
            confidence_score: thesis.confidenceScore,
            reasoning_summary: thesis.reasoningSummary,
            thesis_bullets: thesis.thesisBullets ?? [],
            risk_flags: thesis.riskFlags ?? [],
            entry_price: thesis.entryPrice,
            target_price: thesis.targetPrice,
            stop_loss: thesis.stopLoss,
            hold_duration: thesis.holdDuration || "SWING",
            signal_types: thesis.signalTypes ?? [],
          },
        },
        createdAt: ts,
      });
    }
  }

  const recommended = theses.filter((t) => t.direction !== "PASS").length;
  events.push({
    id: nextId(),
    type: "run_complete",
    title: "Run Complete",
    message: null,
    payload: { analyzed: theses.length, recommended },
    createdAt: new Date().toISOString(),
  });

  return events;
}

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
      events: { orderBy: { createdAt: "asc" } },
      theses: {
        select: {
          ticker: true,
          direction: true,
          confidenceScore: true,
          reasoningSummary: true,
          thesisBullets: true,
          riskFlags: true,
          entryPrice: true,
          targetPrice: true,
          stopLoss: true,
          holdDuration: true,
          signalTypes: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!run) notFound();

  const analystName =
    run.agentConfig?.name ??
    (run.source === "MANUAL" ? "Manual Research" : "Agent");

  const startedAt = new Date(run.startedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

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
      ? "bg-amber-500"
      : "bg-red-400";

  // Use stored events; fall back to synthesized for legacy runs
  const events: RunEventRow[] =
    run.events.length > 0
      ? run.events.map((ev) => ({
          id: ev.id,
          type: ev.type,
          title: ev.title,
          message: ev.message,
          payload: ev.payload,
          createdAt: ev.createdAt.toISOString(),
        }))
      : synthesizeEventsFromTheses(run.theses);

  // Derive recentTheses from the run's own theses for @-reference in follow-up
  const recentTheses: ComposerRecentThesis[] = run.theses
    .filter((t) => t.direction !== "PASS")
    .map((t, i) => ({
      id: `${t.ticker}-${i}`,
      ticker: t.ticker,
      direction: t.direction,
      confidenceScore: t.confidenceScore,
      reasoningSummary: t.reasoningSummary ?? "",
      createdAt: t.createdAt,
    }));

  return (
    <div className="flex flex-col h-[calc(100dvh-5.25rem)] overflow-hidden">
      {/* Header */}
      <div className="border-b px-6 py-3 flex items-center gap-3 shrink-0">
        <Link
          href={run.agentConfig?.id ? `/analysts/${run.agentConfig.id}` : "/runs"}
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0 -ml-1"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="flex items-center gap-2 min-w-0">
          <div className={`h-2 w-2 rounded-full shrink-0 ${statusDot}`} />
          <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium truncate">{analystName}</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-auto tabular-nums">
          <Clock className="h-3 w-3" />
          <span>{startedAt}</span>
          {duration != null && <span>· {duration}s</span>}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0">
        {run.status === "RUNNING" ? (
          // Live stream: connect to SSE and accumulate events in real-time
          <RunLiveStream
            runId={id}
            userId={userId}
            analystId={run.agentConfig?.id}
          />
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2">
            <p className="text-sm">No details available for this run.</p>
          </div>
        ) : (
          <RunChatThread
            events={events}
            showFollowup={run.status === "COMPLETE"}
            userId={userId}
            analystId={run.agentConfig?.id}
            recentTheses={recentTheses}
          />
        )}
      </div>
    </div>
  );
}
