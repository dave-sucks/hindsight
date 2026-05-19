/**
 * run-thesis-writer.ts — drives the thesis-writer sub-agent for one
 * ticker. Same shape as runDailyResearchAgent() inside
 * lib/inngest/functions/morning-research.ts, scoped down to a single
 * thesis-write workflow:
 *
 *   1. Load context (analyst config + existing thesis on refresh).
 *   2. Build the system prompt.
 *   3. Call generateText with MODES["thesis-writer"] (Claude Sonnet 4.6 +
 *      narrow allowlist: write_thesis_research, record_thesis,
 *      update_thesis, complete_run, plus get_stock_data + web_search as
 *      escape hatches).
 *   4. Persist the conversation messages for replay on /runs/[id].
 *   5. Mark the ResearchRun row COMPLETE/FAILED based on whether the
 *      agent landed a Thesis row.
 *
 * Called from lib/inngest/functions/thesis-writer.ts on
 * `app/thesis.write.requested`. The child ResearchRun row is created
 * upstream by dispatch_thesis_research before this function runs — we
 * receive its id and own its lifecycle.
 *
 * See docs/plans/THESIS_RESEARCH_V2.md §5.
 */

import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { prisma } from "@/lib/prisma";
import { createResearchTools } from "@/lib/agent/tools";
import { MODES } from "@/lib/agent/modes";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";

export interface RunThesisWriterArgs {
  childRunId: string;
  analystId: string;
  ticker: string;
  mode: "mint" | "refresh";
  existingThesisId?: string | null;
  reason: string;
  parentRunId?: string | null;
}

export interface RunThesisWriterResult {
  childRunId: string;
  status: "COMPLETE" | "FAILED";
  thesisId: string | null;
  steps: number;
  toolCalls: number;
  elapsedMs: number;
  error?: string;
}

