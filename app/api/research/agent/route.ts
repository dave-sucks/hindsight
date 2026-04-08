import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { createResearchTools } from "@/lib/agent/tools";
import { buildV2SystemPrompt } from "@/lib/agent/system-prompt";
import type { AgentConfigInput } from "@/lib/agent/system-prompt";
import { buildRunInput } from "@/lib/agent/run-input";
import { DEFAULT_INTELLIGENCE_POLICY } from "@/lib/intelligence/types";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { updateAnalystBriefing } from "@/lib/agent/update-analyst-briefing";

export const maxDuration = 300; // 5 min — agent makes 100+ API calls with retry logic

// Helper: mark a run as FAILED so it doesn't stay RUNNING forever.
// Uses atomic conditional update — only transitions RUNNING → FAILED.
// Cannot overwrite COMPLETE even under concurrent execution.
async function markRunFailed(runId: string | undefined, reason: string) {
  if (!runId) return;
  try {
    // Atomic: updateMany with status guard in WHERE clause.
    // Prisma's update() only filters by PK; updateMany supports arbitrary WHERE.
    // If status is already COMPLETE or FAILED, count = 0 and nothing changes.
    const result = await prisma.researchRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: { status: "FAILED", completedAt: new Date() },
    });
    if (result.count === 0) {
      console.log(`[agent] markRunFailed skipped: run ${runId} is not RUNNING (already terminal)`);
      return;
    }
    await prisma.runEvent.create({
      data: {
        runId,
        type: "run_error",
        title: "Run failed",
        message: reason.slice(0, 500),
        payload: { error: reason, timestamp: new Date().toISOString() } as object,
      },
    });
    console.error(`[agent] ❌ Run ${runId} marked FAILED: ${reason}`);
  } catch (dbErr) {
    console.error(`[agent] ❌ Failed to mark run ${runId} as FAILED:`, dbErr);
  }
}

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

  let runId: string | undefined;
  let analystId: string | undefined;

  try {
    const body = await req.json();
    const messages = body.messages;
    runId = body.runId;
    analystId = body.analystId;
    const config = body.config;

    console.log(`[agent] POST runId=${runId} analystId=${analystId} messages=${messages?.length ?? 0}`);

    // ── Load analyst config ─────────────────────────────────────────────
    let agentConfig: AgentConfigInput = config || {};

    // Resolve analyst ID: direct analystId > run's linked config
    const resolvedAnalystId = analystId || (runId ? (await prisma.researchRun.findFirst({
      where: { id: runId },
      select: { agentConfigId: true },
    }))?.agentConfigId : null);

    if (resolvedAnalystId) {
      const ac = await prisma.agentConfig.findFirst({
        where: { id: resolvedAnalystId, userId: user.id },
      });
      if (ac) {
        agentConfig = {
          name: ac.name,
          analystPrompt: ac.analystPrompt ?? undefined,
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

    // Fall back to run parameters for name
    if (!agentConfig.name && runId) {
      const run = await prisma.researchRun.findFirst({
        where: { id: runId, userId: user.id },
        select: { parameters: true },
      });
      if (run?.parameters && typeof run.parameters === "object") {
        const params = run.parameters as Record<string, unknown>;
        if (params.analystName) {
          agentConfig.name = params.analystName as string;
        }
      }
    }

    // ── Resolve per-user Alpaca credentials (falls back to env vars) ────
    const alpacaCreds = await resolveAlpacaCredentials(user.id) ?? undefined;

    // ── Build structured run input + system prompt ────────────────────────
    const runInput = resolvedAnalystId
      ? await buildRunInput(resolvedAnalystId, user.id, alpacaCreds)
      : null;

    if (runInput) {
      console.log(`[agent] RUN INPUT: positions=${runInput.portfolio.positions.length} watchlist=${runInput.watchlist.length} theses=${runInput.activeTheses.length} hasBrief=${!!runInput.priorBrief} hasPerformance=${!!runInput.performance} cash=$${runInput.portfolio.cash.toFixed(0)} buyingPower=$${runInput.portfolio.buyingPower.toFixed(0)} closedTrades=${runInput.recentClosedTrades.length}`);
    } else {
      console.warn(`[agent] NO RUN INPUT — resolvedAnalystId=${resolvedAnalystId}. Agent will run with empty context.`);
    }

    const systemPrompt = runInput
      ? buildV2SystemPrompt(agentConfig, runInput)
      : buildV2SystemPrompt(agentConfig, {
          analyst: {
            name: (agentConfig.name as string) || "Research Analyst",
            mandate: (agentConfig.analystPrompt as string) || null,
            voice: null,
            directionBias: (agentConfig.directionBias as string) || "BOTH",
            holdDurations: (agentConfig.holdDurations as string[]) || ["SWING"],
            sectors: (agentConfig.sectors as string[]) || [],
            exclusionList: (agentConfig.exclusionList as string[]) || [],
            minConfidence: (agentConfig.minConfidence as number) ?? 60,
            maxPositionSize: (agentConfig.maxPositionSize as number) ?? 10000,
            maxOpenPositions: (agentConfig.maxOpenPositions as number) ?? 5,
          },
          portfolio: { cash: 0, buyingPower: 0, portfolioValue: 0, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
          watchlist: [],
          activeTheses: [],
          priorBrief: null,
          performance: null,
          recentClosedTrades: [],
          intelligencePolicy: DEFAULT_INTELLIGENCE_POLICY,
        });

    const modelMessages = await convertToModelMessages(messages);
    console.log(`[agent] Config loaded: name=${agentConfig.name || "default"} analystId=${resolvedAnalystId} systemPrompt=${systemPrompt.length} chars`);

    // Create context-aware tools
    const tools = createResearchTools({
      runId: runId || "",
      userId: user.id,
      analystId: resolvedAnalystId || undefined,
      watchlist: (agentConfig.watchlist as string[]) ?? [],
      exclusionList: (agentConfig.exclusionList as string[]) ?? [],
      sectors: (agentConfig.sectors as string[]) ?? [],
      maxPositionSize: (agentConfig.maxPositionSize as number) ?? undefined,
      maxOpenPositions: (agentConfig.maxOpenPositions as number) ?? undefined,
      alpacaCreds,
      intelligencePolicy: runInput?.intelligencePolicy,
    });

    const result = streamText({
      model: openai("gpt-4.1"),
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(30),
      onStepFinish({ stepNumber, toolCalls, text, finishReason, usage }) {
        const elapsed = Date.now() - t0;
        const ts = new Date().toISOString().slice(11, 23);
        const toolNames = toolCalls.map((tc) => tc.toolName).join(", ") || "none";
        const textPreview = text?.slice(0, 100)?.replace(/\n/g, " ") || "";
        console.log(
          `[agent] ${ts} STEP #${stepNumber} runId=${runId} elapsed=${elapsed}ms tools=[${toolNames}] finish=${finishReason} tokens=${usage?.totalTokens ?? "?"} text="${textPreview}${text && text.length > 100 ? "..." : ""}"`
        );
        // Warn if approaching the function timeout
        if (elapsed > 240_000) {
          console.warn(`[agent] ⚠️ TIMEOUT WARNING: step #${stepNumber} at ${(elapsed / 1000).toFixed(0)}s — function limit is 300s. Run ${runId} may be killed soon.`);
        }
      },
      onError({ error }) {
        const elapsed = Date.now() - t0;
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[agent] ❌ STREAM ERROR runId=${runId} elapsed=${elapsed}ms: ${msg}`);
        // Mark the run as FAILED so it doesn't stay RUNNING forever
        waitUntil(markRunFailed(runId, `Stream error after ${(elapsed / 1000).toFixed(0)}s: ${msg}`));
      },
      async onFinish({ response, finishReason, usage }) {
        const elapsed = Date.now() - t0;
        console.log(`[agent] ✅ onFinish runId=${runId} elapsed=${elapsed}ms reason=${finishReason} totalTokens=${usage?.totalTokens ?? "?"} responseMsgs=${response.messages.length}`);

        if (!runId) return;

        // ── 1. Ensure run is not stuck RUNNING ──────────────────────────────
        // If the agent hit the step limit, errored, or stopped without calling
        // complete_run, the run stays RUNNING forever. Fix it here.
        // Check if any work was done (theses or trades)
        const [thesisCount, tradeCount] = await Promise.all([
          prisma.thesis.count({ where: { researchRunId: runId } }),
          prisma.tradeDecision.count({ where: { runId } }),
        ]);
        const hasWork = thesisCount > 0 || tradeCount > 0;
        const finalStatus = hasWork ? "COMPLETE" : "FAILED";
        // Atomic: only transition RUNNING → terminal. If complete_run already
        // marked it COMPLETE, this is a no-op (count = 0).
        const stuckResult = await prisma.researchRun.updateMany({
          where: { id: runId, status: "RUNNING" },
          data: { status: finalStatus, completedAt: new Date() },
        });
        if (stuckResult.count > 0) {
          console.warn(`[agent] ⚠️ Run ${runId} was still RUNNING after onFinish (reason=${finishReason}). Marked ${finalStatus} (theses=${thesisCount}, trades=${tradeCount}).`);
        }

        // ── 2. Persist messages (atomic — old messages preserved on failure) ──
        try {
          const allMessages = [...messages, ...response.messages];
          if (runId) {
            const safeRunId = runId;
            await prisma.$transaction(async (tx) => {
              await tx.runMessage.deleteMany({ where: { runId: safeRunId } });
              await tx.runMessage.create({
                data: {
                  runId: safeRunId,
                  role: "thread",
                  content: JSON.stringify(allMessages),
                },
              });
            });
          }
          console.log(`[agent] Persisted ${allMessages.length} messages for runId=${runId}`);
        } catch (err) {
          console.error("[agent] Failed to persist messages:", err);
        }

        // ── 3. Safety net: fire Inngest event for runs that didn't call complete_run
        // The primary briefing path is inside the complete_run tool itself (direct call).
        // This only matters if the agent was killed before calling complete_run but
        // we still marked it COMPLETE above (had partial work).
        const updatedRun = await prisma.researchRun.findFirst({
          where: { id: runId },
          select: { status: true },
        });
        if (updatedRun?.status !== "COMPLETE") {
          console.log(`[agent] Run ${runId} is ${updatedRun?.status ?? "unknown"} — skipping briefing`);
          return;
        }

        // Check if briefing was already written by complete_run
        const existingBriefing = await prisma.analystBriefing.findFirst({
          where: { runId },
          select: { id: true },
        });
        if (existingBriefing) {
          console.log(`[agent] Briefing already exists for run ${runId} — skipping`);
          return;
        }

        // No briefing yet — agent didn't call complete_run but we marked it COMPLETE.
        // Generate briefing directly here.
        const runForBriefing = !analystId
          ? await prisma.researchRun.findFirst({ where: { id: runId }, select: { agentConfigId: true } })
          : null;
        const briefingAnalystId = analystId || runForBriefing?.agentConfigId || null;
        if (briefingAnalystId) {
          try {
            console.log(`[agent] No briefing from complete_run — generating in onFinish for run ${runId}`);
            await updateAnalystBriefing({ analystId: briefingAnalystId, runId, userId: user.id });
            console.log(`[agent] ✅ Briefing written in onFinish for run ${runId}`);
          } catch (err) {
            console.error(`[agent] Briefing failed in onFinish for run ${runId}:`, err);
          }
        } else {
          console.warn(`[agent] No analystId found for run ${runId} — briefing skipped`);
        }
      },
    });

    // Register the stream's completion promise with waitUntil so Vercel keeps
    // the function alive for onFinish (message persistence + briefing generation)
    // after the streaming response is sent to the client.
    waitUntil(Promise.resolve(result.response));

    return result.toUIMessageStreamResponse();
  } catch (err) {
    // Catch-all for any unhandled errors in the route handler
    const elapsed = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[agent] ❌ UNHANDLED ERROR runId=${runId} elapsed=${elapsed}ms: ${msg}`, err);
    waitUntil(markRunFailed(runId, `Unhandled route error after ${(elapsed / 1000).toFixed(0)}s: ${msg}`));
    return new Response(`Agent error: ${msg}`, { status: 500 });
  }
}
