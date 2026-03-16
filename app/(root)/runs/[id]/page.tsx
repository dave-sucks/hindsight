import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ArrowLeft, Bot, Clock, Sparkles } from "lucide-react";
import { AgentThread } from "@/components/research/AgentThread";
import { HowItWorksSheet } from "@/components/domain/how-it-works-sheet";
import { convertPersistedToUIMessages } from "@/lib/agent/convert-messages";
import type { UIMessage } from "ai";

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
      messages: {
        where: { role: "thread" },
        orderBy: { createdAt: "desc" },
        take: 1,
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
      ? "bg-positive"
      : run.status === "RUNNING"
      ? "bg-amber-500"
      : "bg-negative";

  // Extract config snapshot from the run parameters
  const config =
    run.parameters && typeof run.parameters === "object"
      ? (run.parameters as Record<string, unknown>)
      : {};

  // Parse persisted messages for completed runs
  let persistedMessages: UIMessage[] | null = null;
  if (run.status === "COMPLETE" && run.messages.length > 0) {
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

  return (
    <div className="flex flex-col h-[calc(100dvh-3rem)] overflow-hidden">
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

        <div className="flex items-center gap-2 ml-auto">
          <HowItWorksSheet flow="agent-run">
            <Sparkles className="h-3 w-3" />
            How it works
          </HowItWorksSheet>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            <Clock className="h-3 w-3" />
            <span>{startedAt}</span>
            {duration != null && <span>· {duration}s</span>}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0">
        {isLive || hasReplay ? (
          <AgentThread
            runId={id}
            analystName={analystName}
            analystId={run.agentConfig?.id}
            config={config}
            autoStart={isLive}
            initialMessages={persistedMessages ?? undefined}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2 px-6">
            <div className="h-2.5 w-2.5 rounded-full bg-negative" />
            <p className="text-sm font-medium text-foreground">
              No replay data available
            </p>
            <p className="text-xs max-w-xs">
              This run completed before message persistence was enabled.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