function buildThesisWriterSystemPrompt(opts: {
  analystName: string;
  analystPrompt: string | null;
  ticker: string;
  mode: "mint" | "refresh";
  existingThesis: {
    id: string;
    direction: string;
    horizon: string | null;
    coreBelief: string | null;
    targetPrice: number | null;
    stopLoss: number | null;
    confidenceScore: number;
    reasoningSummary: string;
  } | null;
  reason: string;
  minConfidence: number;
}): string {
  const T = opts.ticker.toUpperCase();
  const existingBlock =
    opts.mode === "refresh" && opts.existingThesis
      ? `MODE: REFRESH — update the existing thesis below.

Existing thesis on $${T}:
  • thesis_id: ${opts.existingThesis.id}
  • direction: ${opts.existingThesis.direction}
  • horizon: ${opts.existingThesis.horizon ?? "—"}
  • core_belief: ${opts.existingThesis.coreBelief ?? "—"}
  • target_price: ${opts.existingThesis.targetPrice ?? "—"}
  • stop_loss: ${opts.existingThesis.stopLoss ?? "—"}
  • confidence: ${opts.existingThesis.confidenceScore}
  • reasoning_summary: ${opts.existingThesis.reasoningSummary}

Close out via update_thesis(thesis_id="${opts.existingThesis.id}", ..., research_data=<rawDataBlock>, research_sections=<sections>, rationale="<one line on what changed>").`
      : `MODE: MINT — net-new coverage on $${T}.

Close out via record_thesis(ticker="${T}", direction=..., research_data=<rawDataBlock>, research_sections=<sections>, ...full structural fields).`;

  return `You are ${opts.analystName}, writing one deep-research thesis on $${T}.

${opts.analystPrompt ? `Your strategy:\n${opts.analystPrompt}\n` : ""}

WHY YOU WERE DISPATCHED
${opts.reason}

${existingBlock}

YOUR JOB (4 tool calls, ~3-5 minutes wall time)

1. Call write_thesis_research ONCE. Pass:
     - ticker: "${T}"
     - analyst_context: 2-3 sentences describing your strategy in YOUR voice
       (this frames the synthesis — what kind of thesis the model should write)
     - mode: "${opts.mode}"
     ${opts.mode === "refresh" && opts.existingThesis ? `- existing_thesis_summary: "${opts.existingThesis.reasoningSummary.slice(0, 200)}"` : ""}

   This is the meta-tool. It pulls 7 structured-data sources in parallel
   and synthesizes a multi-section thesis via a deep-research model.
   ONE call. ~60-120 seconds.

2. Read the returned research carefully. Confirm:
     - Sections include Snapshot, Fundamentals, Latest Earnings,
       Catalysts & Events, Bull Case, Bear Case, Analyst Consensus,
       Insider & Technical Setup
     - Bull case is substantive (specific numbers, specific events)
     - Bear case is substantive (mandatory even on LONG)
     - Citations exist and reference real data
   If write_thesis_research failed or returned a thin synthesis, you may
   call get_stock_data once and web_search once to fill a critical gap.
   Do NOT loop on the data layer — the meta-tool already covered the
   common pulls.

3. Make the decision on top of the research:
     - direction: LONG / SHORT / PASS (PASS is allowed if the research
       does not support a directional view from your strategy's angle)
     - horizon: CATALYST / TARGET / TRADE / COMPOUNDER (pick by reasoning
       shape, not just hold length)
     - entry_price: current quote from the research (use the Snapshot)
     - target_price: real chart level (breakout / consolidation high /
       analyst-target convergence) — REQUIRED for LONG/SHORT
     - stop_loss: real chart level (support / R:R ≥ 2:1) — REQUIRED for
       LONG/SHORT
     - confidence_score: 0-100; ≥ ${opts.minConfidence} for ACTIVE coverage
     - core_belief: ONE sentence — the durable claim that, if it stops
       being true, breaks the thesis. NOT the trade summary.
     - key_assumptions: ≥2 specific premises that must hold for the belief
     - invalidation_conditions: ≥2 specific things that would prove it
       wrong (numbers, events, dates — NOT "market volatility")

4. Persist the thesis:
     ${opts.mode === "refresh" && opts.existingThesis ? `- update_thesis(thesis_id="${opts.existingThesis.id}", <all decision fields>, research_data=<rawDataBlock>, research_sections=<sections>, rationale="<one line>")` : `- record_thesis(ticker="${T}", <all decision fields>, research_data=<rawDataBlock>, research_sections=<sections>, source_kind=..., source_rationale=...)`}

   The research_data and research_sections fields MUST be passed exactly as
   write_thesis_research returned them — that's how the deep research lands
   on the Thesis row for the card.

5. Call complete_run.

QUALITY BAR
- The card the user opens should read like a Goldman initiation note,
  not a one-paragraph rationale.
- The bear case must be substantive even on LONG. No "generic risks
  like market volatility" — specific numbers, specific scenarios.
- Every belief, assumption, and invalidation condition must trace back
  to something in the synthesized research.
- TOOL CALLS only. No prose monologue between calls. Text-only assistant
  turns terminate the run as FAILED.`;
}

