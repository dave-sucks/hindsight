import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, Bot, Clock } from "lucide-react";
import RunLiveStream from "@/components/research/RunLiveStream";
import { RunUnifiedChat } from "@/components/research/RunUnifiedChat";
import { AgentThread } from "@/components/research/AgentThread";
import type { RunEventRow } from "@/components/research/types";

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
    trade: { direction: string; entryPrice: number } | null;
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

      // Emit trade_placed if a trade was opened for this thesis
      if (thesis.trade) {
        events.push({
          id: nextId(),
          type: "trade_placed",
          title: "Trade Placed",
          message: null,
          payload: {
            ticker: thesis.ticker,
            direction: thesis.trade.direction,
            entry: thesis.trade.entryPrice,
          },
          createdAt: ts,
        });
      }
    }
  }

  const recommended = theses.filter((t) => t.direction !== "PASS").length;
  const placed = theses.filter((t) => t.trade !== null).length;
  events.push({
    id: nextId(),
    type: "run_complete",
    title: "Run Complete",
    message: null,
    payload: { analyzed: theses.length, recommended, placed },
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
          id: true,
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
          trade: { select: { direction: true, entryPrice: true } },
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

  // Extract config snapshot from the run parameters
  const config =
    run.parameters && typeof run.parameters === "object"
      ? (run.parameters as Record<string, unknown>)
      : {};

  // Agent mode: all new runs use the real LLM agent.
  // Legacy runs (no agentMode flag) fall back to the old event view.
  // COMPLETED agent runs fall back to event view so results persist on reload.
  const isAgentMode = config.agentMode === true;
  const useAgent = isAgentMode && run.status === "RUNNING";

  // Legacy-only: stale detection + event synthesis
  const isStaleRun =
    !useAgent &&
    run.status === "RUNNING" &&
    run.events.length === 0 &&
    Date.now() - new Date(run.startedAt).getTime() > 15 * 60 * 1_000;

  // Load saved agent messages for completed runs
  const savedMessages = useAgent && run.status === "COMPLETE"
    ? await prisma.runMessage.findFirst({
        where: { runId: id, role: "thread" },
        orderBy: { createdAt: "desc" },
      })
    : null;

  const initialMessages = savedMessages?.content
    ? (() => {
        try { return JSON.parse(savedMessages.content); }
        catch { return undefined; }
      })()
    : undefined;

  let events: RunEventRow[];
  if (useAgent) {
    events = [];
  } else if (run.events.length > 0) {
    events = run.events.map((ev: { id: string; type: string; title: string; message: string | null; payload: unknown; createdAt: Date }) => ({
      id: ev.id,
      type: ev.type,
      title: ev.title,
      message: ev.message,
      payload: ev.payload,
      createdAt: ev.createdAt.toISOString(),
    }));
  } else {
    // Fallback: synthesize events from thesis rows (covers legacy runs
    // and completed agent runs that didn't write RunEvent rows)
    events = synthesizeEventsFromTheses(run.theses);
  }


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

      {/* Body — single-column chat */}
      <div className="flex-1 min-h-0">
        {useAgent ? (
          /* Real agent mode — LLM orchestrates research via tools */
          <AgentThread
            runId={id}
            analystName={analystName}
            analystId={run.agentConfig?.id}
            config={config}
            autoStart={run.status !== "COMPLETE" && !initialMessages}
            initialMessages={initialMessages}
          />
        ) : isStaleRun ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2 px-6">
            <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
            <p className="text-sm font-medium text-foreground">
              Run appears to have stalled
            </p>
            <p className="text-xs max-w-xs">
              This run started over 15 minutes ago but no events were recorded.
              The research service may have crashed before completing. You can
              try triggering a new run.
            </p>
          </div>
        ) : run.status === "RUNNING" ? (
          <RunLiveStream
            runId={id}
            userId={userId}
            analystName={analystName}
            config={config}
          />
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2">
            <p className="text-sm">No details available for this run.</p>
          </div>
        ) : (
          <RunUnifiedChat
            events={events}
            analystName={analystName}
            config={config}
            runContext={{
              analystName,
              config,
              theses: run.theses.map((t: typeof run.theses[number]) => ({
                ticker: t.ticker,
                direction: t.direction,
                confidence_score: t.confidenceScore,
                reasoning_summary: t.reasoningSummary ?? undefined,
                thesis_bullets: t.thesisBullets ?? [],
                risk_flags: t.riskFlags ?? [],
                entry_price: t.entryPrice,
                target_price: t.targetPrice,
                stop_loss: t.stopLoss,
                signal_types: t.signalTypes ?? [],
              })),
            }}
          />
        )}
      </div>
    </div>
  );
}
