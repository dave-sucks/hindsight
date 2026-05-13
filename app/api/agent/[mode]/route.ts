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

import { streamText, convertToModelMessages, stepCountIs, hasToolCall } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { createResearchTools } from "@/lib/agent/tools";
import { buildV2SystemPrompt } from "@/lib/agent/system-prompt";
import type { AgentConfigInput } from "@/lib/agent/system-prompt";
import { buildRunInput } from "@/lib/agent/run-input";
import { DEFAULT_INTELLIGENCE_POLICY } from "@/lib/intelligence/types";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { updateAnalystBriefing } from "@/lib/agent/update-analyst-briefing";
import { MODES, BUILDER_SYSTEM_PROMPT, buildEditorSystemPrompt, buildPrincipalSystemPrompt } from "@/lib/agent/modes";
import type { AgentMode } from "@/lib/agent/modes";
import { suggestConfigTool } from "@/lib/agent/tools/suggest-config";
import { suggestPodcastConfigTool } from "@/lib/agent/tools/suggest-podcast-config";
import { PODCAST_BUILDER_SYSTEM_PROMPT } from "@/lib/podcast/builder-prompt";
import { buildPodcastSegmentRunPrompt } from "@/lib/podcast/segment-run-prompt";
import {
  buildPodcastEditorSystemPrompt,
  type EditorCurrentPodcast,
  type EditorCurrentSegment,
} from "@/lib/podcast/editor-prompt";

// Vercel function timeout is set per-mode via route segment config.
// For the dynamic catch-all, we use the research-run limit (longest).
export const maxDuration = 300;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strips tool result payloads down to their summary string before the
 * messages are converted and sent to the model. The full data object
 * stays on the client for UI rendering — the model only needs the
 * one-line summary to continue reasoning. Prevents accumulated tool
 * results from blowing up the input token count over a long run.
 */
