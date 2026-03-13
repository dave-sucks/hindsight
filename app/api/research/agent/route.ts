import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { createResearchTools } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";

export const maxDuration = 120; // 2 min for multi-step agent

export async function POST(req: Request) {
  const t0 = Date.now();

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.warn("[agent] Unauthorized request");
    return new Response("Unauthorized", { status: 401 });
  }

  const { messages, runId, analystId, config } = await req.json();
  console.log(`[agent] POST runId=${runId} analystId=${analystId} messages=${messages?.length ?? 0}`);

  // Load agent config — try analystId first, then from the run's linked config
  let agentConfig: Record<string, unknown> = config || {};

  // Direct analystId takes priority
  if (analystId) {
    const ac = await prisma.agentConfig.findFirst({
      where: { id: analystId, userId: user.id },
    });
    if (ac) {
      agentConfig = {
        name: ac.name,
        analystPrompt: ac.analystPrompt,
        directionBias: ac.directionBias,
        holdDurations: ac.holdDurations,
        sectors: ac.sectors,
        signalTypes: ac.signalTypes,
        minConfidence: ac.minConfidence,
        maxPositionSize: ac.maxPositionSize ? Number(ac.maxPositionSize) : undefined,
        maxOpenPositions: ac.maxOpenPositions,
        watchlist: ac.watchlist,
        exclusionList: ac.exclusionList,
      };
    }
  }

  // Fall back to loading from the run's linked agentConfig
  if (!agentConfig.name && runId) {
    const run = await prisma.researchRun.findFirst({
      where: { id: runId, userId: user.id },
      include: { agentConfig: true },
    });
    if (run?.agentConfig) {
      agentConfig = {
        name: run.agentConfig.name,
        analystPrompt: run.agentConfig.analystPrompt,
        directionBias: run.agentConfig.directionBias,
        holdDurations: run.agentConfig.holdDurations,
        sectors: run.agentConfig.sectors,
        signalTypes: run.agentConfig.signalTypes,
        minConfidence: run.agentConfig.minConfidence,
        maxPositionSize: run.agentConfig.maxPositionSize
          ? Number(run.agentConfig.maxPositionSize)
          : undefined,
        maxOpenPositions: run.agentConfig.maxOpenPositions,
        watchlist: run.agentConfig.watchlist,
        exclusionList: run.agentConfig.exclusionList,
      };
    }
    if (run?.parameters && typeof run.parameters === "object") {
      const params = run.parameters as Record<string, unknown>;
      if (!agentConfig.name && params.analystName) {
        agentConfig.name = params.analystName;
      }
    }
  }

  const systemPrompt = buildSystemPrompt(agentConfig);
  const modelMessages = await convertToModelMessages(messages);
  console.log(`[agent] Config loaded: name=${agentConfig.name || "default"} systemPrompt=${systemPrompt.length} chars`);

  // Create context-aware tools so show_thesis persists and summarize_run completes
  const tools = createResearchTools({
    runId: runId || "",
    userId: user.id,
    watchlist: (agentConfig.watchlist as string[]) ?? [],
    exclusionList: (agentConfig.exclusionList as string[]) ?? [],
  });

  const result = streamText({
    model: openai("gpt-4o"),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(25),
    async onFinish({ response }) {
      const elapsed = Date.now() - t0;
      console.log(`[agent] onFinish runId=${runId} elapsed=${elapsed}ms responseMsgs=${response.messages.length}`);

      // Persist all messages from this exchange so the conversation can be replayed.
      if (!runId) return;
      try {
        const allMessages = [...messages, ...response.messages];
        await prisma.runMessage.deleteMany({ where: { runId } });
        await prisma.runMessage.create({
          data: {
            runId,
            role: "thread",
            content: JSON.stringify(allMessages),
          },
        });
        console.log(`[agent] Persisted ${allMessages.length} messages for runId=${runId}`);
      } catch (err) {
        console.error("[agent] Failed to persist messages:", err);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
