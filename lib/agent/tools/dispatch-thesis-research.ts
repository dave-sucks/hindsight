/**
 * dispatch_thesis_research — orchestrator-side tool. Spawns a thesis-writer
 * sub-agent run for one ticker. Returns immediately with the child run ID;
 * the actual deep-research work happens asynchronously in the
 * `thesis-writer` Inngest function.
 *
 * Pattern: insert a child ResearchRun (mode="THESIS_WRITER",
 * parentRunId=ctx.runId), fire `app/thesis.write.requested`, return the
 * childRunId. Discovery / Daily / Tactical / Principal Chat all call this
 * — per-orchestrator wait semantics live in the caller (fire-and-forget vs
 * waitForEvent vs inline call).
 *
 * See docs/plans/THESIS_RESEARCH_V2.md §6.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";

export const dispatchThesisResearch = defineTool({
  description:
    "Dispatch a thesis-writer sub-agent to write or refresh a deep-research thesis on one " +
    "ticker. Use this whenever the user (or your orchestration logic) wants a fresh, " +
    "multi-section equity-research note — it spawns a focused child agent that pulls the " +
    "structured data, calls the deep-research model, and persists the thesis. Returns " +
    "immediately with a child run ID; the research itself takes ~60-120s and runs " +
    "asynchronously in an Inngest function. The user can watch the child run stream live " +
    "at /runs/<childRunId>.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. NVDA"),
    analyst_id: z
      .string()
      .describe(
        "AgentConfig.id — whose voice to write in. The thesis row is FK'd to this analyst.",
      ),
    mode: z
      .enum(["mint", "refresh"])
      .describe(
        "mint = net-new coverage; refresh = update an existing thesis with new evidence.",
      ),
    existing_thesis_id: z
      .string()
      .optional()
      .describe(
        "Required when mode='refresh' — the Thesis.id whose research should be updated.",
      ),
    reason: z
      .string()
      .min(20)
      .describe(
        "Why this dispatch is happening (e.g. 'User asked for a fresh thesis on $F via " +
          "Principal Chat'). Persisted on the child run's parameters for traceability.",
      ),
    promotion_context: z
      .object({
        paperTenureDays: z.number().nullable(),
        paperRealizedPnl: z.number().nullable(),
        paperReviewCount: z.number().nullable(),
        promotedAt: z.string().nullable(),
      })
      .optional()
      .describe(
        "PAPER→LIVE promotion framing. Usually you don't pass this — when mode='refresh' " +
          "and the existing thesis is in PROMOTED status, this tool auto-populates from the " +
          "Thesis row (paperTenureDays / paperRealizedPnl / paperReviewCount / promotedAt). " +
          "Forwarded to the thesis-writer worker so write_thesis_research can frame the " +
          "Decision Fields block around RE-ENTER / DOWNGRADE / INVALIDATE.",
      ),
  }),
  ui: "tool-ui" as const,
  groupId: "thesis-dispatch",

  progressLabel: ({ ticker, mode }) =>
    mode === "refresh"
      ? `Refreshing $${ticker.toUpperCase()} thesis`
      : `Dispatching $${ticker.toUpperCase()} thesis-writer`,

  execute: async (args, ctx) => {
    const T = args.ticker.toUpperCase();

    // Verify the analyst exists + belongs to this account before inserting
    // the child run row. The FK on ResearchRun.agentConfigId is SetNull, so
    // a bogus id wouldn't fail at insert — it'd just orphan the run.
    const analyst = await prisma.agentConfig.findFirst({
      where: { id: args.analyst_id, accountId: ctx.accountId },
      select: { id: true, name: true, userId: true, accountId: true },
    });
    if (!analyst) {
      return {
        summary: `Dispatch failed: analyst ${args.analyst_id} not found on this account.`,
        data: {
          childRunId: null,
          status: "FAILED" as const,
          note:
            `No analyst with id ${args.analyst_id} exists on this account. Use list_analysts ` +
            `to find the right analyst_id before calling dispatch_thesis_research.`,
        },
        sources: [],
      };
    }

    if (args.mode === "refresh" && !args.existing_thesis_id) {
      return {
        summary: `Dispatch failed for $${T}: refresh mode requires existing_thesis_id.`,
        data: {
          childRunId: null,
          status: "FAILED" as const,
          note:
            "When mode='refresh', pass existing_thesis_id — the Thesis.id whose research " +
            "should be updated. For net-new coverage, use mode='mint' instead.",
        },
        sources: [],
      };
    }

    // Auto-populate promotion_context for refreshes on PROMOTED theses. This
    // is the path the promote-analyst action takes when fanning out rewrites
    // for the first live run. The caller doesn't need to know whether the
    // thesis is PROMOTED — we read the four context fields off the row and
    // thread them into the worker so write_thesis_research's synthesis prompt
    // gets the RE-ENTER / DOWNGRADE / INVALIDATE framing.
    let effectivePromotionContext = args.promotion_context;
    if (
      args.mode === "refresh" &&
      args.existing_thesis_id &&
      !effectivePromotionContext
    ) {
      const existing = await prisma.thesis.findUnique({
        where: { id: args.existing_thesis_id },
        select: {
          status: true,
          paperTenureDays: true,
          paperRealizedPnl: true,
          paperReviewCount: true,
          promotedAt: true,
        },
      });
      if (existing && existing.status === "PROMOTED") {
        effectivePromotionContext = {
          paperTenureDays: existing.paperTenureDays,
          paperRealizedPnl: existing.paperRealizedPnl,
          paperReviewCount: existing.paperReviewCount,
          promotedAt: existing.promotedAt
            ? existing.promotedAt.toISOString()
            : null,
        };
      }
    }

    // Resolve parentRunId. ctx.runId might be a real ResearchRun id (the
    // scoped principal-chat path creates one and threads it through) or a
    // mode-name sentinel like "principal" (the unscoped path, where the
    // route falls back to `runId || agentMode`). Inserting a sentinel as
    // parentRunId would FK-violate `ResearchRun(parentRunId → ResearchRun.id)`,
    // so verify the row exists and pass `undefined` when it doesn't —
    // Prisma then omits the field and the child run lands as a top-level
    // orphan (which is the right behavior for unscoped dispatches anyway).
    let resolvedParentRunId: string | undefined;
    if (ctx.runId) {
      const parentExists = await prisma.researchRun.findUnique({
        where: { id: ctx.runId },
        select: { id: true },
      });
      if (parentExists) resolvedParentRunId = ctx.runId;
    }

    // mode is intentionally a String column on ResearchRun (not a Prisma
    // enum) so new values like "THESIS_WRITER" don't need a migration. See
    // docs/plans/THESIS_RESEARCH_V2.md §7.
    const childRun = await prisma.researchRun.create({
      data: {
        userId: analyst.userId,
        accountId: analyst.accountId,
        agentConfigId: analyst.id,
        source: "AGENT",
        status: "RUNNING",
        mode: "THESIS_WRITER",
        environment: ctx.runEnvironment ?? "PAPER",
        ...(resolvedParentRunId ? { parentRunId: resolvedParentRunId } : {}),
        parameters: {
          ticker: T,
          mode: args.mode,
          existingThesisId: args.existing_thesis_id ?? null,
          reason: args.reason,
          parentRunId: resolvedParentRunId ?? null,
          dispatchedAt: new Date().toISOString(),
          promotionContext: effectivePromotionContext ?? null,
        } as object,
      },
      select: { id: true },
    });

    // forceWatchingMint = true for chat-dispatched mints (Phase 1).
    //
    // Rationale: chat-dispatched mints are exploratory — the user typed
    // "write me a thesis on $X" to STUDY the name, not to auto-trade it.
    // ACTIVE attaches HELD-template triggers (EXIT on stop_loss, REVIEW on
    // target_hit) but no place_trade fires, so the trigger evaluator
    // later fires orphan tactical EXIT runs that fail silently (same
    // failure mode the discovery cron's hard-clamp was added to fix on
    // 2026-05-13). Default to WATCHING; user can promote via a follow-up
    // "buy this" message which triggers a separate place_trade flow.
    //
    // Future Phase-3 daily-run dispatches (refresh-then-trade) need
    // forceWatchingMint=false — that's a refresh flow, not a mint flow,
    // so the clamp doesn't apply anyway (only LONG/SHORT mints get
    // clamped; refreshes are status-preserving by design). Future
    // tactical dispatches (Phase 4) call runThesisWriterAgent inline,
    // bypassing this dispatch tool entirely.
    //
    // Belt-and-suspenders pattern: the system prompt also tells the
    // agent to default WATCHING (instruction in run-thesis-writer.ts).
    // The flag here is the Layer-1 enforcement in case the agent ignores
    // the prompt — mirrors the discoveryOnly + discovery clamp pattern
    // in record_thesis.ts.
    await inngest.send({
      name: "app/thesis.write.requested",
      data: {
        childRunId: childRun.id,
        ticker: T,
        analystId: analyst.id,
        mode: args.mode,
        existingThesisId: args.existing_thesis_id ?? null,
        reason: args.reason,
        parentRunId: resolvedParentRunId ?? null,
        forceWatchingMint: args.mode === "mint",
        promotionContext: effectivePromotionContext ?? null,
      },
    });

    const tag = effectivePromotionContext
      ? "promotion refresh dispatched"
      : args.mode === "refresh"
        ? "refresh dispatched"
        : "mint dispatched";

    return {
      summary: `Dispatched thesis-writer for $${T} (${args.mode}) — child run ${childRun.id}`,
      data: {
        childRunId: childRun.id,
        ticker: T,
        mode: args.mode,
        analystName: analyst.name,
        estimatedDurationMs: 90_000,
        items: [
          {
            kind: "ticker" as const,
            ticker: T,
            tag,
            text: `Worker spawned for ${analyst.name} · child run ${childRun.id.slice(0, 8)}…`,
          },
          {
            kind: "generic" as const,
            text:
              `Watch progress at /runs/${childRun.id}. ETA ~60-120s. ` +
              `Result lands as a Thesis with researchData + researchSections populated.`,
          },
        ],
      },
      sources: [],
    };
  },
});
