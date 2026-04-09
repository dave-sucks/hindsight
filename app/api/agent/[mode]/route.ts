/**
 * Unified agent route — handles research-run, builder, and editor modes.
 *
 * GET /api/agent/research-run → live agent run (replaces /api/research/agent)
 * GET /api/agent/builder      → analyst builder chat (replaces /api/chat/analyst-builder)
 * GET /api/agent/editor       → analyst editor chat (replaces /api/chat/analyst-editor)
 *
 * Mode config (model, step limit, tool set) lives in lib/agent/modes.ts.
 * System prompts live there too. The route just assembles and streams.
 */

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
import { MODES, BUILDER_SYSTEM_PROMPT, buildEditorSystemPrompt } from "@/lib/agent/modes";
import type { AgentMode } from "@/lib/agent/modes";
import { suggestConfigTool } from "@/lib/agent/tools/suggest-config";

// Vercel function timeout is set per-mode via route segment config.
// For the dynamic catch-all, we use the research-run limit (longest).
export const maxDuration = 300;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function markRunFailed(runId: string | undefined, reason: string) {
  if (!runId) return;
  try {
    const result = await prisma.researchRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: { status: "FAILED", completedAt: new Date() },
    });
    if (result.count === 0) return;
    await prisma.runEvent.create({
      data: {
        runId,
        type: "run_error",
        title: "Run failed",
        message: reason.slice(0, 500),
        payload: { error: reason, timestamp: new Date().toISOString() } as object,
      },
    });
    console.error(`[agent/${runId}] ❌ Marked FAILED: ${reason}`);
  } catch (dbErr) {
    console.error(`[agent] Failed to mark run failed:`, dbErr);
  }
}

// ── Route ────────────────────────────────────────────────────────────────────