function trimToolResults(messages: unknown[]): unknown[] {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg) => {
    const m = msg as Record<string, unknown>;
    if (!Array.isArray(m.parts)) return msg;
    const parts = (m.parts as unknown[]).map((part) => {
      const p = part as Record<string, unknown>;
      if (p.type !== "tool-result") return part;
      const result = p.result as Record<string, unknown> | undefined;
      if (!result || typeof result.summary !== "string") return part;
      return { ...p, result: { summary: result.summary } };
    });
    return { ...m, parts };
  });
}

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

  if (
    ![
      "research-run",
      "builder",
      "editor",
      "principal",
      "podcast-builder",
      "podcast-segment-run",
      "podcast-editor",
    ].includes(mode)
  ) {
    return new Response(`Unknown mode: ${mode}`, { status: 400 });
  }

  const agentMode = mode as AgentMode;
  const modeConfig = MODES[agentMode];

  // ── Auth ─────────────────────────────────────────────────────────────────

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const accountId = await getAccountId(user.id);
  if (!accountId) return new Response("No account", { status: 403 });

  // research-run + podcast-segment-run actually mutate (place_trade /
  // record_thesis / write_segment_transcript). Builder/editor modes
  // are read-only — they suggest configs but never persist. Gate
  // VIEWER on the mutating subset. (`tactical` mode is internal-only
  // and doesn't enter via this route.)
  if (agentMode === "research-run" || agentMode === "podcast-segment-run") {
    const role = await getUserRole(user.id, accountId);
    if (role === "VIEWER") return new Response("Forbidden", { status: 403 });
  }

  let runId: string | undefined;
  let resolvedAnalystId: string | undefined;
  // Podcast feature — set when the route is handling a podcast-segment-run.
  // Threaded into ToolContext so write_segment_transcript and the podcast
  // branch of complete_run know which segment to attribute the run to.
  let resolvedPodcastSegmentId: string | undefined;

  try {
    const body = await req.json();
    const messages = body.messages;
    runId = body.runId;
    const analystId: string | undefined = body.analystId;
    const config: Record<string, unknown> | undefined = body.config;
    const currentConfig: Record<string, unknown> | undefined = body.currentConfig;
    const modelOverride: string | undefined = body.modelOverride;

    console.log(
      `[agent/${agentMode}] POST runId=${runId} analystId=${analystId} messages=${messages?.length ?? 0}${modelOverride ? ` model=${modelOverride}` : ""}`,
    );

    // ── Run environment + Alpaca credentials ───────────────────────────────
    // Must resolve env BEFORE creds: a LIVE run reads from a different
    // UserApiKey row than a PAPER run. Source of truth is ResearchRun.environment
    // (snapshot at run-create time) when a run row exists; otherwise default
    // PAPER. Builder/editor/podcast modes don't trade and stay PAPER.

    let runEnvironment: "PAPER" | "LIVE" = "PAPER";
    if (runId) {
      const runRow = await prisma.researchRun.findFirst({
        where: { id: runId },
        select: { environment: true, agentConfigId: true },
      });
      if (runRow) {
        runEnvironment = (runRow.environment as "PAPER" | "LIVE") ?? "PAPER";
      }
    }

    const alpacaCreds =
      (await resolveAlpacaCredentials(user.id, runEnvironment)) ?? undefined;

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
          where: { id: resolvedAnalystId, accountId },
        });
        if (ac) {
          agentConfig = {
            name: ac.name,
            analystPrompt: ac.analystPrompt ?? undefined,
            directionBias: ac.directionBias,
            holdDurations: ac.holdDurations,
            sectors: ac.sectors,
            // ── Universe (B1) ─────────────────────────────────────────
            industries: ac.industries,
            themes: ac.themes,
            marketCapMin: ac.marketCapMin != null ? Number(ac.marketCapMin) : null,
            marketCapMax: ac.marketCapMax != null ? Number(ac.marketCapMax) : null,
            signalTypes: ac.signalTypes,
            minConfidence: ac.minConfidence,
            maxPositionSize: ac.maxPositionSize ? Number(ac.maxPositionSize) : undefined,
            realMaxPosition: ac.realMaxPosition ? Number(ac.realMaxPosition) : undefined,
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
          `[agent/${agentMode}] positions=${runInput.portfolio.positions.length} watchlist=${runInput.watchlist.length} theses=${runInput.activeTheses.length}`,
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
              industries: (agentConfig.industries as string[]) || [],
              themes: (agentConfig.themes as string[]) || [],
              marketCapMin: (agentConfig.marketCapMin as number | null) ?? null,
              marketCapMax: (agentConfig.marketCapMax as number | null) ?? null,
              exclusionList: (agentConfig.exclusionList as string[]) || [],
              minConfidence: (agentConfig.minConfidence as number) ?? 60,
              maxPositionSize: (agentConfig.maxPositionSize as number) ?? 10000,
              maxOpenPositions: (agentConfig.maxOpenPositions as number) ?? 5,
            },
            portfolio: { cash: 0, buyingPower: 0, portfolioValue: 0, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
            watchlist: [],
            activeTheses: [],
            performance: null,
            recentClosedTrades: [],
            priorityReviews: null,
            triggersFiredSinceLastRun: [],
            triggersMatchingNow: [],
            latestBriefing: null,
            intelligencePolicy: DEFAULT_INTELLIGENCE_POLICY,
          });

    } else if (agentMode === "builder") {
      systemPrompt = BUILDER_SYSTEM_PROMPT;
      if (currentConfig) {
        systemPrompt += `\n\n## Current Configuration (user is editing an existing analyst)\n\`\`\`json\n${JSON.stringify(currentConfig, null, 2)}\n\`\`\`\nThe user wants to modify this analyst. Only change what they ask for. Call suggest_config with the full updated config.`;
      }
      resolvedAnalystId = undefined;

    } else if (agentMode === "principal") {
      // Principal chat — the operator co-pilot. Two scopes:
      //   • UNSCOPED (no analystId on body): portfolio-wide reads. No
      //     ResearchRun row; writes that FK into runId will fail.
      //   • SCOPED (body.analystId present): chat is pinned to one
      //     analyst. Route creates a ResearchRun(mode=PRINCIPAL_CHAT,
      //     agentConfigId=<id>) so every write tool's runId FK works the
      //     same way it does in the daily run. Analyst config + watchlist
      //     + position tickers + intelligence policy flow through ctx.
      resolvedAnalystId = analystId;

      let scopedAnalyst: Parameters<typeof buildPrincipalSystemPrompt>[0]["scopedAnalyst"] = null;
      if (resolvedAnalystId) {
        const ac = await prisma.agentConfig.findFirst({
          where: { id: resolvedAnalystId, userId: user.id },
        });
        if (!ac) {
          return new Response(
            `Analyst ${resolvedAnalystId} not found or not yours.`,
            { status: 404 },
          );
        }
        // Hydrate agentConfig for tool guardrails (place_trade etc.).
        agentConfig = {
          name: ac.name,
          analystPrompt: ac.analystPrompt ?? undefined,
          directionBias: ac.directionBias,
          holdDurations: ac.holdDurations,
          sectors: ac.sectors,
          industries: ac.industries,
          themes: ac.themes,
          marketCapMin: ac.marketCapMin != null ? Number(ac.marketCapMin) : null,
          marketCapMax: ac.marketCapMax != null ? Number(ac.marketCapMax) : null,
          signalTypes: ac.signalTypes,
          minConfidence: ac.minConfidence,
          maxPositionSize: ac.maxPositionSize ? Number(ac.maxPositionSize) : undefined,
          maxOpenPositions: ac.maxOpenPositions,
          watchlist: ac.watchlist,
          exclusionList: ac.exclusionList,
        };
        scopedAnalyst = {
          id: ac.id,
          name: ac.name,
          analystPrompt: ac.analystPrompt ?? null,
          directionBias: ac.directionBias,
          holdDurations: ac.holdDurations,
          sectors: ac.sectors,
          industries: ac.industries,
          themes: ac.themes,
          feeds: ac.feeds,
          watchlist: ac.watchlist,
          exclusionList: ac.exclusionList,
          minConfidence: ac.minConfidence,
          maxPositionSize: ac.maxPositionSize ? Number(ac.maxPositionSize) : 0,
          maxOpenPositions: ac.maxOpenPositions,
        };
        // Create or reuse a PRINCIPAL_CHAT ResearchRun for this scoped
        // session. If the client already passed a runId, reuse it
        // (subsequent messages in the same chat). Otherwise mint one.
        if (runId) {
          const existing = await prisma.researchRun.findFirst({
            where: {
              id: runId,
              userId: user.id,
              mode: "PRINCIPAL_CHAT",
            },
            select: { id: true, status: true },
          });
          if (!existing) {
            // Stale or foreign runId — mint a fresh one and let the
            // client re-sync on next render.
            runId = undefined;
          } else if (existing.status !== "RUNNING") {
            await prisma.researchRun.update({
              where: { id: runId },
              data: { status: "RUNNING" },
            });
          }
        }
        if (!runId) {
          const newRun = await prisma.researchRun.create({
            data: {
              userId: user.id,
              agentConfig: { connect: { id: resolvedAnalystId } },
              source: "MANUAL",
              status: "RUNNING",
              mode: "PRINCIPAL_CHAT",
              parameters: {} as object,
            },
            select: { id: true },
          });
          runId = newRun.id;
        }
      } else {
        // Unscoped — no ResearchRun, no runId. Write tools will fail
        // cleanly; reads work freely.
        runId = undefined;
      }

      systemPrompt = buildPrincipalSystemPrompt({ scopedAnalyst });

    } else if (agentMode === "podcast-builder") {
      systemPrompt = PODCAST_BUILDER_SYSTEM_PROMPT;
      resolvedAnalystId = undefined;

    } else if (agentMode === "podcast-editor") {
      // The edit page passes the podcast id on body.podcastId AND a
      // currentConfig blob mirroring the builder shape. We re-load the
      // canonical state from the DB so the prompt sees authoritative
      // segments + monitors, not a stale client snapshot.
      const podcastId: string | undefined = body.podcastId;
      if (!podcastId) {
        return new Response(
          "podcast-editor requires a podcastId on the request body.",
          { status: 400 },
        );
      }
      const podcast = await prisma.podcast.findFirst({
        where: { id: podcastId, accountId },
        include: {
          segments: {
            orderBy: { orderIndex: "asc" },
            include: {
              monitors: {
                select: { id: true, name: true, type: true, config: true },
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      });
      if (!podcast) {
        return new Response("Podcast not found.", { status: 404 });
      }
      const editorPodcast: EditorCurrentPodcast = {
        id: podcast.id,
        name: podcast.name,
        description: podcast.description,
        hostStyle: podcast.hostStyle,
        cadence: podcast.cadence,
      };
      const editorSegments: EditorCurrentSegment[] = podcast.segments.map((s) => {
        const domainMonitors: Array<{ name: string; domain: string }> = [];
        const searchMonitors: Array<{ name: string; query: string }> = [];
        for (const m of s.monitors) {
          const cfg = (m.config as Record<string, unknown> | null) ?? {};
          if (m.type === "DOMAIN" && typeof cfg.domain === "string") {
            domainMonitors.push({ name: m.name, domain: cfg.domain });
          } else if (m.type === "SEARCH" && typeof cfg.query === "string") {
            searchMonitors.push({ name: m.name, query: cfg.query });
          }
        }
        return {
          id: s.id,
          name: s.name,
          description: s.description,
          segmentPrompt: s.segmentPrompt,
          targetSeconds: s.targetSeconds,
          topics: s.topics,
          excludeTopics: s.excludeTopics,
          enabled: s.enabled,
          domainMonitors,
          searchMonitors,
        };
      });
      systemPrompt = buildPodcastEditorSystemPrompt(editorPodcast, editorSegments);
      resolvedAnalystId = undefined;

    } else if (agentMode === "podcast-segment-run") {
      // Resolve segment from runId or body. Mirrors the research-run flow,
      // but uses podcastSegmentId instead of agentConfigId.
      const bodySegmentId: string | undefined = body.podcastSegmentId;
      resolvedPodcastSegmentId =
        bodySegmentId ||
        (runId
          ? (
              await prisma.researchRun.findFirst({
                where: { id: runId },
                select: { podcastSegmentId: true },
              })
            )?.podcastSegmentId ?? undefined
          : undefined);

      if (!resolvedPodcastSegmentId) {
        return new Response(
          "podcast-segment-run requires a podcastSegmentId (via body or via the run row).",
          { status: 400 },
        );
      }

      const segment = await prisma.podcastSegment.findFirst({
        where: { id: resolvedPodcastSegmentId, accountId },
        include: { podcast: true },
      });
      if (!segment) {
        return new Response("Podcast segment not found.", { status: 404 });
      }

      // Last transcript title + most-recent briefing for continuity.
      // Mirror of how analyst runs load AnalystBriefing into buildRunInput.
      // Briefing fetch is wrapped in try/catch so a missing table (migration
      // lag during deploy) degrades to "no continuity" instead of crashing
      // the run. Segment table is required — if that's missing we have
      // bigger problems and the segment lookup above will already have
      // failed.
      const lastTranscript = await prisma.segmentTranscript.findFirst({
        where: { segmentId: segment.id },
        orderBy: { createdAt: "desc" },
        select: { title: true },
      });
      let priorBriefing: {
        narrative: string;
        followUps: unknown;
        generatedAt: Date;
      } | null = null;
      try {
        priorBriefing = await prisma.podcastSegmentBriefing.findFirst({
          where: { segmentId: segment.id },
          orderBy: { generatedAt: "desc" },
          select: { narrative: true, followUps: true, generatedAt: true },
        });
      } catch (briefErr) {
        console.warn(
          `[agent/podcast-segment-run] briefing lookup failed (likely migration lag) — continuing without continuity context:`,
          briefErr instanceof Error ? briefErr.message : briefErr,
        );
      }

      systemPrompt = buildPodcastSegmentRunPrompt({
        podcast: {
          name: segment.podcast.name,
          description: segment.podcast.description,
          hostStyle: segment.podcast.hostStyle,
          cadence: segment.podcast.cadence,
        },
        segment: {
          name: segment.name,
          description: segment.description,
          segmentPrompt: segment.segmentPrompt,
          targetSeconds: segment.targetSeconds,
          topics: segment.topics,
          excludeTopics: segment.excludeTopics,
        },
        lastTranscriptTitle: lastTranscript?.title ?? null,
        priorBriefing: priorBriefing
          ? {
              narrative: priorBriefing.narrative,
              followUps: Array.isArray(priorBriefing.followUps)
                ? (priorBriefing.followUps as Array<{
                    topic: string;
                    why: string;
                    priority: "HIGH" | "NORMAL";
                  }>)
                : [],
              generatedAt: priorBriefing.generatedAt,
            }
          : null,
      });
      // Segment runs don't carry an analystId.
      resolvedAnalystId = undefined;

    } else {
      // editor
      systemPrompt = buildEditorSystemPrompt(currentConfig ?? {});
      resolvedAnalystId = analystId;
    }

    // ── Build tools ─────────────────────────────────────────────────────────

    // Open positions attributed to this analyst — fed to get_stock_data so
    // the universe check short-circuits to in-scope for held tickers. Without
    // this, a ticker held by an analyst whose sector fence doesn't exactly
    // match Finnhub's reported sector gets flagged "outside universe" and
    // quietly dropped from analysis.
    const positionTickers = resolvedAnalystId
      ? (
          await prisma.position.findMany({
            where: {
              accountId,
              analystId: resolvedAnalystId,
              status: "OPEN",
            },
            select: { symbol: true },
            distinct: ["symbol"],
          })
        ).map((p) => p.symbol)
      : [];

    const allTools = createResearchTools({
      runId: runId || agentMode,
      userId: user.id,
      accountId,
      analystId: resolvedAnalystId,
      podcastSegmentId: resolvedPodcastSegmentId,
      watchlist: (agentConfig.watchlist as string[]) ?? [],
      positionTickers,
      exclusionList: (agentConfig.exclusionList as string[]) ?? [],
      sectors: (agentConfig.sectors as string[]) ?? [],
      // ── Universe (B1) ─────────────────────────────────────────────
      industries: (agentConfig.industries as string[]) ?? [],
      themes: (agentConfig.themes as string[]) ?? [],
      marketCapMin: (agentConfig.marketCapMin as number | null) ?? null,
      marketCapMax: (agentConfig.marketCapMax as number | null) ?? null,
      maxPositionSize: (agentConfig.maxPositionSize as number) ?? undefined,
      realMaxPosition: (agentConfig.realMaxPosition as number) ?? undefined,
      maxOpenPositions: (agentConfig.maxOpenPositions as number) ?? undefined,
      minConfidence: (agentConfig.minConfidence as number) ?? undefined,
      alpacaCreds,
      runEnvironment,
    });

    // Filter by allowlist if mode restricts tools
    const filteredTools = modeConfig.toolAllowlist
      ? Object.fromEntries(
          modeConfig.toolAllowlist
            .map((name) => [name, allTools[name as keyof typeof allTools]])
            .filter(([, v]) => v != null),
        )
      : allTools;

    // Layer in mode-specific "suggest" tools that aren't part of the
    // createResearchTools registry (they're plain `tool()` calls, not
    // defineTool factories — they don't need ToolContext).
    const tools: Record<string, unknown> = { ...filteredTools };
    if (modeConfig.hasSuggestConfig) {
      tools.suggest_config = suggestConfigTool;
    }
    if (agentMode === "podcast-builder" || agentMode === "podcast-editor") {
      tools.suggest_podcast_config = suggestPodcastConfigTool;
    }

    // ── Stream ──────────────────────────────────────────────────────────────

    // Explicit promise so waitUntil keeps the function alive until onFinish
    // completes all its async DB work (status updates + message persistence).
    // result.response alone may resolve before the async onFinish body finishes.
    let resolveOnFinish: () => void;
    const onFinishPromise = new Promise<void>((resolve) => {
      resolveOnFinish = resolve;
    });

    // ── toolStats aggregator (Session 4 — observability) ────────────────────
    // Collects per-tool call count / latency / error count across the run so
    // /intelligence/health and run failure triage can see what the agent
    // actually did. Persisted into ResearchRun.parameters.toolStats in
    // onFinish (merged; doesn't overwrite the existing config snapshot).
    const toolStats: Record<string, { count: number; totalLatencyMs: number; errors: number }> = {};
    const failedToolCalls: Array<{ toolName: string; error: string; at: string }> = [];
    let lastStepTimeMs = t0;

    // Strip tool results down to summary-only before sending to the model.
    // Full data stays on the client for UI rendering — the model only needs
    // the one-line summary to continue reasoning. This prevents accumulated
    // tool result JSON (stock data, signals, etc.) from blowing the context.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trimmedMessages = trimToolResults(messages) as any;
    const modelMessages = await convertToModelMessages(trimmedMessages);

    // Allow client to override model (validated to known model IDs)
    const ALLOWED_OVERRIDES = ["gpt-4o", "gpt-4o-mini", "claude-sonnet-4-6", "claude-opus-4-6"];
    const effectiveModel = (modelOverride && ALLOWED_OVERRIDES.includes(modelOverride))
      ? modelOverride
      : modeConfig.model;
    const effectiveProvider = effectiveModel.startsWith("claude") ? "anthropic" : "openai";

    const resolvedModel =
      effectiveProvider === "anthropic"
        ? anthropic(effectiveModel as Parameters<typeof anthropic>[0])
        : openai(effectiveModel);

    const result = streamText({
      model: resolvedModel,
      // Provider-specific options. For OpenAI, strictJsonSchema forces OpenAI
      // to validate tool-call arguments against the Zod-derived JSON Schema at
      // the API level — rejecting hallucinated fields (e.g. `bucket` when it's
      // not in the schema) before they reach the SDK. Without this, AI SDK
      // relies on Zod to strip unknown keys server-side, which succeeds
      // functionally but leaves the transcript full of phantom parameters the
      // model thought it was using. Anthropic gets its thinking budget.
      ...(effectiveProvider === "anthropic" &&
      modeConfig.thinkingBudget != null
        ? {
            providerOptions: {
              anthropic: {
                thinking: { type: "enabled", budgetTokens: modeConfig.thinkingBudget },
              },
            },
          }
        : effectiveProvider === "openai"
          ? {
              providerOptions: {
                openai: { strictJsonSchema: true },
              },
            }
          : {}),
      // Low temperature for research-run consistency — the agent should follow
      // the stage contract deterministically, not riff on it.
      ...(agentMode === "research-run" && { temperature: 0.2 }),
      system: systemPrompt,
      messages: modelMessages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
      // Stop the run when:
      //   • we hit the per-mode step ceiling, OR
      //   • the agent calls ask_question (the user must answer before
      //     the agent does anything else — without this stop the model
      //     keeps narrating after the question, which lands as orphaned
      //     prose under the QuestionFlow card and breaks the chat if
      //     the user clicks an option mid-stream).
      // ai SDK v6 accepts an array of StopConditions; first to fire
      // wins. hasToolCall("ask_question") is the SDK helper.
      //
      // For builder/editor, also stop on the terminal "suggest" tool —
      // suggest_config / suggest_podcast_config are the END of the
      // configuration flow. Without these stops the agent kept going
      // after suggest_config and fired a late ask_question, which then
      // blocked the chat because it was waiting on an answer to a
      // question it never should have asked. The right panel showed a
      // valid analyst draft; the middle showed a stalled question card;
      // the user couldn't proceed either way. Fixed by terminating the
      // run the moment the suggest tool fires.
      stopWhen: [
        stepCountIs(modeConfig.maxSteps),
        hasToolCall("ask_question"),
        ...(modeConfig.hasSuggestConfig ? [hasToolCall("suggest_config")] : []),
        ...(agentMode === "podcast-builder" || agentMode === "podcast-editor"
          ? [hasToolCall("suggest_podcast_config")]
          : []),
      ],

      onStepFinish({ stepNumber, toolCalls, toolResults, text, finishReason, usage }) {
        const now = Date.now();
        const elapsed = now - t0;
        const stepLatencyMs = now - lastStepTimeMs;
        lastStepTimeMs = now;

        const toolNames = toolCalls.map((tc) => tc.toolName).join(", ") || "none";
        console.log(
          `[agent/${agentMode}] STEP #${stepNumber} elapsed=${elapsed}ms tools=[${toolNames}] finish=${finishReason} tokens=${usage?.totalTokens ?? "?"}`,
        );
        if (agentMode === "research-run" && elapsed > 240_000) {
          console.warn(
            `[agent/${agentMode}] ⚠️ TIMEOUT WARNING: step #${stepNumber} at ${(elapsed / 1000).toFixed(0)}s`,
          );
        }

        // Aggregate toolStats — attribute step wall time across this step's
        // tool calls, inspect tool results for ok:false errors. Approximate
        // for parallel calls (each gets credited the full step delta) but
        // directionally correct for the "which tools eat time" diagnostic.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = (toolResults ?? []) as Array<any>;
        for (const call of toolCalls) {
          const bucket = toolStats[call.toolName] ?? { count: 0, totalLatencyMs: 0, errors: 0 };
          bucket.count += 1;
          bucket.totalLatencyMs += stepLatencyMs;
          toolStats[call.toolName] = bucket;
        }
        for (const r of results) {
          // AI SDK v6 shape: { toolCallId, toolName, output } where `output`
          // is our ToolResult<T> envelope. Legacy field name `result` is
          // checked as a fallback defensively.
          const out = (r?.output ?? r?.result) as { ok?: boolean; error?: string } | undefined;
          if (out && out.ok === false) {
            const bucket = toolStats[r.toolName] ?? { count: 0, totalLatencyMs: 0, errors: 0 };
            bucket.errors += 1;
            toolStats[r.toolName] = bucket;
            failedToolCalls.push({
              toolName: r.toolName ?? "unknown",
              error: String(out.error ?? "").slice(0, 500),
              at: new Date().toISOString(),
            });
            // Keep only the last 3 failures — cheap triage sample, not a log.
            while (failedToolCalls.length > 3) failedToolCalls.shift();
          }
        }
      },

      onError({ error }) {
        const elapsed = Date.now() - t0;
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[agent/${agentMode}] ❌ STREAM ERROR elapsed=${elapsed}ms: ${msg}`);
        if (agentMode === "research-run") {
          waitUntil(markRunFailed(runId, `Stream error after ${(elapsed / 1000).toFixed(0)}s: ${msg}`));
        }
        resolveOnFinish!();
      },

      async onFinish({ response, finishReason, usage }) {
        const elapsed = Date.now() - t0;
        console.log(
          `[agent/${agentMode}] ✅ onFinish elapsed=${elapsed}ms reason=${finishReason} tokens=${usage?.totalTokens ?? "?"}`,
        );

        // Builder/editor and unscoped principal-chat don't have a
        // ResearchRun. Scoped principal-chat does — persist messages
        // and flip status to RUNNING (chat is ongoing).
        if (
          (agentMode !== "research-run" &&
            agentMode !== "podcast-segment-run" &&
            agentMode !== "principal") ||
          !runId
        ) {
          resolveOnFinish!();
          return;
        }

        try {
          if (agentMode === "research-run") {
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

            // Persist toolStats into ResearchRun.parameters (merge — don't
            // clobber the config snapshot). Thin-run warning only.
            try {
              const totalToolCalls = Object.values(toolStats).reduce((s, b) => s + b.count, 0);
              const durationMs = Date.now() - t0;
              if (finalStatus === "COMPLETE" && (totalToolCalls < 5 || durationMs < 60_000)) {
                console.warn(
                  `[agent/${agentMode}] ⚠️ THIN RUN runId=${runId} tool_calls=${totalToolCalls} duration_ms=${durationMs}`,
                );
              }
              const existing = await prisma.researchRun.findFirst({
                where: { id: runId },
                select: { parameters: true },
              });
              const existingParams =
                existing?.parameters && typeof existing.parameters === "object"
                  ? (existing.parameters as Record<string, unknown>)
                  : {};
              await prisma.researchRun.update({
                where: { id: runId },
                data: {
                  parameters: {
                    ...existingParams,
                    toolStats: {
                      totalToolCalls,
                      durationMs,
                      byTool: toolStats,
                      failedToolCalls,
                    },
                  } as object,
                },
              });
            } catch (err) {
              console.error(`[agent/${agentMode}] Failed to persist toolStats:`, err);
            }
          } else if (agentMode === "principal") {
            // Principal chat — keep the run RUNNING between messages
            // so subsequent POSTs find an open session and write tools
            // keep working. We don't mark COMPLETE here; the run sits
            // open until the user starts a fresh chat (which mints a
            // new run via the page).
          } else {
            // podcast-segment-run: safety guard — mark RUNNING → COMPLETE if the
            // save_podcast_segment_transcript tool didn't already do so.
            await prisma.researchRun.updateMany({
              where: { id: runId, status: "RUNNING" },
              data: { status: "COMPLETE", completedAt: new Date() },
            });
          }

          // Persist messages — shared for research-run and podcast-segment-run.
          // Defensive: response.messages may be undefined if the stream ended
          // abnormally or the SDK version changed.
          const responseMessages = response?.messages ?? [];
          const inputMessages = messages ?? [];
          const allMessages = [...inputMessages, ...responseMessages];
          if (allMessages.length > 0) {
            try {
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
              console.log(`[agent/${agentMode}] Persisted ${allMessages.length} messages (input=${inputMessages.length}, response=${responseMessages.length})`);
            } catch (err) {
              console.error(`[agent/${agentMode}] Failed to persist messages:`, err);
            }
          } else {
            console.warn(`[agent/${agentMode}] ⚠️ No messages to persist for run ${runId} (input=${inputMessages.length}, response=${responseMessages.length})`);
          }

          if (agentMode === "research-run") {
            // Generate briefing if complete_run didn't
            const updatedRun = await prisma.researchRun.findFirst({
              where: { id: runId },
              select: { status: true },
            });
            if (updatedRun?.status === "COMPLETE") {
              const existingBriefing = await prisma.analystBriefing.findFirst({
                where: { runId },
                select: { id: true },
              });
              if (!existingBriefing && resolvedAnalystId) {
                try {
                  await updateAnalystBriefing({ analystId: resolvedAnalystId, runId, userId: user.id, accountId });
                  console.log(`[agent/${agentMode}] ✅ Briefing written for run ${runId}`);
                } catch (err) {
                  console.error(`[agent/${agentMode}] Briefing failed:`, err);
                }
              }
            }
          }
        } finally {
          resolveOnFinish!();
        }
      },
    });

    if (
      agentMode === "research-run" ||
      agentMode === "podcast-segment-run" ||
      (agentMode === "principal" && runId)
    ) {
      // Wait for BOTH the response stream AND the onFinish async work (message
      // persistence). result.response alone may resolve before onFinish completes
      // its DB writes, causing Vercel to kill the function and lose messages.
      waitUntil(
        Promise.all([
          Promise.resolve(result.response),
          onFinishPromise,
        ]).then(() => undefined),
      );
    }

    return result.toUIMessageStreamResponse();
  } catch (err) {
    const elapsed = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[agent/${agentMode}] ❌ UNHANDLED ERROR elapsed=${elapsed}ms: ${msg}`);
    if (
      agentMode === "research-run" ||
      agentMode === "podcast-segment-run" ||
      (agentMode === "principal" && runId)
    ) {
      waitUntil(markRunFailed(runId, `Route error: ${msg}`));
    }
    return new Response(`Agent error: ${msg}`, { status: 500 });
  }
}