export async function runThesisWriterAgent(
  args: RunThesisWriterArgs,
): Promise<RunThesisWriterResult> {
  const t0 = Date.now();
  const T = args.ticker.toUpperCase();

  // Entry-point breadcrumb — added 2026-05-19 after a production
  // incident (LSCC dispatches sitting RUNNING for 3+ hours with
  // ZERO logs from this function). The function returned cleanly
  // from Inngest's POV in ~30s but never marked the ResearchRun
  // terminal. Without this log we couldn't tell whether the function
  // ever entered at all. If you see this line in Vercel logs but
  // not the subsequent "[thesis-writer] context loaded" line, the
  // analyst.findUnique throws or hangs.
  console.log(
    `[thesis-writer] START childRun=${args.childRunId} ticker=${T} analyst=${args.analystId} mode=${args.mode}`,
  );

  // ── 1. Load context ─────────────────────────────────────────────────
  const analyst = await prisma.agentConfig.findUnique({
    where: { id: args.analystId },
    select: {
      id: true,
      userId: true,
      accountId: true,
      name: true,
      analystPrompt: true,
      sectors: true,
      industries: true,
      themes: true,
      exclusionList: true,
      minConfidence: true,
      maxPositionSize: true,
      realMaxPosition: true,
      maxOpenPositions: true,
      tradingEnvironment: true,
    },
  });

  if (!analyst) {
    console.error(
      `[thesis-writer] EARLY-EXIT childRun=${args.childRunId} analyst=${args.analystId} not found`,
    );
    await prisma.researchRun.updateMany({
      where: { id: args.childRunId, status: "RUNNING" },
      data: { status: "FAILED", completedAt: new Date() },
    });
    return {
      childRunId: args.childRunId,
      status: "FAILED",
      thesisId: null,
      steps: 0,
      toolCalls: 0,
      elapsedMs: Date.now() - t0,
      error: `Analyst ${args.analystId} not found`,
    };
  }
  console.log(
    `[thesis-writer] context loaded childRun=${args.childRunId} analyst=${analyst.name} env=${analyst.tradingEnvironment ?? "PAPER"}`,
  );

  // ── Outer try/catch — DEFENSE IN DEPTH ──────────────────────────────
  // Wraps the entire setup + agent loop so ANY throw (Prisma read, alpaca
  // creds resolve, watchlist fetch, tool factory, prompt build, model
  // call, message persistence) lands in the catch and marks the run
  // FAILED. Without this, the pre-2026-05-19 narrow try around
  // generateText left a hole: anything that threw before the agent loop
  // (e.g. Anthropic returning a structured rate-limit ERROR on the first
  // attempt — which bubbled through resolveAlpacaCredentials retries?
  // No, more commonly the Inngest step retry semantics + the narrow try
  // combination) left the ResearchRun stuck in RUNNING forever. The
  // /runs page's 10-minute stale-detect only fires when someone opens
  // the detail page, so stuck rows piled up on the index. See PR (this
  // one) — observed 2 RUNNING-forever LSCC runs (rate-limit casualties)
  // on 2026-05-19.
  try {
  let existingThesis: NonNullable<
    Parameters<typeof buildThesisWriterSystemPrompt>[0]["existingThesis"]
  > | null = null;
  if (args.mode === "refresh" && args.existingThesisId) {
    const row = await prisma.thesis.findUnique({
      where: { id: args.existingThesisId },
      select: {
        id: true,
        direction: true,
        horizon: true,
        coreBelief: true,
        targetPrice: true,
        stopLoss: true,
        confidenceScore: true,
        reasoningSummary: true,
      },
    });
    if (row) {
      existingThesis = {
        id: row.id,
        direction: row.direction,
        horizon: row.horizon,
        coreBelief: row.coreBelief,
        targetPrice: row.targetPrice != null ? Number(row.targetPrice) : null,
        stopLoss: row.stopLoss != null ? Number(row.stopLoss) : null,
        confidenceScore: row.confidenceScore,
        reasoningSummary: row.reasoningSummary,
      };
    }
  }

  // ── 2. Build tools (filtered by allowlist) ──────────────────────────
  const runEnvironment =
    (analyst.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";
  const alpacaCreds =
    (await resolveAlpacaCredentials(analyst.userId, runEnvironment)) ??
    undefined;
  const watchlistSymbols = await getWatchlistSymbols(analyst.id);

  const allTools = createResearchTools({
    runId: args.childRunId,
    userId: analyst.userId,
    accountId: analyst.accountId,
    analystId: analyst.id,
    watchlist: watchlistSymbols,
    exclusionList: analyst.exclusionList ?? [],
    sectors: analyst.sectors ?? [],
    industries: analyst.industries ?? [],
    themes: analyst.themes ?? [],
    maxPositionSize: Number(analyst.maxPositionSize),
    realMaxPosition: Number(analyst.realMaxPosition),
    maxOpenPositions: analyst.maxOpenPositions,
    minConfidence: analyst.minConfidence,
    alpacaCreds,
    runEnvironment,
  });

  const modeConfig = MODES["thesis-writer"];
  const allowlist = modeConfig.toolAllowlist;
  const tools = allowlist
    ? Object.fromEntries(
        allowlist
          .map(
            (name) =>
              [name, allTools[name as keyof typeof allTools]] as const,
          )
          .filter(([, v]) => v != null),
      )
    : allTools;

  // ── 3. System + user prompts ────────────────────────────────────────
  const systemPrompt = buildThesisWriterSystemPrompt({
    analystName: analyst.name,
    analystPrompt: analyst.analystPrompt,
    ticker: T,
    mode: args.mode,
    existingThesis,
    reason: args.reason,
    minConfidence: analyst.minConfidence,
  });

  const userPrompt =
    `Write a deep-research thesis on $${T} (${args.mode}). ` +
    `Follow the 5-step workflow above. TOOL CALLS only — no narration. ` +
    `Begin with write_thesis_research now.`;

  console.log(
    `[thesis-writer] tools+prompt ready childRun=${args.childRunId} toolCount=${Object.keys(tools).length}`,
  );

  // ── 4. Run the agent ───────────────────────────────────────────────
  // Provider chosen by mode config; anthropic is the bake-off winner
  // (2026-05-16, see MODES["thesis-writer"] comment). openai branch kept
  // as a fallback path if the mode config is ever swapped to a non-
  // Anthropic model — but per the bake-off, avoid GPT-5/o3 family.
  const model =
    modeConfig.provider === "anthropic"
      ? anthropic(modeConfig.model as Parameters<typeof anthropic>[0])
      : openai(modeConfig.model);

  // Anthropic native web_search tool — server-side tool that Claude calls
  // directly. Plumbed into the agent loop so the model can fill narrative
  // gaps the structured-data block doesn't cover (analyst commentary,
  // transcript quotes, dated catalysts). The bake-off found this is the
  // load-bearing piece — synthesis without web_search lands closer to a
  // Reddit summary than a Goldman initiation note.
  //
  // The mode allowlist also has the Perplexity Sonar `web_search` tool
  // wired in (escape hatch from the daily-run inventory). When both are
  // present in the same `tools` map, Claude routes to whichever name it
  // calls — we override the `web_search` key with the native tool so the
  // model uses Anthropic's path by default. The Sonar implementation stays
  // available under its registered name if a future mode needs it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolsWithSearch: Record<string, unknown> = { ...(tools as any) };
  if (modeConfig.provider === "anthropic") {
    toolsWithSearch.web_search = anthropic.tools.webSearch_20260209({
      // Agent-loop escape hatch — the meta-tool's synthesis call has its
      // own dedicated web_search budget. This one is rarely used because
      // the prompt tells the agent to call write_thesis_research ONCE
      // and decide on top of the result. 2 is plenty for the edge case
      // where the meta-tool returned a thin synthesis and the agent
      // wants to verify one specific data point before recording the
      // thesis. Dropped from 6 → 2 on 2026-05-18 to keep input-token
      // pressure off the Anthropic Tier-1 30k/min bucket — see the
      // matching comment in lib/agent/tools/write-thesis-research.ts.
      maxUses: 2,
    });
  }

  const toolStats: Record<
    string,
    { count: number; totalLatencyMs: number; errors: number }
  > = {};
  let lastStepTimeMs = t0;

  console.log(
    `[thesis-writer] entering generateText childRun=${args.childRunId} model=${modeConfig.model} provider=${modeConfig.provider} maxSteps=${modeConfig.maxSteps} abortAfterMs=${(modeConfig.maxDuration - 30) * 1000}`,
  );

  try {
    const { steps, response } = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: toolsWithSearch as any,
      // Anthropic providerOptions: extended thinking off here — the prompt
      // is short and the work is mostly tool dispatch. OpenAI gets
      // strictJsonSchema for arg validation. No-op for either when the
      // other provider's options aren't applicable.
      ...(modeConfig.provider === "openai"
        ? { providerOptions: { openai: { strictJsonSchema: true } } }
        : {}),
      stopWhen: stepCountIs(modeConfig.maxSteps),
      // 30s of headroom inside the function's maxDuration so the catch
      // block can mark the run terminal before Vercel kills the process.
      abortSignal: AbortSignal.timeout((modeConfig.maxDuration - 30) * 1000),
      onStepFinish({ stepNumber, toolCalls, finishReason, text: stepText }) {
        const now = Date.now();
        const stepLatencyMs = now - lastStepTimeMs;
        lastStepTimeMs = now;
        const toolNames = toolCalls.map((tc) => tc.toolName).join(", ") || "none";
        const textPreview = stepText?.slice(0, 80)?.replace(/\n/g, " ") || "";
        console.log(
          `[thesis-writer] STEP #${stepNumber} child=${args.childRunId} ticker=${T} tools=[${toolNames}] finish=${finishReason} text="${textPreview}"`,
        );
        for (const call of toolCalls) {
          const bucket = toolStats[call.toolName] ?? {
            count: 0,
            totalLatencyMs: 0,
            errors: 0,
          };
          bucket.count += 1;
          bucket.totalLatencyMs += stepLatencyMs;
          toolStats[call.toolName] = bucket;
        }
      },
    });

    const totalToolCalls = steps.reduce(
      (sum, s) => sum + (s.toolCalls?.length ?? 0),
      0,
    );
    const elapsed = Date.now() - t0;

    // ── 5. Persist conversation messages ─────────────────────────────
    let responseMessages = response?.messages;
    if (
      !responseMessages ||
      !Array.isArray(responseMessages) ||
      responseMessages.length === 0
    ) {
      responseMessages = steps.flatMap((s) => {
        const stepMsgs = (
          s as unknown as { response?: { messages?: unknown[] } }
        ).response?.messages;
        return Array.isArray(stepMsgs) ? stepMsgs : [];
      }) as typeof responseMessages;
    }
    try {
      const userMessage = {
        role: "user",
        content: [{ type: "text", text: userPrompt }],
      };
      const allMessages = [userMessage, ...(responseMessages ?? [])];
      await prisma.$transaction(async (tx) => {
        await tx.runMessage.deleteMany({ where: { runId: args.childRunId } });
        await tx.runMessage.create({
          data: {
            runId: args.childRunId,
            role: "thread",
            content: JSON.stringify(allMessages),
          },
        });
      });
    } catch (msgErr) {
      console.error(
        `[thesis-writer] failed to persist messages for run=${args.childRunId}:`,
        msgErr instanceof Error ? msgErr.message : msgErr,
      );
    }

    // ── 6. Determine outcome ─────────────────────────────────────────
    // Success = a Thesis row got written/touched on this run. For mint
    // mode, look at thesis insert; for refresh, look at a ThesisUpdate
    // touching the existing thesis. If neither happened the run failed
    // its contract.
    let thesisId: string | null = null;
    if (args.mode === "mint") {
      const mintedThesis = await prisma.thesis.findFirst({
        where: { researchRunId: args.childRunId, ticker: T },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });
      thesisId = mintedThesis?.id ?? null;
    } else if (args.existingThesisId) {
      const refreshTouch = await prisma.thesisUpdate.findFirst({
        where: { runId: args.childRunId, thesisId: args.existingThesisId },
        select: { thesisId: true },
      });
      thesisId = refreshTouch?.thesisId ?? null;
    }

    const finalStatus: "COMPLETE" | "FAILED" =
      thesisId !== null ? "COMPLETE" : "FAILED";

    // Atomic — only transition RUNNING → terminal. complete_run may have
    // already marked COMPLETE; that wins.
    await prisma.researchRun.updateMany({
      where: { id: args.childRunId, status: "RUNNING" },
      data: { status: finalStatus, completedAt: new Date() },
    });

    // Enrich parameters with toolStats (non-critical, separate write).
    try {
      const fresh = await prisma.researchRun.findUnique({
        where: { id: args.childRunId },
        select: { parameters: true },
      });
      await prisma.researchRun.update({
        where: { id: args.childRunId },
        data: {
          parameters: {
            ...((fresh?.parameters as object) ?? {}),
            agentSteps: steps.length,
            agentToolCalls: totalToolCalls,
            elapsedMs: elapsed,
            toolStats: {
              totalToolCalls: Object.values(toolStats).reduce(
                (s, b) => s + b.count,
                0,
              ),
              durationMs: elapsed,
              byTool: toolStats,
            },
            thesisId,
          } as object,
        },
      });
    } catch (statsErr) {
      console.warn(
        `[thesis-writer] failed to persist toolStats for run=${args.childRunId}:`,
        statsErr instanceof Error ? statsErr.message : statsErr,
      );
    }

    if (finalStatus === "FAILED") {
      try {
        await prisma.runEvent.create({
          data: {
            runId: args.childRunId,
            type: "run_failed",
            title: "Thesis-writer did not produce a thesis",
            message: `Ran ${steps.length} steps / ${totalToolCalls} tool calls without ${args.mode === "mint" ? "record_thesis" : "update_thesis"}.`,
            payload: {
              ticker: T,
              mode: args.mode,
              steps: steps.length,
              toolCalls: totalToolCalls,
            } as object,
          },
        });
      } catch {
        /* event write is best-effort */
      }
    }

    return {
      childRunId: args.childRunId,
      status: finalStatus,
      thesisId,
      steps: steps.length,
      toolCalls: totalToolCalls,
      elapsedMs: elapsed,
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "AbortError" ||
        err.message.includes("aborted") ||
        err.message.includes("timed out"));
    const msg = isTimeout
      ? `Thesis-writer timed out after ${Math.round((Date.now() - t0) / 1000)}s.`
      : err instanceof Error
        ? err.message
        : String(err);
    console.error(`[thesis-writer] FAILED ticker=${T} child=${args.childRunId}: ${msg}`);

    try {
      const fresh = await prisma.researchRun.findUnique({
        where: { id: args.childRunId },
        select: { parameters: true },
      });
      await prisma.researchRun.updateMany({
        where: { id: args.childRunId, status: "RUNNING" },
        data: { status: "FAILED", completedAt: new Date() },
      });
      await prisma.researchRun.update({
        where: { id: args.childRunId },
        data: {
          parameters: {
            ...((fresh?.parameters as object) ?? {}),
            error: msg,
            failedAt: new Date().toISOString(),
          } as object,
        },
      });
    } catch {
      /* best-effort */
    }
    return {
      childRunId: args.childRunId,
      status: "FAILED",
      thesisId: null,
      steps: 0,
      toolCalls: 0,
      elapsedMs: Date.now() - t0,
      error: msg,
    };
  }
  } catch (outerErr) {
    // Outer catch — anything that threw during setup before the inner
    // try (Prisma reads, alpaca creds, watchlist fetch, tool factory,
    // prompt build) lands here. Mark the run FAILED so the row never
    // stays in RUNNING.
    const msg =
      outerErr instanceof Error ? outerErr.message : String(outerErr);
    console.error(
      `[thesis-writer] OUTER CATCH ticker=${T} child=${args.childRunId}: ${msg}`,
    );
    try {
      const fresh = await prisma.researchRun.findUnique({
        where: { id: args.childRunId },
        select: { parameters: true },
      });
      await prisma.researchRun.updateMany({
        where: { id: args.childRunId, status: "RUNNING" },
        data: { status: "FAILED", completedAt: new Date() },
      });
      await prisma.researchRun.update({
        where: { id: args.childRunId },
        data: {
          parameters: {
            ...((fresh?.parameters as object) ?? {}),
            error: `Setup error before agent loop: ${msg}`,
            failedAt: new Date().toISOString(),
            outerCatch: true,
          } as object,
        },
      });
    } catch {
      /* best-effort */
    }
    return {
      childRunId: args.childRunId,
      status: "FAILED",
      thesisId: null,
      steps: 0,
      toolCalls: 0,
      elapsedMs: Date.now() - t0,
      error: msg,
    };
  }
}