export async function POST(
  req: Request,
  { params }: { params: Promise<{ mode: string }> },
) {
  const t0 = Date.now();
  const { mode } = await params;

  if (!["research-run", "builder", "editor"].includes(mode)) {
    return new Response(`Unknown mode: ${mode}`, { status: 400 });
  }

  const agentMode = mode as AgentMode;
  const modeConfig = MODES[agentMode];

  // ── Auth ─────────────────────────────────────────────────────────────────

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let runId: string | undefined;
  let resolvedAnalystId: string | undefined;

  try {
    const body = await req.json();
    const messages = body.messages;
    runId = body.runId;
    const analystId: string | undefined = body.analystId;
    const config: Record<string, unknown> | undefined = body.config;
    const currentConfig: Record<string, unknown> | undefined = body.currentConfig;

    console.log(
      `[agent/${agentMode}] POST runId=${runId} analystId=${analystId} messages=${messages?.length ?? 0}`,
    );

    // ── Alpaca credentials ──────────────────────────────────────────────────

    const alpacaCreds = (await resolveAlpacaCredentials(user.id)) ?? undefined;

    // ── System prompt + tools ──────────────────────────────────────────────

    let systemPrompt: string;
    let agentConfig: AgentConfigInput = (config as AgentConfigInput) || {};

    if (agentMode === "research-run") {
      // Load analyst config from DB
      resolvedAnalystId =
        analystId ||
        (runId
          ? (
              await prisma.researchRun.findFirst({
                where: { id: runId },
                select: { agentConfigId: true },
              })
            )?.agentConfigId ?? undefined
          : undefined);

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

      const runInput = resolvedAnalystId
        ? await buildRunInput(resolvedAnalystId, user.id, alpacaCreds)
        : null;

      if (runInput) {
        console.log(
          `[agent/${agentMode}] positions=${runInput.portfolio.positions.length} watchlist=${runInput.watchlist.length} hasBrief=${!!runInput.priorBrief}`,
        );
      }

      systemPrompt = runInput
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

    } else if (agentMode === "builder") {
      systemPrompt = BUILDER_SYSTEM_PROMPT;
      if (currentConfig) {
        systemPrompt += `\n\n## Current Configuration (user is editing an existing analyst)\n\`\`\`json\n${JSON.stringify(currentConfig, null, 2)}\n\`\`\`\nThe user wants to modify this analyst. Only change what they ask for. Call suggest_config with the full updated config.`;
      }
      resolvedAnalystId = undefined;

    } else {
      // editor
      systemPrompt = buildEditorSystemPrompt(currentConfig ?? {});
      resolvedAnalystId = analystId;
    }

    // ── Build tools ─────────────────────────────────────────────────────────

    const allTools = createResearchTools({
      runId: runId || agentMode,
      userId: user.id,
      analystId: resolvedAnalystId,
      watchlist: (agentConfig.watchlist as string[]) ?? [],
      exclusionList: (agentConfig.exclusionList as string[]) ?? [],
      sectors: (agentConfig.sectors as string[]) ?? [],
      maxPositionSize: (agentConfig.maxPositionSize as number) ?? undefined,
      maxOpenPositions: (agentConfig.maxOpenPositions as number) ?? undefined,
      alpacaCreds,
    });

    // Filter by allowlist if mode restricts tools
    const filteredTools = modeConfig.toolAllowlist
      ? Object.fromEntries(
          modeConfig.toolAllowlist
            .map((name) => [name, allTools[name as keyof typeof allTools]])
            .filter(([, v]) => v != null),
        )
      : allTools;

    const tools = modeConfig.hasSuggestConfig
      ? { ...filteredTools, suggest_config: suggestConfigTool }
      : filteredTools;

    // ── Stream ──────────────────────────────────────────────────────────────

    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: openai(modeConfig.model),
      system: systemPrompt,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(modeConfig.maxSteps),

      onStepFinish({ stepNumber, toolCalls, text, finishReason, usage }) {
        const elapsed = Date.now() - t0;
        const toolNames = toolCalls.map((tc) => tc.toolName).join(", ") || "none";
        console.log(
          `[agent/${agentMode}] STEP #${stepNumber} elapsed=${elapsed}ms tools=[${toolNames}] finish=${finishReason} tokens=${usage?.totalTokens ?? "?"}`,
        );
        if (agentMode === "research-run" && elapsed > 240_000) {
          console.warn(
            `[agent/${agentMode}] ⚠️ TIMEOUT WARNING: step #${stepNumber} at ${(elapsed / 1000).toFixed(0)}s`,
          );
        }
      },

      onError({ error }) {
        const elapsed = Date.now() - t0;
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[agent/${agentMode}] ❌ STREAM ERROR elapsed=${elapsed}ms: ${msg}`);
        if (agentMode === "research-run") {
          waitUntil(markRunFailed(runId, `Stream error after ${(elapsed / 1000).toFixed(0)}s: ${msg}`));
        }
      },

      async onFinish({ response, finishReason, usage }) {
        const elapsed = Date.now() - t0;
        console.log(
          `[agent/${agentMode}] ✅ onFinish elapsed=${elapsed}ms reason=${finishReason} tokens=${usage?.totalTokens ?? "?"}`,
        );

        // Only persist messages and handle run lifecycle for research-run
        if (agentMode !== "research-run" || !runId) return;

        // Ensure stuck RUNNING runs get a terminal status
        const [thesisCount, tradeCount] = await Promise.all([
          prisma.thesis.count({ where: { researchRunId: runId } }),
          prisma.tradeDecision.count({ where: { runId } }),
        ]);
        const hasWork = thesisCount > 0 || tradeCount > 0;
        const finalStatus = hasWork ? "COMPLETE" : "FAILED";
        const stuckResult = await prisma.researchRun.updateMany({
          where: { id: runId, status: "RUNNING" },
          data: { status: finalStatus, completedAt: new Date() },
        });
        if (stuckResult.count > 0) {
          console.warn(
            `[agent/${agentMode}] ⚠️ Run ${runId} was RUNNING after finish. Marked ${finalStatus}.`,
          );
        }

        // Persist messages
        try {
          const allMessages = [...messages, ...response.messages];
          await prisma.$transaction(async (tx) => {
            await tx.runMessage.deleteMany({ where: { runId: runId! } });
            await tx.runMessage.create({
              data: {
                runId: runId!,
                role: "thread",
                content: JSON.stringify(allMessages),
              },
            });
          });
          console.log(`[agent/${agentMode}] Persisted ${allMessages.length} messages`);
        } catch (err) {
          console.error(`[agent/${agentMode}] Failed to persist messages:`, err);
        }

        // Generate briefing if complete_run didn't
        const updatedRun = await prisma.researchRun.findFirst({
          where: { id: runId },
          select: { status: true },
        });
        if (updatedRun?.status !== "COMPLETE") return;

        const existingBriefing = await prisma.analystBriefing.findFirst({
          where: { runId },
          select: { id: true },
        });
        if (existingBriefing) return;

        const briefingAnalystId = resolvedAnalystId;
        if (briefingAnalystId) {
          try {
            await updateAnalystBriefing({ analystId: briefingAnalystId, runId, userId: user.id });
            console.log(`[agent/${agentMode}] ✅ Briefing written for run ${runId}`);
          } catch (err) {
            console.error(`[agent/${agentMode}] Briefing failed:`, err);
          }
        }
      },
    });

    if (agentMode === "research-run") {
      waitUntil(Promise.resolve(result.response));
    }

    return result.toUIMessageStreamResponse();
  } catch (err) {
    const elapsed = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[agent/${agentMode}] ❌ UNHANDLED ERROR elapsed=${elapsed}ms: ${msg}`);
    if (agentMode === "research-run") {
      waitUntil(markRunFailed(runId, `Route error: ${msg}`));
    }
    return new Response(`Agent error: ${msg}`, { status: 500 });
  }
}
